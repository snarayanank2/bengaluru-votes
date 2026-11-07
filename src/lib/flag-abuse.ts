/** Admission primitives for candidate reports. No raw IPs or bearer receipts are stored. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client';

export const FLAG_COOKIE = 'bv_flag_browser';
export const FLAG_COOKIE_SECONDS = 30 * 24 * 3600;
export type FlagMetric = 'accepted' | 'duplicate' | 'captcha_failed' | 'captcha_error' | 'rate_limited' | 'spam';
export interface FlagReporter { browserHash: string; networkHash: string }
export class FlagRateLimitError extends Error {
  /** Seconds until the oldest counted admission leaves its window and the reporter may submit again (at least 1). */
  constructor(public retryAfterSeconds = 60) { super('flag_rate_limited'); }
}
function secret(): string {
  const value = process.env.FLAGS_ABUSE_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV !== 'production' || (process.env.ALLOW_INSECURE_LOCAL_RECAPTCHA === 'true' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.SITE_ORIGIN ?? ''))) return 'local-flag-abuse-only-not-for-production';
  throw new Error('flags_abuse_secret_missing');
}
export function flagHash(purpose: string, value: string): string {
  return createHmac('sha256', secret()).update(`${purpose}\0${value}`).digest('hex');
}
export function issueFlagToken(): string {
  const payload = `${Date.now()}.${randomBytes(32).toString('hex')}`;
  return `${payload}.${flagHash('signature', payload)}`;
}
export function flagBrowserHash(token: string | undefined): string | null {
  if (!token || !/^\d{13}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) return null;
  const [stamp, nonce, signature] = token.split('.');
  const age = Date.now() - Number(stamp);
  if (age < 0 || age >= FLAG_COOKIE_SECONDS * 1000) return null;
  const expected = flagHash('signature', `${stamp}.${nonce}`);
  if (!timingSafeEqual(Buffer.from(signature!, 'hex'), Buffer.from(expected, 'hex'))) return null;
  return flagHash('browser', token);
}
export function reportFingerprint(input: { targetRef: string; detail: string; suggestedValue?: string | null; sourceUrl?: string | null }): string {
  return createHash('sha256').update(JSON.stringify([input.targetRef, input.detail, input.suggestedValue ?? '', input.sourceUrl ?? ''].map(v => v.trim().replace(/\s+/gu, ' ')))).digest('hex');
}
export async function flagLock(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`flag:${key}`}, 0))`);
}
export async function metric(event: FlagMetric, tx: Tx | typeof db = db, amount = 1): Promise<void> {
  await tx.execute(sql`insert into flag_metrics(hour,event,count) values(date_trunc('hour',now()),${event},${amount}) on conflict(hour,event) do update set count=flag_metrics.count+excluded.count`);
}
export function flagLimit(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
/** Cheap local protection also applies when nginx is absent (development). */
export async function admitFlagRequest(networkHash: string): Promise<boolean> {
  const rows = await db.execute(sql`insert into flag_request_buckets(network_hash,minute,count) values(${networkHash},date_trunc('minute',now()),1)
    on conflict(network_hash,minute) do update set count=flag_request_buckets.count+1 returning count`);
  const ok = Number(rows[0]!.count) <= 15;
  if (!ok) await metric('rate_limited');
  return ok;
}
export async function lockReporter(tx: Tx, who: FlagReporter): Promise<void> {
  const keys = [`browser:${who.browserHash}`, `network:${who.networkHash}`];
  for (const key of keys.sort()) await flagLock(tx, key);
}
/** Seconds until the admission that must expire for a count of `count` to drop below `limit` leaves a window of `windowSeconds`. */
async function secondsUntilBelow(tx: Tx, column: 'browser_hash' | 'network_hash', value: string, windowSeconds: number, count: number, limit: number): Promise<number> {
  const [r] = await tx.execute(sql`select greatest(1, ceil(extract(epoch from (created_at + make_interval(secs => ${windowSeconds}) - now()))))::int as wait
    from flag_admissions where ${column === 'browser_hash' ? sql`browser_hash` : sql`network_hash`}=${value} and created_at>now()-make_interval(secs => ${windowSeconds})
    order by created_at asc offset ${Math.max(0, count - limit)} limit 1`);
  return Number(r?.wait ?? 60);
}
/** One admission is one whole citizen submission, however many fields it reports. */
export async function checkFlagAllowance(tx: Tx, who: FlagReporter): Promise<void> {
  const dailyLimit = flagLimit('FLAGS_REPORTER_DAILY_LIMIT', 10), burstLimit = flagLimit('FLAGS_REPORTER_BURST_LIMIT', 10);
  const [r] = await tx.execute(sql`select count(*)::int as daily, count(*) filter(where created_at>now()-interval '10 minutes')::int as burst from flag_admissions where browser_hash=${who.browserHash} and created_at>now()-interval '24 hours'`);
  const daily = Number(r!.daily), burst = Number(r!.burst);
  // To submit again every exceeded limit must clear, so wait for the slowest.
  const waits: number[] = [];
  if (daily >= dailyLimit) waits.push(await secondsUntilBelow(tx, 'browser_hash', who.browserHash, 24 * 3600, daily, dailyLimit));
  if (burst >= burstLimit) waits.push(await secondsUntilBelow(tx, 'browser_hash', who.browserHash, 600, burst, burstLimit));
  if (waits.length) throw new FlagRateLimitError(Math.max(...waits));
  const [n] = await tx.execute(sql`select count(*)::int as n from flag_admissions where network_hash=${who.networkHash} and created_at>now()-interval '24 hours'`);
  const networkLimit = flagLimit('FLAGS_NETWORK_DAILY_LIMIT', 100);
  if (Number(n!.n) >= networkLimit) throw new FlagRateLimitError(await secondsUntilBelow(tx, 'network_hash', who.networkHash, 24 * 3600, Number(n!.n), networkLimit));
}
export async function recordFlagAdmission(tx: Tx, who: FlagReporter): Promise<void> {
  await tx.execute(sql`insert into flag_admissions(browser_hash,network_hash) values(${who.browserHash},${who.networkHash})`);
  await metric('accepted', tx);
}

/** Always-on cleanup of short-lived abuse metadata (not report content). */
export async function cleanupFlagAbuse(): Promise<void> {
  await db.transaction(async tx => {
    await tx.execute(sql`update flag_submissions set browser_hash=null where browser_hash is not null and created_at<=now()-interval '30 days'`);
    await tx.execute(sql`update flag_submissions s set fingerprint=null from flag_items i where s.flag_item_id=i.id and i.status<>'pending' and i.resolved_at<=now()-interval '7 days' and s.fingerprint is not null`);
    await tx.execute(sql`update flag_items set resolved_value_hash=null where resolved_at<=now()-interval '7 days' and resolved_value_hash is not null`);
    await tx.execute(sql`delete from flag_admissions where created_at<=now()-interval '30 days'`);
    await tx.execute(sql`update flag_admissions set network_hash=null where created_at<=now()-interval '48 hours' and network_hash is not null`);
    await tx.execute(sql`delete from flag_request_buckets where minute<=now()-interval '48 hours'`);
    await tx.execute(sql`delete from flag_metrics where hour<=now()-interval '30 days'`);
  });
}
/** `flag_items.created_at` is a UTC `timestamp` without a zone; raw SQL hands it back as text, so read it as UTC. */
function oldestPending(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function loadFlagMetrics() {
  const rows = await db.execute(sql`select event,sum(count)::int as total from flag_metrics where hour>=now()-interval '24 hours' group by event`);
  const counts = Object.fromEntries(rows.map(r => [String(r.event),Number(r.total)]));
  const [backlog] = await db.execute(sql`select count(*)::int as pending,min(created_at) as oldest from flag_items where status='pending'`);
  const [spike] = await db.execute(sql`select coalesce(sum(count) filter(where hour=date_trunc('hour',now())),0)::int as current, coalesce(sum(count) filter(where hour=date_trunc('hour',now())-interval '1 hour'),0)::int as previous from flag_metrics where event='accepted' and hour>=date_trunc('hour',now())-interval '1 hour'`);
  return { counts,pending:Number(backlog!.pending),oldest:oldestPending(backlog!.oldest), spike:Number(spike!.current)>=20 && Number(spike!.current)>Math.max(1,Number(spike!.previous))*3, paused:process.env.FLAGS_SUBMISSIONS_PAUSED==='true' };
}

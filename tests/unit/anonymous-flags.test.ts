import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import * as s from '../../src/db/schema';
import * as flags from '../../src/lib/flags';

const wardId = 99762;
let admin: number;
const reporter = (extra = {}) => ({ browserHash: randomUUID(), networkHash: randomUUID(), ...extra });
async function target() {
  const [c] = await db.insert(s.candidates).values({ slug: randomUUID(), wardId, nameEn: 'Demo (FICTIONAL)', partyEn: 'Demo Party A' }).returning();
  return `candidate:${c!.id}:age`;
}
const input = (targetRef: string, detail = 'Age differs from the affidavit, page 2.') => ({ targetType: 'candidate_field' as const, targetRef, detail });
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await db.insert(s.wards).values({ id: wardId, nameEn: 'Test', nameKn: 'ಪರೀಕ್ಷೆ', corporation: 'south', zone: 'test', boundaryRef: 'test' }).onConflictDoNothing();
  const rows = await db.insert(s.users).values([
    { email: `${randomUUID()}@example.com`, role: 'admin', status: 'active' },
  ]).returning();
  admin = rows[0]!.id;
});
describe('anonymous flag admission', () => {
  it('accepts an anonymous report and retries it without inflating counts', async () => {
    const ref = await target(), who = reporter();
    const first = await flags.submitPublicFlag(who, input(ref));
    expect(first.state).toBe('accepted');
    expect(await flags.submitPublicFlag(who, input(ref))).toEqual({ ...first, state: 'duplicate' });
    expect((await flags.submitPublicFlag(who, input(ref, 'Different claim'))).state).toBe('already_reported');
    const rows = await db.select().from(s.flagSubmissions).where(eq(s.flagSubmissions.flagItemId, first.flagItemId!));
    expect(rows).toHaveLength(1); expect(rows[0]).not.toHaveProperty('userId');
  });
  it('serializes simultaneous duplicates', async () => {
    const ref = await target(), who = reporter();
    const results = await Promise.all(Array.from({ length: 6 }, () => flags.submitPublicFlag(who, input(ref))));
    expect(results.filter(r => r.state === 'accepted')).toHaveLength(1);
  });
  it('atomically allows only ten new reports in ten minutes', async () => {
    process.env.FLAGS_REPORTER_DAILY_LIMIT = '50';
    try {
      const refs = await Promise.all(Array.from({ length: 14 }, target)), who = reporter();
      const results = await Promise.allSettled(refs.map(ref => flags.submitPublicFlag(who, input(ref))));
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(10);
      expect(results.filter(r => r.status === 'rejected' && r.reason.message === 'flag_rate_limited')).toHaveLength(4);
    } finally { delete process.env.FLAGS_REPORTER_DAILY_LIMIT; }
  });
  it('changing networks cannot escape a browser burst limit', async () => {
    process.env.FLAGS_REPORTER_DAILY_LIMIT = '50';
    try {
      const refs = await Promise.all(Array.from({ length: 11 }, target)), browserHash = randomUUID();
      for (const ref of refs.slice(0, 10)) await flags.submitPublicFlag(reporter({ browserHash }), input(ref));
      await expect(flags.submitPublicFlag(reporter({ browserHash }), input(refs[10]!))).rejects.toThrow('flag_rate_limited');
    } finally { delete process.env.FLAGS_REPORTER_DAILY_LIMIT; }
  });
  it('suppresses exact resolved repeats without adding a reporter to private history', async () => {
    const ref = await target();
    const first = await flags.submitPublicFlag(reporter(), input(ref));
    await flags.resolveFlag({ userId: admin, role: 'admin' }, first.flagItemId!, { accept: false, reason: 'Private curator reasoning' });
    expect(await flags.submitPublicFlag(reporter(), input(ref))).toEqual({ state: 'already_reviewed' });
    expect(await db.select().from(s.flagSubmissions).where(eq(s.flagSubmissions.flagItemId, first.flagItemId!))).toHaveLength(1);
    expect((await flags.submitPublicFlag(reporter(), input(ref, 'New evidence on page 3'))).state).toBe('accepted');
    expect(await flags.submitPublicFlag(reporter(), input(ref))).toEqual({ state: 'already_reviewed' });
  });
  it('allows a previously resolved report after the displayed field changes', async () => {
    const ref = await target();
    const first = await flags.submitPublicFlag(reporter(), input(ref));
    await flags.resolveFlag({ userId: admin, role: 'admin' }, first.flagItemId!, { accept: false, reason: 'checked' });
    await db.insert(s.candidateFields).values({ candidateId: Number(ref.split(':')[1]), fieldKey: 'age', valueEn: 'Different value', valueKn: 'ಬದಲಾವಣೆ', sourceUrl: 'https://example.com' });
    expect((await flags.submitPublicFlag(reporter(), input(ref))).state).toBe('accepted');
  });
});

describe('multi-target admission', () => {
  async function candidate() {
    const [c] = await db.insert(s.candidates).values({ slug: randomUUID(), wardId, nameEn: 'Demo (FICTIONAL)', partyEn: 'Demo Party A' }).returning();
    return c!.id;
  }
  const field = (id: number, key: string, detail = `The ${key} is wrong`) => ({ targetType: 'candidate_field' as const, targetRef: `candidate:${id}:${key}`, detail });

  it('files one submission per target under a single admission, partial duplicates reported per target', async () => {
    const id = await candidate(), who = reporter();
    await flags.submitPublicFlags(who, [field(id, 'age')]);
    const out = await flags.submitPublicFlags(who, [field(id, 'age'), field(id, 'party'), { targetType: 'candidate_other', targetRef: `candidate:${id}:other`, detail: 'Wrong person' }]);
    expect(out.map(o => o.state)).toEqual(['duplicate', 'accepted', 'accepted']);
    const [n] = await db.execute(sql`select count(*)::int as n from flag_admissions where browser_hash=${who.browserHash}`);
    expect(n!.n).toBe(2);
  });
  it('writes nothing when the limit is hit, and carries a retry hint', async () => {
    const id = await candidate(), who = reporter();
    await db.execute(sql`insert into flag_admissions(browser_hash,network_hash,created_at) select ${who.browserHash},${who.networkHash},now()-interval '9 minutes' from generate_series(1,10)`);
    process.env.FLAGS_REPORTER_DAILY_LIMIT = '50';
    try {
      const err = await flags.submitPublicFlags(who, [field(id, 'age'), field(id, 'party')]).catch(e => e);
      expect(err.message).toBe('flag_rate_limited');
      expect(err.retryAfterSeconds).toBeGreaterThan(30); expect(err.retryAfterSeconds).toBeLessThanOrEqual(60);
    } finally { delete process.env.FLAGS_REPORTER_DAILY_LIMIT; }
    expect(await db.select().from(s.flagItems).where(sql`target_ref like ${`candidate:${id}:%`}`)).toHaveLength(0);
  });
  it('the daily limit governs when it is the later to clear', async () => {
    const id = await candidate(), who = reporter();
    await db.execute(sql`insert into flag_admissions(browser_hash,network_hash,created_at) select ${who.browserHash},${who.networkHash},now()-interval '23 hours' from generate_series(1,10)`);
    const err = await flags.submitPublicFlags(who, [field(id, 'age')]).catch(e => e);
    expect(err.retryAfterSeconds).toBeGreaterThan(3000); expect(err.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });
  it('rejects targets of different candidates, repeats, and an other-kind field ref', async () => {
    const a = await candidate(), b = await candidate(), who = reporter();
    await expect(flags.submitPublicFlags(who, [field(a, 'age'), field(b, 'age')])).rejects.toThrow('invalid_flag_target');
    await expect(flags.submitPublicFlags(who, [field(a, 'age'), field(a, 'age')])).rejects.toThrow('invalid_flag_target');
    await expect(flags.submitPublicFlags(who, [{ targetType: 'candidate_other', targetRef: `candidate:${a}:age`, detail: 'x' }])).rejects.toThrow('invalid_flag_target');
  });
  it('an Other flag can be dismissed and shows no fix in the queue item', async () => {
    const id = await candidate(), who = reporter();
    const [out] = await flags.submitPublicFlags(who, [{ targetType: 'candidate_other', targetRef: `candidate:${id}:other`, detail: 'The scan is unreadable' }]);
    const { loadQueueItem, loadQueueList } = await import('../../src/lib/curator');
    const item = await loadQueueItem(out!.flagItemId!);
    expect(item!.targetType).toBe('candidate_other'); expect(item!.fieldKey).toBe('other'); expect(item!.fix).toEqual({ kind: 'none' });
    expect((await loadQueueList('recent', 1)).find(i => i.id === out!.flagItemId)?.fieldKey).toBe('other');
    await flags.resolveFlag({ userId: admin, role: 'admin' }, out!.flagItemId!, { accept: false, reason: 'Not a data error' });
    expect((await loadQueueItem(out!.flagItemId!))!.status).toBe('rejected');
  });
});

describe('curator abuse controls', () => {
  it('marks only selected submissions as spam and preserves a legitimate report', async () => {
    const ref = await target();
    const bad = await flags.submitPublicFlag(reporter(), input(ref,'Spam'));
    await flags.submitPublicFlag(reporter(), input(ref,'Affidavit page 4 contradicts the age'));
    const rows = await db.select().from(s.flagSubmissions).where(eq(s.flagSubmissions.flagItemId,bad.flagItemId!));
    await flags.markFlagSpam({ userId:admin,role:'admin' },bad.flagItemId!,[rows[0]!.id],'Repeated irrelevant content');
    const [item] = await db.select().from(s.flagItems).where(eq(s.flagItems.id,bad.flagItemId!));
    expect(item!.status).toBe('pending');
    await flags.markFlagSpam({ userId:admin,role:'admin' },bad.flagItemId!,[rows[1]!.id],'Also irrelevant');
    const [closed] = await db.select().from(s.flagItems).where(eq(s.flagItems.id,bad.flagItemId!));
    expect(closed!.status).toBe('rejected');
  });
  it('rejects moderation IDs belonging to another item', async () => {
    const a = await flags.submitPublicFlag(reporter(), input(await target()));
    const b = await flags.submitPublicFlag(reporter(), input(await target()));
    const [row] = await db.select().from(s.flagSubmissions).where(eq(s.flagSubmissions.flagItemId,b.flagItemId!));
    await expect(flags.markFlagSpam({ userId:admin,role:'admin' },a.flagItemId!,[row!.id],'spam')).rejects.toThrow('invalid_spam_selection');
  });
  it('cleans expired abuse metadata', async () => {
    const abuse = await import('../../src/lib/flag-abuse');
    const result = await flags.submitPublicFlag(reporter(),input(await target()));
    await db.execute(sql`update flag_submissions set created_at=now()-interval '31 days' where flag_item_id=${result.flagItemId!}`);
    await db.execute(sql`insert into flag_admissions(network_hash,created_at) values('expired-network',now()-interval '49 hours')`);
    await abuse.cleanupFlagAbuse();
    const [row] = await db.select().from(s.flagSubmissions).where(eq(s.flagSubmissions.flagItemId,result.flagItemId!));
    expect(row!.browserHash).toBeNull(); expect(row!.detail).toBeTruthy();
    expect(await db.execute(sql`select * from flag_admissions where network_hash='expired-network'`)).toHaveLength(0);
  });
});

describe('report budgets and bounded review', () => {
  it('enforces the rolling daily limit independently of the burst allowance', async () => {
    const who=reporter();
    await db.execute(sql`insert into flag_admissions(browser_hash,network_hash,created_at) select ${who.browserHash},${who.networkHash},now()-interval '1 hour' from generate_series(1,10)`);
    await expect(flags.submitPublicFlag(who,input(await target()))).rejects.toThrow('flag_rate_limited');
    await db.execute(sql`update flag_admissions set created_at=now()-interval '25 hours' where browser_hash=${who.browserHash}`);
    expect((await flags.submitPublicFlag(who,input(await target()))).state).toBe('accepted');
  });
  it('permits multiple browsers on a network but caps new reports at 100', async () => {
    const networkHash=randomUUID();
    await db.execute(sql`insert into flag_admissions(network_hash) select ${networkHash} from generate_series(1,99)`);
    expect((await flags.submitPublicFlag(reporter({networkHash}),input(await target()))).state).toBe('accepted');
    await expect(flags.submitPublicFlag(reporter({networkHash}),input(await target()))).rejects.toThrow('flag_rate_limited');
  });
  it('bounds queue pages to 50 and submission pages to 20 with no overlap', async () => {
    const refs=await Promise.all(Array.from({length:51},target));
    const items=await db.insert(s.flagItems).values(refs.map(targetRef=>({wardId,targetType:'candidate_field' as const,targetRef}))).returning();
    await db.insert(s.flagSubmissions).values(Array.from({length:21},(_,i)=>({flagItemId:items[0]!.id,detail:`Test report ${i}`})));
    const {loadQueueList,loadQueueItem}=await import('../../src/lib/curator');
    const first=await loadQueueList('recent',1), second=await loadQueueList('recent',2);
    expect(first).toHaveLength(50); expect(second.length).toBeGreaterThan(0);
    expect(second.some(item=>first.some(prior=>prior.id===item.id))).toBe(false);
    const a=await loadQueueItem(items[0]!.id,1), b=await loadQueueItem(items[0]!.id,2);
    expect(a!.submissions).toHaveLength(20); expect(a!.hasMore).toBe(true);
    expect(b!.submissions).toHaveLength(1); expect(b!.hasMore).toBe(false);
  });
  it('records aggregate counters without reporter identifiers', async () => {
    const {loadFlagMetrics}=await import('../../src/lib/flag-abuse');
    const snapshot=await loadFlagMetrics();
    expect(snapshot.counts.accepted).toBeGreaterThan(0);
    expect(snapshot.counts.spam).toBeGreaterThan(0);
    expect(snapshot.pending).toBeGreaterThan(0);
    // The oldest pending report is a real moment (the console formats it), not raw SQL text.
    expect(snapshot.oldest).toBeInstanceOf(Date);
    expect(Number.isNaN(snapshot.oldest!.getTime())).toBe(false);
    expect(snapshot.oldest!.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(JSON.stringify(snapshot)).not.toContain('browserHash');
  });
});

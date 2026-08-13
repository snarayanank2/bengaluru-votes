import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { SESSION_SECRET } from '../../src/lib/session';

// Mock the transports so no real network call ever happens, and so we can
// both control success/failure per test and capture the plaintext code that
// requestOtp hands to the sender (the code is only ever persisted hashed).
vi.mock('../../src/lib/send/sendgrid', () => ({ sendEmail: vi.fn() }));
vi.mock('../../src/lib/send/twilio', () => ({ sendWhatsAppTemplate: vi.fn() }));

import { sendEmail } from '../../src/lib/send/sendgrid';
import { sendWhatsAppTemplate } from '../../src/lib/send/twilio';
import {
  requestOtp,
  verifyOtp,
  OTP_DAILY_SEND_BUDGET,
  OTP_HOURLY_LIMIT,
  OTP_DESTINATION_DAILY_CAP,
} from '../../src/lib/otp';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// Distinctive, task-specific destinations so this suite never collides with
// another test file's fixtures in the shared test DB.
const D = {
  sent: 'otp-unit-sent@example.com',
  minute: 'otp-unit-minute-cooldown@example.com',
  hour: 'otp-unit-hour-cooldown@example.com',
  daily: 'otp-unit-daily-cooldown@example.com',
  budget: 'otp-unit-budget-exhausted@example.com',
  whatsappNotConfigured: '+919000000001',
  suppressed: 'otp-unit-suppressed@example.com',
  budgetNotConsumedOnCooldown: 'otp-unit-budget-not-consumed-on-cooldown@example.com',
  verifyAuth: 'otp-unit-verify-auth@example.com',
  verifyAddContact: 'otp-unit-verify-add-contact@example.com',
  verifyAttempts: 'otp-unit-verify-attempts@example.com',
  verifyExpired: 'otp-unit-verify-expired@example.com',
  verifyUnknown: 'otp-unit-verify-unknown@example.com',
  verifyPeek: 'otp-unit-verify-peek@example.com',
  verifyProbe: 'otp-unit-verify-probe-lock@example.com',
};

const ALL_DESTINATIONS = Object.values(D);

function expectedHash(code: string): string {
  return createHash('sha256').update(code + SESSION_SECRET).digest('hex');
}

async function rowsFor(destination: string) {
  return db.select().from(schema.otpCodes).where(eq(schema.otpCodes.destination, destination));
}

/** Inserts a fixture otp_codes row directly, bypassing requestOtp, with a caller-controlled createdAt/expiresAt/attempts — this is how cooldown/lock/expiry scenarios are simulated without needing to fake the DB server's clock. */
async function insertFixtureRow(opts: {
  destination: string;
  code: string;
  channel?: 'email' | 'whatsapp';
  purpose?: 'auth' | 'add_contact';
  userId?: number | null;
  createdAt?: Date;
  expiresAt?: Date;
  attempts?: number;
  consumedAt?: Date | null;
}): Promise<number> {
  const now = new Date();
  const [row] = await db
    .insert(schema.otpCodes)
    .values({
      destination: opts.destination,
      channel: opts.channel ?? 'email',
      purpose: opts.purpose ?? 'auth',
      userId: opts.userId ?? null,
      codeHash: expectedHash(opts.code),
      attempts: opts.attempts ?? 0,
      createdAt: opts.createdAt ?? now,
      expiresAt: opts.expiresAt ?? new Date(now.getTime() + 10 * 60 * 1000),
      consumedAt: opts.consumedAt ?? null,
    })
    .returning({ id: schema.otpCodes.id });
  return row!.id;
}

async function todayUtc(): Promise<string> {
  return new Date().toISOString().slice(0, 10);
}

/** Current value of today's global otp_send budget counter (0 if no row yet). */
async function otpSendBudgetCount(): Promise<number> {
  const day = await todayUtc();
  const [row] = await db
    .select({ count: schema.budgetCounters.count })
    .from(schema.budgetCounters)
    .where(and(eq(schema.budgetCounters.kind, 'otp_send'), eq(schema.budgetCounters.day, day)));
  return row?.count ?? 0;
}

describe('src/lib/otp.ts', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => {
    for (const destination of ALL_DESTINATIONS) {
      await db.delete(schema.otpCodes).where(eq(schema.otpCodes.destination, destination));
      await db.delete(schema.suppressions).where(eq(schema.suppressions.contact, destination));
    }
    await db.delete(schema.budgetCounters).where(eq(schema.budgetCounters.kind, 'otp_send'));
    await client.end();
  });

  beforeEach(async () => {
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendWhatsAppTemplate).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ ok: true });
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ ok: true, status: 'sent' });

    for (const destination of ALL_DESTINATIONS) {
      await db.delete(schema.otpCodes).where(eq(schema.otpCodes.destination, destination));
      await db.delete(schema.suppressions).where(eq(schema.suppressions.contact, destination));
    }
    await db.delete(schema.budgetCounters).where(eq(schema.budgetCounters.kind, 'otp_send'));
  });

  describe('requestOtp', () => {
    it("'sent': creates exactly one otp_codes row whose hash matches sha256(code + SESSION_SECRET) for the code handed to sendEmail", async () => {
      const status = await requestOtp(D.sent, 'email', 'auth');
      expect(status).toBe('sent');

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, , html] = vi.mocked(sendEmail).mock.calls[0]!;
      const codeMatch = /(\d{6})/.exec(html);
      expect(codeMatch).not.toBeNull();
      const code = codeMatch![1]!;

      const rows = await rowsFor(D.sent);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.codeHash).toBe(expectedHash(code));
      expect(rows[0]!.attempts).toBe(0);
      expect(rows[0]!.consumedAt).toBeNull();
    });

    it("1/minute cooldown: a send within the last 60s -> 'already_sent', no new row, and the earlier code STILL VERIFIES", async () => {
      const priorCode = '123456';
      await insertFixtureRow({ destination: D.minute, code: priorCode, createdAt: new Date() });

      const status = await requestOtp(D.minute, 'email', 'auth');
      expect(status).toBe('already_sent');
      expect(sendEmail).not.toHaveBeenCalled();

      const rows = await rowsFor(D.minute);
      expect(rows).toHaveLength(1); // no new row was created

      const verify = await verifyOtp(D.minute, priorCode);
      expect(verify).toEqual({ ok: true, userId: null });
    });

    it("5/hour cooldown: 5 sends spread >60s apart, a 6th within the hour -> 'already_sent', earlier codes stay valid", async () => {
      const now = Date.now();
      const codes: string[] = [];
      for (let i = 0; i < OTP_HOURLY_LIMIT; i++) {
        const code = String(100000 + i);
        codes.push(code);
        // Spread 61s apart, all within the trailing hour, none within the trailing minute of "now".
        const createdAt = new Date(now - (OTP_HOURLY_LIMIT - i) * 61_000);
        await insertFixtureRow({ destination: D.hour, code, createdAt });
      }

      const status = await requestOtp(D.hour, 'email', 'auth');
      expect(status).toBe('already_sent');
      expect(sendEmail).not.toHaveBeenCalled();

      const rows = await rowsFor(D.hour);
      expect(rows).toHaveLength(OTP_HOURLY_LIMIT); // no new row was created

      // The cooldown never invalidated the code actually sitting in the
      // destination's inbox: the MOST RECENTLY sent code (the last one
      // issued before the cooldown started refusing new sends) still
      // verifies. verifyOtp only ever considers the single most recent
      // unconsumed row per destination — "the earlier code stays valid"
      // (architecture §13) means that one current code, not every
      // historical send.
      const mostRecentCode = codes[codes.length - 1]!;
      const verify = await verifyOtp(D.hour, mostRecentCode);
      expect(verify).toEqual({ ok: true, userId: null });
    });

    it("daily cap: OTP_DESTINATION_DAILY_CAP sends spread across separate hours -> the next request is 'cooldown_daily'", async () => {
      const now = Date.now();
      for (let i = 0; i < OTP_DESTINATION_DAILY_CAP; i++) {
        // Spread 90 minutes apart -> all outside the trailing-hour window (so
        // the 5/hour cooldown never trips) but all within the trailing 24h
        // window (so the daily cap counts every one of them).
        const createdAt = new Date(now - (OTP_DESTINATION_DAILY_CAP - i) * 90 * 60_000);
        await insertFixtureRow({ destination: D.daily, code: String(200000 + i), createdAt });
      }

      const status = await requestOtp(D.daily, 'email', 'auth');
      expect(status).toBe('cooldown_daily');
      expect(sendEmail).not.toHaveBeenCalled();

      const rows = await rowsFor(D.daily);
      expect(rows).toHaveLength(OTP_DESTINATION_DAILY_CAP); // no new row was created
    });

    it("budget exhausted: pre-filling today's otp_send counter to the daily budget -> 'budget_exhausted', no row created, cooldown checks did not consume budget for an unrelated destination", async () => {
      await db.insert(schema.budgetCounters).values({
        day: await todayUtc(),
        kind: 'otp_send',
        count: OTP_DAILY_SEND_BUDGET,
      });

      const status = await requestOtp(D.budget, 'email', 'auth');
      expect(status).toBe('budget_exhausted');
      expect(sendEmail).not.toHaveBeenCalled();

      const rows = await rowsFor(D.budget);
      expect(rows).toHaveLength(0);
    });

    it("whatsapp not_configured -> 'send_failed', and no code row is left behind (nothing was actually delivered)", async () => {
      vi.mocked(sendWhatsAppTemplate).mockResolvedValueOnce({ ok: false, status: 'not_configured' });

      const status = await requestOtp(D.whatsappNotConfigured, 'whatsapp', 'auth');
      expect(status).toBe('send_failed');

      const rows = await rowsFor(D.whatsappNotConfigured);
      expect(rows).toHaveLength(0);
    });

    it("a suppressed destination+channel -> 'suppressed', no send attempted, no row created", async () => {
      await db.insert(schema.suppressions).values({
        contact: D.suppressed,
        channel: 'email',
        reason: 'bounce',
      });

      const status = await requestOtp(D.suppressed, 'email', 'auth');
      expect(status).toBe('suppressed');
      expect(sendEmail).not.toHaveBeenCalled();

      const rows = await rowsFor(D.suppressed);
      expect(rows).toHaveLength(0);
    });

    it("a 1/minute-cooldown-blocked request ('already_sent') does NOT consume the global otp_send budget (cooldown-then-budget ordering, architecture §13 'cost amplification')", async () => {
      await insertFixtureRow({ destination: D.budgetNotConsumedOnCooldown, code: '999999', createdAt: new Date() });

      const before = await otpSendBudgetCount();
      expect(before).toBe(0); // budgetCounters is cleared for 'otp_send' in beforeEach, so this is a known baseline

      const status = await requestOtp(D.budgetNotConsumedOnCooldown, 'email', 'auth');
      expect(status).toBe('already_sent');
      expect(sendEmail).not.toHaveBeenCalled();

      const after = await otpSendBudgetCount();
      expect(after).toBe(before); // consumeBudget('otp_send', ...) was never reached
    });
  });

  describe('verifyOtp', () => {
    it('correct code (auth purpose, no userId on the row) -> {ok:true, userId:null}', async () => {
      await insertFixtureRow({ destination: D.verifyAuth, code: '111111', purpose: 'auth' });
      const result = await verifyOtp(D.verifyAuth, '111111');
      expect(result).toEqual({ ok: true, userId: null });
    });

    it('correct code (add_contact purpose, userId set on the row) -> {ok:true, userId}', async () => {
      await insertFixtureRow({
        destination: D.verifyAddContact,
        code: '222222',
        purpose: 'add_contact',
        userId: 777,
      });
      const result = await verifyOtp(D.verifyAddContact, '222222');
      expect(result).toEqual({ ok: true, userId: 777 });
    });

    it('wrong code increments attempts and returns invalid; the 5th wrong attempt locks the code; a 6th attempt with the RIGHT code is still locked', async () => {
      const correctCode = '333333';
      await insertFixtureRow({ destination: D.verifyAttempts, code: correctCode });

      for (let attempt = 1; attempt <= 4; attempt++) {
        const result = await verifyOtp(D.verifyAttempts, '000000');
        expect(result).toEqual({ ok: false, reason: 'invalid' });
      }

      // 5th wrong attempt -> locked.
      const fifth = await verifyOtp(D.verifyAttempts, '000000');
      expect(fifth).toEqual({ ok: false, reason: 'locked' });

      const [row] = await rowsFor(D.verifyAttempts);
      expect(row!.attempts).toBe(5);

      // 6th attempt, even with the correct code, is still locked (invalidated).
      const sixth = await verifyOtp(D.verifyAttempts, correctCode);
      expect(sixth).toEqual({ ok: false, reason: 'locked' });
    });

    it('an expired (unconsumed) code -> {ok:false, reason:"expired"}', async () => {
      await insertFixtureRow({
        destination: D.verifyExpired,
        code: '444444',
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
        expiresAt: new Date(Date.now() - 10 * 60 * 1000),
      });

      const result = await verifyOtp(D.verifyExpired, '444444');
      expect(result).toEqual({ ok: false, reason: 'expired' });
    });

    it('an unknown destination (no otp_codes rows at all) -> {ok:false, reason:"invalid"}', async () => {
      const result = await verifyOtp(D.verifyUnknown, '555555');
      expect(result).toEqual({ ok: false, reason: 'invalid' });
    });

    it('{consume:false} ("peek", Task 27 auth-flow.ts) matches the code but leaves it unconsumed, so a SECOND verify with the same code still succeeds', async () => {
      const code = '666666';
      await insertFixtureRow({ destination: D.verifyPeek, code });

      const peek = await verifyOtp(D.verifyPeek, code, { consume: false });
      expect(peek).toEqual({ ok: true, userId: null });

      const [row] = await rowsFor(D.verifyPeek);
      expect(row!.consumedAt).toBeNull(); // NOT consumed by the peek

      // The default (consume:true) call finalizes it — same code, still valid.
      const final = await verifyOtp(D.verifyPeek, code);
      expect(final).toEqual({ ok: true, userId: null });

      const [rowAfter] = await rowsFor(D.verifyPeek);
      expect(rowAfter!.consumedAt).not.toBeNull();

      // A THIRD call with the same (now-consumed) code fails: there is no
      // longer an unconsumed row for this destination.
      const third = await verifyOtp(D.verifyPeek, code);
      expect(third).toEqual({ ok: false, reason: 'invalid' });
    });

    it('a WRONG code in consume:false (probe) mode still increments attempts and locks at 5 (security: probe cannot be abused for unlimited guesses)', async () => {
      const correctCode = '777777';
      const wrongCode = '000000';
      await insertFixtureRow({ destination: D.verifyProbe, code: correctCode });

      // Five wrong attempts with consume:false should all increment attempts.
      for (let attempt = 1; attempt <= 4; attempt++) {
        const result = await verifyOtp(D.verifyProbe, wrongCode, { consume: false });
        expect(result).toEqual({ ok: false, reason: 'invalid' });
        const [row] = await rowsFor(D.verifyProbe);
        expect(row!.attempts).toBe(attempt);
      }

      // 5th wrong attempt -> locked.
      const fifth = await verifyOtp(D.verifyProbe, wrongCode, { consume: false });
      expect(fifth).toEqual({ ok: false, reason: 'locked' });
      const [rowAfterFifth] = await rowsFor(D.verifyProbe);
      expect(rowAfterFifth!.attempts).toBe(5);

      // 6th attempt with the CORRECT code is still locked (invalidated).
      const sixth = await verifyOtp(D.verifyProbe, correctCode, { consume: true });
      expect(sixth).toEqual({ ok: false, reason: 'locked' });
    });
  });

  describe('privacy: destination/code are never logged', () => {
    it('requestOtp and verifyOtp calls never write the destination or the plaintext code to console.log', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const destination = 'otp-unit-privacy-check@example.com';

      await requestOtp(destination, 'email', 'auth');
      const rows = await rowsFor(destination);
      await verifyOtp(destination, '000000'); // wrong code, still must not log destination

      const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).not.toContain(destination);

      await db.delete(schema.otpCodes).where(eq(schema.otpCodes.destination, destination));
      logSpy.mockRestore();
      expect(rows).toHaveLength(1);
    });
  });
});

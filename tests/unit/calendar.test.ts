/**
 * Task 54 — src/lib/send/calendar.ts: the campaign calendar runner.
 *
 * Two layers of coverage, matching the module's own split:
 *   1. PURE — `scheduleFor`/`dueSends`/`guardrailViolations` need no DB at
 *      all (no `describe` block below touches the database for these).
 *   2. DB-BACKED — `runCampaign`'s ward-gating, send-time audience
 *      resolution, held-row writing, and (the most important case) the
 *      held->terminal UPGRADE fix to `recordSend` (src/lib/send/send.ts).
 *
 * `runCampaign`'s audience query is GLOBAL (every active user with a home
 * ward, not scoped to any one ward), so assertions below are always scoped
 * to THIS suite's own user ids / ward ids / contacts — never to a mocked
 * transport's raw global call count, which stray fixtures from other
 * (properly-cleaned-up) test files could otherwise pollute. Distinctive
 * fixtures (ward ids 94100-94104, `calendar-test-*` emails) are reset
 * before/after every test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq, inArray, like, notInArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

vi.mock('../../src/lib/send/sendgrid', () => ({ sendEmail: vi.fn() }));
vi.mock('../../src/lib/send/twilio', () => ({ sendWhatsAppTemplate: vi.fn() }));

import { sendEmail } from '../../src/lib/send/sendgrid';
import { sendWhatsAppTemplate } from '../../src/lib/send/twilio';
import { scheduleFor, dueSends, guardrailViolations, runCampaign } from '../../src/lib/send/calendar';
import * as sendModule from '../../src/lib/send/send';
import * as readinessModule from '../../src/lib/readiness';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

// ---------------------------------------------------------------------------
// Pure scheduling / guardrail tests — no DB.
// ---------------------------------------------------------------------------

describe('src/lib/send/calendar.ts — scheduleFor (pure)', () => {
  it('computes each code\'s fire date from its anchor, exactly', () => {
    const schedule = scheduleFor({
      roll_deadline: '2026-09-01',
      scrutiny_complete_date: '2026-09-10',
      election_date: '2026-09-20',
    });
    const byCode = Object.fromEntries(schedule.map((s) => [s.code, s.fireAt.toISOString()]));

    expect(byCode.R1).toBe('2026-08-25T00:00:00.000Z'); // roll_deadline - 7d
    expect(byCode.L1).toBe('2026-09-10T00:00:00.000Z'); // scrutiny_complete_date itself
    expect(byCode.C1).toBe('2026-08-30T00:00:00.000Z'); // election_date - 21d
    expect(byCode.C2).toBe('2026-09-06T00:00:00.000Z'); // election_date - 14d
    expect(byCode.C3).toBe('2026-09-13T00:00:00.000Z'); // election_date - 7d
    expect(byCode.F1).toBe('2026-09-17T00:00:00.000Z'); // election_date - 3d
  });

  it('omits a code whose anchor is missing or unparseable, without error', () => {
    expect(scheduleFor({})).toEqual([]);

    const badRoll = scheduleFor({ roll_deadline: 'not-a-date', election_date: '2026-09-20' });
    expect(badRoll.find((s) => s.code === 'R1')).toBeUndefined();
    expect(badRoll.map((s) => s.code).sort()).toEqual(['C1', 'C2', 'C3', 'F1']);

    const onlyElection = scheduleFor({ election_date: '2026-09-20' });
    expect(onlyElection.map((s) => s.code).sort()).toEqual(['C1', 'C2', 'C3', 'F1']);
  });
});

describe('src/lib/send/calendar.ts — dueSends (pure)', () => {
  it('a code is due exactly when fireAt <= now: before -> not due, on/after -> due', () => {
    const settings = { roll_deadline: '2026-09-01' }; // R1 fireAt = 2026-08-25T00:00:00.000Z

    expect(dueSends(new Date('2026-08-24T23:59:59.999Z'), settings)).not.toContain('R1');
    expect(dueSends(new Date('2026-08-25T00:00:00.000Z'), settings)).toContain('R1'); // exact boundary
    expect(dueSends(new Date('2026-08-26T00:00:00.000Z'), settings)).toContain('R1');
  });
});

describe('src/lib/send/calendar.ts — guardrailViolations (pure, PRD §9.2)', () => {
  it('a correctly-configured calendar (fixed C1..F1 offsets) never trips', () => {
    const settings = {
      roll_deadline: '2026-09-01',
      scrutiny_complete_date: '2026-08-01',
      election_date: '2026-09-20',
    };
    expect(guardrailViolations(settings)).toEqual([]);
  });

  it('flags L1 when a misconfigured scrutiny_complete_date lands inside the 48h pre-poll-close window', () => {
    // election_date (poll close) = Sep 20 00:00Z; window start = Sep 18 00:00Z.
    // scrutiny_complete_date = Sep 19 -> L1 fireAt = Sep 19 00:00Z, which is
    // > window start -> inside the freeze window -> violation.
    const settings = { scrutiny_complete_date: '2026-09-19', election_date: '2026-09-20' };
    expect(guardrailViolations(settings)).toEqual(['L1']);
  });

  it('the exact 48h boundary itself is safe (fireAt == pollClose - 48h is NOT a violation)', () => {
    const settings = { scrutiny_complete_date: '2026-09-18', election_date: '2026-09-20' };
    expect(guardrailViolations(settings)).toEqual([]);
  });

  it('returns [] when election_date is unset — no poll-close reference to check against', () => {
    expect(guardrailViolations({ scrutiny_complete_date: '2026-09-19' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DB-backed runCampaign tests.
// ---------------------------------------------------------------------------

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-54-specific ward id block, distinct from every other suite's
// (send-to-user.test.ts owns 94052; rate-limit.test.ts owns 94030;
// votes.test.ts owns 94001-94002).
const WARD_READY = { id: 94100, nameEn: 'Calendar Test Ward Ready', nameKn: 'ಕ್ಯಾಲೆಂಡರ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎ', corporation: 'south' as const, zone: 'Zone C', boundaryRef: 'calendar-test-ward-ready' };
const WARD_HELD = { id: 94101, nameEn: 'Calendar Test Ward Held', nameKn: 'ಕ್ಯಾಲೆಂಡರ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಬಿ', corporation: 'south' as const, zone: 'Zone C', boundaryRef: 'calendar-test-ward-held' };
const WARD_UPGRADE = { id: 94102, nameEn: 'Calendar Test Ward Upgrade', nameKn: 'ಕ್ಯಾಲೆಂಡರ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಸಿ', corporation: 'south' as const, zone: 'Zone C', boundaryRef: 'calendar-test-ward-upgrade' };
const WARD_UNGATED = { id: 94103, nameEn: 'Calendar Test Ward Ungated', nameKn: 'ಕ್ಯಾಲೆಂಡರ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಡಿ', corporation: 'south' as const, zone: 'Zone C', boundaryRef: 'calendar-test-ward-ungated' };
const WARD_NO_BOOTH = { id: 94104, nameEn: 'Calendar Test Ward No Booth', nameKn: 'ಕ್ಯಾಲೆಂಡರ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಇ', corporation: 'south' as const, zone: 'Zone C', boundaryRef: 'calendar-test-ward-no-booth' };
const ALL_WARDS = [WARD_READY, WARD_HELD, WARD_UPGRADE, WARD_UNGATED, WARD_NO_BOOTH];
const ALL_WARD_IDS = ALL_WARDS.map((w) => w.id);

const SETTINGS_KEYS = ['roll_deadline', 'scrutiny_complete_date', 'election_date', 'poll_open_time', 'poll_close_time'];

async function setSettings(cfg: Record<string, string | null>): Promise<void> {
  for (const [key, value] of Object.entries(cfg)) {
    if (value === null) {
      await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
    } else {
      await db
        .insert(schema.appSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
    }
  }
}

/**
 * `runCampaign`'s audience query is intentionally GLOBAL (every active user
 * with a home ward, city-wide — that's the real production behaviour this
 * suite is testing). In this shared, long-lived test DB that means a
 * config that makes a gated code due can incidentally write a `'held'`
 * campaign_sends row for a STRAY leftover "active" user from a wholly
 * unrelated suite's fixtures (debris other suites didn't fully clean up
 * from an earlier run) — and since `campaign_sends.user_id` has no
 * `ON DELETE CASCADE`, that row then blocks that OTHER suite's own fixture
 * cleanup with a foreign-key violation the next time it runs. Sweeping up
 * every campaign_sends row outside our own ward ids after every test
 * undoes that collateral write so this suite never leaves the shared DB in
 * a state that breaks somebody else's cleanup. No other suite writes to
 * campaign_sends outside its own already-self-cleaned fixtures (only
 * send-to-user.test.ts does, scoped to its own ward and cleaned there), so
 * this is safe to do unconditionally.
 */
async function sweepStrayCampaignSends(): Promise<void> {
  await db.delete(schema.campaignSends).where(notInArray(schema.campaignSends.wardId, ALL_WARD_IDS));
}

async function resetAll(): Promise<void> {
  await sweepStrayCampaignSends();
  await db.delete(schema.campaignSends).where(inArray(schema.campaignSends.wardId, ALL_WARD_IDS));
  await db.delete(schema.wardReadiness).where(inArray(schema.wardReadiness.wardId, ALL_WARD_IDS));
  await db.delete(schema.candidates).where(inArray(schema.candidates.wardId, ALL_WARD_IDS));
  await db.delete(schema.booths).where(inArray(schema.booths.wardId, ALL_WARD_IDS));
  await db.delete(schema.users).where(like(schema.users.email, 'calendar-test-%'));
  await setSettings(Object.fromEntries(SETTINGS_KEYS.map((k) => [k, null])));
}

let userCounter = 0;
async function makeUser(
  wardId: number,
  opts: Partial<{ language: 'en' | 'kn'; emailEnabled: boolean; whatsappEnabled: boolean }> = {},
) {
  userCounter++;
  const email = `calendar-test-${userCounter}@example.com`;
  const phone = `+9190000${String(10000 + userCounter).slice(-5)}`;
  const [row] = await db
    .insert(schema.users)
    .values({
      email,
      phone,
      homeWardId: wardId,
      language: opts.language ?? 'en',
      emailEnabled: opts.emailEnabled ?? true,
      whatsappEnabled: opts.whatsappEnabled ?? true,
      status: 'active',
    })
    .returning();
  return row!;
}

async function addCandidate(wardId: number, n: number) {
  await db.insert(schema.candidates).values({
    slug: `calendar-test-candidate-${wardId}-${n}`,
    wardId,
    nameEn: `Test Candidate ${n}`,
    partyEn: 'Independent',
    status: 'filed',
  });
}

async function addBooth(wardId: number) {
  await db.insert(schema.booths).values({
    wardId,
    nameEn: 'Test Government School Booth',
    nameKn: 'ಪರೀಕ್ಷಾ ಸರ್ಕಾರಿ ಶಾಲೆ ಬೂತ್',
    address: '1 Test Road, Bengaluru',
    lat: '12.9716',
    lng: '77.5946',
  });
}

async function markReady(wardId: number): Promise<void> {
  await db
    .insert(schema.wardReadiness)
    .values({ wardId, commsHoldOverride: true })
    .onConflictDoUpdate({ target: schema.wardReadiness.wardId, set: { commsHoldOverride: true } });
}

async function sendRowsFor(userId: number, code: string) {
  return db
    .select()
    .from(schema.campaignSends)
    .where(and(eq(schema.campaignSends.userId, userId), eq(schema.campaignSends.code, code as never)));
}

describe('src/lib/send/calendar.ts — runCampaign (DB-backed)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    for (const ward of ALL_WARDS) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: { nameEn: ward.nameEn } });
    }
  });

  afterAll(async () => {
    await resetAll();
    await db.delete(schema.wards).where(inArray(schema.wards.id, ALL_WARD_IDS));
    await client.end();
  });

  beforeEach(async () => {
    await resetAll();
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendWhatsAppTemplate).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ ok: true });
    vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ ok: false, status: 'not_configured' });
  });

  it('L1 (gated): a not-ready ward is HELD (no send); an override-ready ward sends (not held)', async () => {
    await markReady(WARD_READY.id);
    await addCandidate(WARD_READY.id, 1);
    const readyUser = await makeUser(WARD_READY.id);
    const heldUser = await makeUser(WARD_HELD.id);

    const now = new Date('2026-08-01T00:00:00.000Z');
    await setSettings({ scrutiny_complete_date: '2026-07-25', election_date: '2030-01-01' });

    const summary = await runCampaign(now);
    expect(summary.due).toContain('L1');
    expect(summary.guardrailTripped).not.toContain('L1');

    const heldRows = await sendRowsFor(heldUser.id, 'L1');
    expect(heldRows).toHaveLength(2); // email + whatsapp, both eligible
    expect(heldRows.every((r) => r.status === 'held')).toBe(true);
    expect(vi.mocked(sendEmail).mock.calls.some((c) => c[0] === heldUser.email)).toBe(false);

    const readyRows = await sendRowsFor(readyUser.id, 'L1');
    expect(readyRows.find((r) => r.channel === 'email')?.status).toBe('sent');
    expect(vi.mocked(sendEmail).mock.calls.some((c) => c[0] === readyUser.email)).toBe(true);
  });

  it('THE UPGRADE REGRESSION TEST: held -> ward clears -> sent exactly once -> never resent', async () => {
    await addCandidate(WARD_UPGRADE.id, 1);
    const user = await makeUser(WARD_UPGRADE.id);

    const now = new Date('2026-08-01T00:00:00.000Z');
    await setSettings({ scrutiny_complete_date: '2026-07-25', election_date: '2030-01-01' });

    // RUN 1 — ward not ready yet: held, not sent.
    await runCampaign(now);
    let rows = await sendRowsFor(user.id, 'L1');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'held')).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();

    // Ward clears.
    await markReady(WARD_UPGRADE.id);

    // RUN 2 — the held row must be UPGRADED to a terminal status (this is
    // recordSend's onConflictDoUpdate/setWhere fix), not left 'held'.
    await runCampaign(now);
    rows = await sendRowsFor(user.id, 'L1');
    expect(rows).toHaveLength(2); // still exactly 2 rows — UPDATE, not a second INSERT
    const emailRow = rows.find((r) => r.channel === 'email')!;
    const waRow = rows.find((r) => r.channel === 'whatsapp')!;
    expect(emailRow.status).toBe('sent');
    expect(waRow.status).toBe('failed'); // mocked not_configured
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
    const sentAtAfterRun2 = emailRow.sentAt.getTime();

    // RUN 3 — now terminal ('sent'/'failed'): must NOT be resent, and the
    // row must NOT be touched again (send-once holds).
    await runCampaign(now);
    rows = await sendRowsFor(user.id, 'L1');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.channel === 'email')!.status).toBe('sent');
    expect(rows.find((r) => r.channel === 'email')!.sentAt.getTime()).toBe(sentAtAfterRun2);
    expect(sendEmail).toHaveBeenCalledTimes(1); // still 1, not 2
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1); // still 1, not 2
  });

  it('ungated codes (R1, C1, F1) send regardless of ward readiness, with real per-user vars', async () => {
    // WARD_UNGATED is never signed off / never has a commsHoldOverride row.
    const user = await makeUser(WARD_UNGATED.id, { language: 'en' });
    await addBooth(WARD_UNGATED.id);

    // now == F1's fireAt (election_date - 3d) so C1/C2/C3/F1 are all due;
    // roll_deadline chosen so R1's fireAt lands on the same `now`.
    const now = new Date('2026-08-30T00:00:00.000Z');
    await setSettings({
      roll_deadline: '2026-09-06', // R1 fireAt = 2026-08-30
      election_date: '2026-09-02', // F1 fireAt = 2026-08-30 (E-3d)
      poll_open_time: '7:00 AM',
      poll_close_time: '6:00 PM',
    });

    const summary = await runCampaign(now);
    expect(summary.due).toEqual(expect.arrayContaining(['R1', 'C1', 'C2', 'C3', 'F1']));
    expect(summary.guardrailTripped).toEqual([]);

    for (const code of ['R1', 'C1', 'F1']) {
      const rows = await sendRowsFor(user.id, code);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.status !== 'held')).toBe(true); // ungated -> never held
    }

    // The F1 email actually rendered with the real booth name from the DB
    // (not a missing_var throw, not a placeholder) — confirms buildVars
    // resolved the ward's single booth row rather than deferring.
    const f1Call = vi
      .mocked(sendEmail)
      .mock.calls.find((c) => c[0] === user.email && c[1] === 'Your polling booth and what to carry');
    expect(f1Call).toBeDefined();
    expect(f1Call![2]).toContain('Test Government School Booth');
  });

  it('F1 defers (no send, no ledger row) when booth/poll-time data is unavailable — never invents booth or timing facts', async () => {
    const user = await makeUser(WARD_NO_BOOTH.id); // no booths row for this ward, no poll_open_time/poll_close_time set

    const now = new Date('2026-08-30T00:00:00.000Z');
    await setSettings({
      roll_deadline: '2026-09-06', // R1 due
      election_date: '2026-09-02', // C1..F1 due
      // poll_open_time / poll_close_time deliberately left unset
    });

    const summary = await runCampaign(now);
    expect(summary.due).toContain('F1');

    const f1Rows = await sendRowsFor(user.id, 'F1');
    expect(f1Rows).toHaveLength(0); // deferred, not sent, not held, not invented
    expect(summary.perCode.F1?.deferred).toBeGreaterThan(0);

    // R1, which needs no booth data, still sends fine for the same user.
    const r1Rows = await sendRowsFor(user.id, 'R1');
    expect(r1Rows.length).toBeGreaterThan(0);
  });

  it('send-time audience resolution: a user added between two runs is picked up by the second run; the first user is never resent', async () => {
    const userA = await makeUser(WARD_UNGATED.id);

    const now = new Date('2026-08-25T00:00:00.000Z');
    await setSettings({ roll_deadline: '2026-09-01' }); // R1 fireAt = 2026-08-25 == now

    await runCampaign(now);
    expect(vi.mocked(sendEmail).mock.calls.filter((c) => c[0] === userA.email)).toHaveLength(1);

    const userB = await makeUser(WARD_UNGATED.id);
    await runCampaign(now);

    expect(vi.mocked(sendEmail).mock.calls.filter((c) => c[0] === userB.email)).toHaveLength(1);
    // userA was NOT resent by the second run (send-once).
    expect(vi.mocked(sendEmail).mock.calls.filter((c) => c[0] === userA.email)).toHaveLength(1);
  });

  it('a due-but-guardrail-violating code is refused and alarmed: no rows written for it, ever', async () => {
    // WARD_HELD is never signed off/overridden here — irrelevant to this
    // test, since the guardrail check refuses L1 BEFORE readiness is even
    // consulted.
    const user = await makeUser(WARD_HELD.id);

    // election_date (poll close) = Sep 20; scrutiny_complete_date = Sep 19
    // puts L1's fireAt inside the 48h freeze window (see the pure guardrail
    // test above for the exact math). now is well after both, so L1 IS due.
    // (C1-F1, which fire much earlier relative to election_date, are also
    // due at this `now` and are NOT violations — this test only asserts
    // about L1, the code actually misconfigured into the freeze window.)
    const now = new Date('2026-09-25T00:00:00.000Z');
    await setSettings({ scrutiny_complete_date: '2026-09-19', election_date: '2026-09-20' });

    const summary = await runCampaign(now);
    expect(summary.due).toContain('L1');
    expect(summary.guardrailTripped).toEqual(['L1']);
    expect(summary.perCode.L1).toBeUndefined(); // never processed at all — refused before audience resolution

    const rows = await sendRowsFor(user.id, 'L1');
    expect(rows).toHaveLength(0); // no held row, no sent row — refused outright, not just deferred

    // Nothing sent under the L1 subject line specifically (C1/F1, which are
    // due in this same run and unrelated to the guardrail, legitimately do
    // send to this user — that's expected and not what this test checks).
    const l1Subject = 'Candidates have filed in Calendar Test Ward Held ward';
    expect(vi.mocked(sendEmail).mock.calls.some((c) => c[0] === user.email && c[1] === l1Subject)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Task 54 REVIEW FIX: per-user / per-code failure isolation. Neither a
  // single user's nor a single due code's failure may abort the rest of the
  // run — see calendar.ts's runCampaign docstring ("FAILURE ISOLATION").
  // -------------------------------------------------------------------------

  it('PER-USER ISOLATION: one user\'s send throwing does not stop another user in the same due code, and runCampaign resolves', async () => {
    const userGood = await makeUser(WARD_UNGATED.id);
    const userBad = await makeUser(WARD_UNGATED.id);

    const now = new Date('2026-08-25T00:00:00.000Z');
    await setSettings({ roll_deadline: '2026-09-01' }); // R1 fireAt = 2026-08-25 == now (ungated — no readiness gating involved)

    const originalSendToUser = sendModule.sendToUser;
    const spy = vi
      .spyOn(sendModule, 'sendToUser')
      .mockImplementation(async (user, code, vars, opts) => {
        if (user.id === userBad.id) throw new Error('simulated transient failure (e.g. a DB blip)');
        return originalSendToUser(user, code, vars, opts);
      });

    try {
      const summary = await runCampaign(now); // must resolve, not reject

      // The failure is reflected in the summary (perCode.R1.sent isn't
      // asserted here — the audience query is GLOBAL, per the module
      // docstring above, so it also counts stray active users left over
      // from other suites sharing this DB; errors is not, since only our
      // mocked throw produces one).
      expect(summary.perCode.R1?.errors).toBe(1);

      // ...the OTHER user in the same audience was still sent to...
      const goodRows = await sendRowsFor(userGood.id, 'R1');
      expect(goodRows.length).toBeGreaterThan(0);
      expect(vi.mocked(sendEmail).mock.calls.some((c) => c[0] === userGood.email)).toBe(true);

      // ...and the failing user's send never reached recordSend (threw
      // before it), so no ledger row and no transport call for them either.
      const badRows = await sendRowsFor(userBad.id, 'R1');
      expect(badRows).toHaveLength(0);
      expect(vi.mocked(sendEmail).mock.calls.some((c) => c[0] === userBad.email)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('PER-CODE ISOLATION: one due code failing outright does not stop a different due code from processing, and runCampaign resolves', async () => {
    const l1User = await makeUser(WARD_HELD.id); // WARD_HELD's readiness check is the one forced to throw below
    const c1User = await makeUser(WARD_UNGATED.id); // C1 is ungated — never calls isWardReadyForComms, so it's unaffected

    const now = new Date('2026-08-30T00:00:00.000Z');
    await setSettings({
      scrutiny_complete_date: '2026-08-23', // L1 fireAt = 2026-08-23 (due)
      election_date: '2026-09-20', // C1 fireAt = election_date - 21d = 2026-08-30 == now (due); guardrail window starts 2026-09-18, well after both
    });

    const spy = vi.spyOn(readinessModule, 'isWardReadyForComms').mockImplementation(async (wardId: number) => {
      if (wardId === WARD_HELD.id) throw new Error('simulated readiness-check failure (e.g. a DB blip)');
      return false;
    });

    try {
      const summary = await runCampaign(now); // must resolve, not reject

      expect(summary.due).toEqual(expect.arrayContaining(['L1', 'C1']));
      expect(summary.guardrailTripped).toEqual([]);

      // L1's whole-code processing failed outright: never meaningfully
      // processed (perCode entry left unset — the same convention a
      // guardrail refusal already uses), and it's counted in the top-level
      // error total.
      expect(summary.perCode.L1).toBeUndefined();
      expect(summary.errors).toBeGreaterThan(0);
      const l1Rows = await sendRowsFor(l1User.id, 'L1');
      expect(l1Rows).toHaveLength(0); // no held row, no sent row — L1 never got far enough to write one

      // C1 — a DIFFERENT due code in the SAME run — still processed fully,
      // unaffected by L1's failure.
      expect(summary.perCode.C1?.sent).toBeGreaterThan(0);
      const c1Rows = await sendRowsFor(c1User.id, 'C1');
      expect(c1Rows.length).toBeGreaterThan(0);
      expect(vi.mocked(sendEmail).mock.calls.some((c) => c[0] === c1User.email)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

// Mock src/lib/otp entirely: these routes' own logic (validation, the
// login/registration branch, consent-field persistence, one-account
// enforcement, no-store/cookie shape) is what's under test here, not
// requestOtp/verifyOtp's internals (covered by tests/unit/otp.test.ts).
// normalizeDestination is kept as the REAL implementation (not mocked): the
// routes under test call it directly to align users.email/phone lookups and
// inserts with how otp_codes is keyed (Task 25 review Fix 1) — mocking it
// away would hide exactly the case-normalization bug this file also tests.
vi.mock('../../src/lib/otp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/otp')>();
  return { ...actual, requestOtp: vi.fn(), verifyOtp: vi.fn() };
});

// Registration now fires the W1 welcome send (final-review Fix 2). This suite
// tests the OTP/auth routes, not the send path — stub sendToUser so it writes
// no campaign_sends rows (which would otherwise FK-block fixture cleanup).
vi.mock('../../src/lib/send/send', () => ({ sendToUser: vi.fn(async () => ({ results: [] })) }));

import { requestOtp, verifyOtp } from '../../src/lib/otp';
import { POST as requestPOST } from '../../src/pages/api/otp/request';
import { POST as verifyPOST } from '../../src/pages/api/otp/verify';
import { SESSION_COOKIE } from '../../src/lib/session';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward id (task-25 brief) — other route suites own
// 94001/95001/96001/97001-2; this suite owns 98001.
const WARD = {
  id: 98001,
  nameEn: 'OTP Route Test Ward',
  nameKn: 'ಒಟಿಪಿ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'otp-route-test-ward',
};

const KNOWN_EMAIL = 'otp-route-known@example.com';
const UNKNOWN_EMAIL = 'otp-route-unknown@example.com';
const RACE_EMAIL = 'otp-route-race@example.com';
// Task 25 review Fix 1/3 regression fixture: registered with mixed case, then
// looked up/logged-in with a lowercase spelling of the SAME address. Stored
// value is normalized (lowercased), so the fixture-cleanup list below tracks
// the LOWERCASE form (what actually lands in `users.email`).
const MIXED_CASE_EMAIL = 'MixedCase.OtpRoute.User@Example.com';
const MIXED_CASE_EMAIL_LOWER = MIXED_CASE_EMAIL.toLowerCase();
// `app_settings.consent_wording_version` is a GLOBAL singleton row (one
// key, one value) — every test file that seeds it in `beforeAll` upserts
// the SAME row, and vitest runs test files concurrently, so every file
// touching this key must agree on one shared literal (never a
// per-file-unique value) or whichever file's `beforeAll` runs last wins,
// intermittently failing the others. Shared with tests/unit/auth-flow.test.ts
// and tests/routes/login.test.ts (Task 27) — keep all three in sync.
const CONSENT_VERSION = 'shared-test-consent-wording-v1';
const FIXTURE_EMAILS = [KNOWN_EMAIL, UNKNOWN_EMAIL, RACE_EMAIL, MIXED_CASE_EMAIL_LOWER];

function req(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Minimal Astro.cookies stand-in: only `.get(name)` is used by verify.ts. */
function cookiesWithSrc(src: string | undefined) {
  return {
    get: (name: string) => (name === 'bv_src' && src !== undefined ? { value: src } : undefined),
  };
}

/**
 * Deletes only THIS FILE's fixture sessions/users, by looking up the exact
 * user ids first — `sessions` is a table shared by every test file in the
 * suite (run concurrently against one real Postgres instance), so a blanket
 * `delete(schema.sessions)` here would wipe out rows another file (e.g.
 * tests/unit/session.test.ts) created in a concurrently-running worker.
 */
async function resetFixtures(): Promise<void> {
  const fixtureUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.email, FIXTURE_EMAILS));
  const fixtureUserIds = fixtureUsers.map((u) => u.id);
  if (fixtureUserIds.length > 0) {
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, fixtureUserIds));
  }
  await db.delete(schema.users).where(inArray(schema.users.email, FIXTURE_EMAILS));
}

// Migrate/close the shared connection exactly once for the whole file — both
// describe blocks below reuse the same module-level `client`/`db`.
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });

  await db
    .insert(schema.wards)
    .values(WARD)
    .onConflictDoUpdate({ target: schema.wards.id, set: WARD });

  await db
    .insert(schema.appSettings)
    .values({ key: 'consent_wording_version', value: CONSENT_VERSION })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: CONSENT_VERSION } });
});

afterAll(async () => {
  await resetFixtures();
  await client.end();
});

describe('POST /api/otp/request', () => {
  beforeEach(() => {
    vi.mocked(requestOtp).mockReset();
  });

  it.each(['sent', 'already_sent', 'cooldown_daily', 'budget_exhausted', 'suppressed', 'send_failed'] as const)(
    "returns 200 {status:'%s'}, no-store, no cookie",
    async (status) => {
      vi.mocked(requestOtp).mockResolvedValueOnce(status);
      const res = await requestPOST({ request: req('/api/otp/request', { destination: 'x@example.com' }) } as any);

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(await res.json()).toEqual({ status });
    },
  );

  it('defaults channel to email when omitted', async () => {
    vi.mocked(requestOtp).mockResolvedValueOnce('sent');
    await requestPOST({ request: req('/api/otp/request', { destination: 'x@example.com' }) } as any);
    expect(requestOtp).toHaveBeenCalledWith('x@example.com', 'email', 'auth');
  });

  it('passes an explicit whatsapp channel through', async () => {
    vi.mocked(requestOtp).mockResolvedValueOnce('sent');
    await requestPOST({
      request: req('/api/otp/request', { destination: '+919000000002', channel: 'whatsapp' }),
    } as any);
    expect(requestOtp).toHaveBeenCalledWith('+919000000002', 'whatsapp', 'auth');
  });

  it('non-disclosure: a known-contact-shaped destination and an unknown-contact-shaped destination get an IDENTICAL response shape', async () => {
    vi.mocked(requestOtp).mockResolvedValue('sent');

    const known = await requestPOST({ request: req('/api/otp/request', { destination: KNOWN_EMAIL }) } as any);
    const unknown = await requestPOST({ request: req('/api/otp/request', { destination: UNKNOWN_EMAIL }) } as any);

    expect(await known.json()).toEqual(await unknown.json());
    expect(known.status).toBe(unknown.status);
  });

  describe('validation', () => {
    it('rejects a missing destination with 400, no-store', async () => {
      const res = await requestPOST({ request: req('/api/otp/request', {}) } as any);
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('rejects an invalid channel with 400', async () => {
      const res = await requestPOST({
        request: req('/api/otp/request', { destination: 'x@example.com', channel: 'sms' }),
      } as any);
      expect(res.status).toBe(400);
    });

    it('rejects unparsable JSON with 400', async () => {
      const brokenReq = new Request('http://localhost/api/otp/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      });
      const res = await requestPOST({ request: brokenReq } as any);
      expect(res.status).toBe(400);
    });
  });

  describe('privacy: the destination is never logged', () => {
    it('does not appear in any console.log call', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.mocked(requestOtp).mockResolvedValueOnce('sent');
      const secretDestination = 'totally-secret-destination@example.com';

      await requestPOST({ request: req('/api/otp/request', { destination: secretDestination }) } as any);

      const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).not.toContain(secretDestination);
      logSpy.mockRestore();
    });
  });
});

describe('POST /api/otp/verify', () => {
  beforeEach(async () => {
    vi.mocked(verifyOtp).mockReset();
    await resetFixtures();
  });

  it('a wrong/expired/locked OTP result passes reason straight through as 200 {ok:false, reason}, no cookie set', async () => {
    vi.mocked(verifyOtp).mockResolvedValueOnce({ ok: false, reason: 'locked' });

    const res = await verifyPOST({
      request: req('/api/otp/verify', { destination: KNOWN_EMAIL, code: '000000' }),
      cookies: cookiesWithSrc(undefined),
    } as any);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.json()).toEqual({ ok: false, reason: 'locked' });
  });

  it('known contact -> LOGIN: sets the bv_session cookie, registered:false, and does NOT touch consent fields', async () => {
    const [existing] = await db
      .insert(schema.users)
      .values({ email: KNOWN_EMAIL, homeWardId: WARD.id, role: 'citizen', status: 'active' })
      .returning();

    vi.mocked(verifyOtp).mockResolvedValueOnce({ ok: true, userId: null });

    const res = await verifyPOST({
      request: req('/api/otp/verify', { destination: KNOWN_EMAIL, code: '123456' }),
      cookies: cookiesWithSrc('some-partner'),
    } as any);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true, registered: false });

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');

    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, existing!.id));
    expect(row!.consentAt).toBeNull(); // login never (re)writes consent fields
    expect(row!.srcAttribution).toBeNull();
  });

  it('unknown contact + no register payload -> {ok:false, reason:"registration_required"}, no cookie, no user created', async () => {
    vi.mocked(verifyOtp).mockResolvedValueOnce({ ok: true, userId: null });

    const res = await verifyPOST({
      request: req('/api/otp/verify', { destination: UNKNOWN_EMAIL, code: '123456' }),
      cookies: cookiesWithSrc(undefined),
    } as any);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'registration_required' });
    expect(res.headers.get('set-cookie')).toBeNull();

    const rows = await db.select().from(schema.users).where(eq(schema.users.email, UNKNOWN_EMAIL));
    expect(rows).toHaveLength(0);
  });

  it('unknown contact + register payload -> creates the user with consent evidence (consentAt, consentVersion, futureToolsOptIn, srcAttribution from bv_src), sets session, registered:true', async () => {
    vi.mocked(verifyOtp).mockResolvedValueOnce({ ok: true, userId: null });

    const before = Date.now();
    const res = await verifyPOST({
      request: req('/api/otp/verify', {
        destination: UNKNOWN_EMAIL,
        code: '123456',
        register: { wardId: WARD.id, language: 'kn', futureTools: true },
      }),
      cookies: cookiesWithSrc('partner-42'),
    } as any);
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, registered: true });
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);

    const [row] = await db.select().from(schema.users).where(eq(schema.users.email, UNKNOWN_EMAIL));
    expect(row).toBeDefined();
    expect(row!.homeWardId).toBe(WARD.id);
    expect(row!.language).toBe('kn');
    expect(row!.role).toBe('citizen');
    expect(row!.status).toBe('active');
    expect(row!.futureToolsOptIn).toBe(true);
    expect(row!.srcAttribution).toBe('partner-42');
    expect(row!.consentVersion).toBe(CONSENT_VERSION);
    expect(row!.consentAt).not.toBeNull();
    expect(row!.consentAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(row!.consentAt!.getTime()).toBeLessThanOrEqual(after);
  });

  it('registration with no bv_src cookie stores a null srcAttribution', async () => {
    vi.mocked(verifyOtp).mockResolvedValueOnce({ ok: true, userId: null });

    await verifyPOST({
      request: req('/api/otp/verify', {
        destination: UNKNOWN_EMAIL,
        code: '123456',
        register: { wardId: WARD.id, language: 'en', futureTools: false },
      }),
      cookies: cookiesWithSrc(undefined),
    } as any);

    const [row] = await db.select().from(schema.users).where(eq(schema.users.email, UNKNOWN_EMAIL));
    expect(row!.srcAttribution).toBeNull();
    expect(row!.futureToolsOptIn).toBe(false);
  });

  it('one-account-per-contact: registering the same contact twice never creates a duplicate row', async () => {
    vi.mocked(verifyOtp).mockResolvedValue({ ok: true, userId: null });
    const registerBody = {
      destination: RACE_EMAIL,
      code: '123456',
      register: { wardId: WARD.id, language: 'en', futureTools: false },
    };

    const first = await verifyPOST({
      request: req('/api/otp/verify', registerBody),
      cookies: cookiesWithSrc(undefined),
    } as any);
    expect(await first.json()).toEqual({ ok: true, registered: true });

    // Second call for the exact same contact: the endpoint now finds the
    // existing row first and takes the LOGIN branch, never re-inserting.
    const second = await verifyPOST({
      request: req('/api/otp/verify', registerBody),
      cookies: cookiesWithSrc(undefined),
    } as any);
    expect(await second.json()).toEqual({ ok: true, registered: false });

    const rows = await db.select().from(schema.users).where(eq(schema.users.email, RACE_EMAIL));
    expect(rows).toHaveLength(1);
  });

  it('case-insensitive one-account-per-contact (Task 25 review Fix 1): registering with a MIXED-CASE email, then verifying again with the lowercase spelling of the SAME email, logs into the SAME account rather than registering a duplicate', async () => {
    vi.mocked(verifyOtp).mockResolvedValue({ ok: true, userId: null });

    const registerRes = await verifyPOST({
      request: req('/api/otp/verify', {
        destination: MIXED_CASE_EMAIL,
        code: '123456',
        register: { wardId: WARD.id, language: 'en', futureTools: false },
      }),
      cookies: cookiesWithSrc(undefined),
    } as any);
    expect(await registerRes.json()).toEqual({ ok: true, registered: true });

    const [afterRegister] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, MIXED_CASE_EMAIL_LOWER));
    expect(afterRegister).toBeDefined();
    // Stored under the NORMALIZED (lowercased) form, not the mixed-case spelling submitted.
    expect(afterRegister!.email).toBe(MIXED_CASE_EMAIL_LOWER);

    // Same contact, lowercase spelling this time: must resolve to a LOGIN
    // against the account just created, never `registration_required` and
    // never a second `users` row.
    const loginRes = await verifyPOST({
      request: req('/api/otp/verify', { destination: MIXED_CASE_EMAIL_LOWER, code: '123456' }),
      cookies: cookiesWithSrc(undefined),
    } as any);
    expect(await loginRes.json()).toEqual({ ok: true, registered: false });
    expect(loginRes.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`);

    const rows = await db.select().from(schema.users).where(eq(schema.users.email, MIXED_CASE_EMAIL_LOWER));
    expect(rows).toHaveLength(1); // still exactly one row: no duplicate account
    expect(rows[0]!.id).toBe(afterRegister!.id); // same account, not a new one
  });

  describe('validation', () => {
    it('rejects a missing code with 400', async () => {
      const res = await verifyPOST({
        request: req('/api/otp/verify', { destination: KNOWN_EMAIL }),
        cookies: cookiesWithSrc(undefined),
      } as any);
      expect(res.status).toBe(400);
    });

    it('rejects an invalid register payload (bad language) with 400', async () => {
      const res = await verifyPOST({
        request: req('/api/otp/verify', {
          destination: UNKNOWN_EMAIL,
          code: '123456',
          register: { wardId: WARD.id, language: 'xx', futureTools: false },
        }),
        cookies: cookiesWithSrc(undefined),
      } as any);
      expect(res.status).toBe(400);
    });
  });

  describe('privacy: destination/code are never logged', () => {
    it('does not appear in any console.log call across the login and registration branches', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.mocked(verifyOtp).mockResolvedValue({ ok: true, userId: null });
      const secretDestination = 'totally-secret-verify-destination@example.com';
      const secretCode = '987654';

      await verifyPOST({
        request: req('/api/otp/verify', {
          destination: secretDestination,
          code: secretCode,
          register: { wardId: WARD.id, language: 'en', futureTools: false },
        }),
        cookies: cookiesWithSrc(undefined),
      } as any);

      const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).not.toContain(secretDestination);
      expect(logged).not.toContain(secretCode);

      const [secretUser] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, secretDestination));
      if (secretUser) {
        await db.delete(schema.sessions).where(eq(schema.sessions.userId, secretUser.id));
      }
      await db.delete(schema.users).where(eq(schema.users.email, secretDestination));
      logSpy.mockRestore();
    });
  });
});

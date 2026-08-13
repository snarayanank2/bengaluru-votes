/**
 * POST /api/eoi (Task 50) — the one anonymous write path (IA §3.15, PRD
 * §5.13/§6.3, architecture.md §7/§13). Same technique as
 * tests/routes/flags.test.ts: exercise the real handler against a real DB,
 * mocking only src/lib/recaptcha's `verifyRecaptcha` (no real Google call,
 * ever, in tests).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. CI always sets this; for local runs export ' +
      'DATABASE_URL=postgres://postgres@localhost:54329/bv_test (see task brief).',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 5 });
const db = drizzle(client, { schema });

vi.mock('../../src/lib/recaptcha', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/recaptcha')>();
  return { ...actual, verifyRecaptcha: vi.fn() };
});

import { verifyRecaptcha } from '../../src/lib/recaptcha';
import { POST as eoiPOST } from '../../src/pages/api/eoi';
import { onRequest } from '../../src/middleware';

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

function req(body: unknown): Request {
  return new Request('http://localhost/api/eoi', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    path: 'awareness',
    name: 'Task 50 Test RWA',
    organisation: 'Task 50 Test RWA Federation',
    contact: 'eoi-route-test@example.org',
    wardsText: 'Wards 12, 34',
    message: 'We would like to help spread the word.',
    recaptchaToken: 'test-token',
    ...overrides,
  };
}

async function eoiRowsFor(contact: string) {
  return db.select().from(schema.eoiSubmissions).where(eq(schema.eoiSubmissions.contact, contact));
}

describe('POST /api/eoi (Task 50)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterEach(async () => {
    // Clean up every row this suite may have inserted, keyed by its own
    // dedicated contact values below.
    await db.delete(schema.eoiSubmissions).where(eq(schema.eoiSubmissions.contact, 'eoi-route-test@example.org'));
    await db.delete(schema.eoiSubmissions).where(eq(schema.eoiSubmissions.contact, 'eoi-route-test-curation@example.org'));
    vi.mocked(verifyRecaptcha).mockReset();
  });

  afterAll(async () => {
    await client.end();
  });

  it('valid body + mocked-pass reCAPTCHA -> 200 {ok:true}, no-store, row inserted with status new + correct path', async () => {
    vi.mocked(verifyRecaptcha).mockResolvedValue({ ok: true, score: 0.9 });

    const res = await eoiPOST({ request: req(validBody()) } as any);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const responseBody = await res.json();
    expect(responseBody.ok).toBe(true);

    const rows = await eoiRowsFor('eoi-route-test@example.org');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('new');
    expect(rows[0]!.path).toBe('awareness');
    expect(rows[0]!.name).toBe('Task 50 Test RWA');
  });

  it('curation path is stored correctly too', async () => {
    vi.mocked(verifyRecaptcha).mockResolvedValue({ ok: true, score: 0.9 });

    const res = await eoiPOST({
      request: req(validBody({ path: 'curation', contact: 'eoi-route-test-curation@example.org', organisation: null })),
    } as any);

    expect(res.status).toBe(200);
    const rows = await eoiRowsFor('eoi-route-test-curation@example.org');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.path).toBe('curation');
    expect(rows[0]!.organisation).toBeNull();
  });

  it('bad reCAPTCHA (mocked fail) -> 400/403, no row inserted', async () => {
    vi.mocked(verifyRecaptcha).mockResolvedValue({ ok: false, score: 0.1, reason: 'low_score' });

    const res = await eoiPOST({ request: req(validBody()) } as any);

    expect([400, 403]).toContain(res.status);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.error).toBe('recaptcha_failed');

    const rows = await eoiRowsFor('eoi-route-test@example.org');
    expect(rows).toHaveLength(0);
  });

  it('invalid body (missing name) -> 400, no row inserted, verifyRecaptcha never called', async () => {
    const { name: _omit, ...withoutName } = validBody();
    const res = await eoiPOST({ request: req(withoutName) } as any);

    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(verifyRecaptcha).not.toHaveBeenCalled();

    const rows = await eoiRowsFor('eoi-route-test@example.org');
    expect(rows).toHaveLength(0);
  });

  it('invalid body (missing contact) -> 400', async () => {
    const { contact: _omit, ...withoutContact } = validBody();
    const res = await eoiPOST({ request: req(withoutContact) } as any);
    expect(res.status).toBe(400);
  });

  it('invalid body (missing/invalid path) -> 400', async () => {
    const res = await eoiPOST({ request: req(validBody({ path: 'not-a-real-path' })) } as any);
    expect(res.status).toBe(400);
  });

  describe('privacy: name/organisation/contact/wardsText/message are never logged', () => {
    it('does not appear in any console.log call', async () => {
      vi.mocked(verifyRecaptcha).mockResolvedValue({ ok: true, score: 0.9 });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const secretName = 'Secret Name Should Not Log';
      const secretContact = 'super-secret-contact-should-not-log@example.org';
      const secretMessage = 'Secret free-text message should not log';

      const res = await eoiPOST({
        request: req(
          validBody({
            name: secretName,
            contact: secretContact,
            message: secretMessage,
          }),
        ),
      } as any);
      expect(res.status).toBe(200);

      const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).not.toContain(secretName);
      expect(logged).not.toContain(secretContact);
      expect(logged).not.toContain(secretMessage);
      logSpy.mockRestore();

      await db.delete(schema.eoiSubmissions).where(eq(schema.eoiSubmissions.contact, secretContact));
    });
  });

  describe('cross-site POST is blocked by the middleware (anti-CSRF), independent of reCAPTCHA', () => {
    it('Origin mismatch on /api/eoi -> 403 before the handler ever runs', async () => {
      const url = new URL('/api/eoi', SITE_ORIGIN);
      const request = new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify(validBody()),
      });

      const context = {
        request,
        url,
        site: new URL(SITE_ORIGIN),
        cookies: { get: () => undefined },
        locals: {},
      } as any;

      const next = vi.fn(async () => eoiPOST({ request } as any));

      const res = (await onRequest(context, next)) as Response;

      expect(res.status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});

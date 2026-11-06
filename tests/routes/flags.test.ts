import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';
import { randomUUID } from 'node:crypto';
import { issueFlagToken } from '../../src/lib/flag-abuse';
import { POST as flagsPOST } from '../../src/pages/api/flags';
vi.mock('../../src/lib/recaptcha', () => ({ verifyRecaptcha: vi.fn(async () => ({ ok: true })) }));
import { verifyRecaptcha } from '../../src/lib/recaptcha';
const client = postgres(process.env.DATABASE_URL!, { max: 5 });
const db = drizzle(client, { schema });
const WARD_ID = 99311;
let candidateId: number;
const targetRefFor = (key: string) => `candidate:${candidateId}:${key}`;
function req(body: unknown) { return new Request('http://localhost/api/flags', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
// Each call gets its own network: the per-minute request bucket is 15 per network.
let nextHost = 1;
function context(body: unknown, token = issueFlagToken(), address = `10.9.${Math.floor(nextHost / 250)}.${(nextHost++ % 250) + 1}`) { return { request: req(body), clientAddress: address, locals: { session: null }, cookies: { get: () => token ? { value: token } : undefined } } as any; }
const field = (key: string, extra = {}) => ({ targetType: 'candidate_field', targetRef: targetRefFor(key), detail: `Incorrect ${key}`, ...extra });
function payload(extra = {}, target = {}) { return { wardId: WARD_ID, targets: [field('age', target)], recaptchaToken: 'test', ...extra }; }
afterEach(() => { vi.mocked(verifyRecaptcha).mockResolvedValue({ ok: true }); delete process.env.FLAGS_SUBMISSIONS_PAUSED; });
describe('anonymous flag API', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    await db
      .insert(schema.wards)
      .values({
        id: WARD_ID,
        nameEn: 'Flags Route Test Ward',
        nameKn: 'ಫ್ಲ್ಯಾಗ್ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
        corporation: 'south',
        zone: 'Zone F',
        boundaryRef: 'flags-route-test-ward',
      })
      .onConflictDoUpdate({ target: schema.wards.id, set: { nameEn: 'Flags Route Test Ward' } });

    const [candidate] = await db
      .insert(schema.candidates)
      .values({
        slug: `flags-route-test-candidate-${randomUUID()}`,
        wardId: WARD_ID,
        nameEn: 'Flags Route Test Candidate',
        partyEn: 'Independent',
      })
      .returning();
    candidateId = candidate!.id;
  });

  afterAll(async () => {
    await client.end();
  });


  it('accepts an anonymous report and sets no cacheable response', async () => {
    const res = await flagsPOST(context(payload()));
    expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('requires a valid issued browser token', async () => {
    expect((await flagsPOST(context(payload(), 'fabricated'))).status).toBe(403);
  });
  it.each([{ sourceUrl: 'javascript:alert(1)' }, { detail: 'x'.repeat(2001) }, { targetRef: 'candidate:1:affidavit' }, { injected: true }])('rejects invalid target input %j', async extra => {
    expect((await flagsPOST(context(payload({}, extra)))).status).toBe(400);
  });
  it('rejects top-level extras and the old single-target shape', async () => {
    expect((await flagsPOST(context(payload({ injected: true })))).status).toBe(400);
    const { targets: _t, ...rest } = payload();
    expect((await flagsPOST(context({ ...rest, ...field('age') }))).status).toBe(400);
  });
  it('rejects oversized body before parsing', async () => {
    expect((await flagsPOST(context(payload({}, { detail: 'x'.repeat(200000) })))).status).toBe(413);
  });
  it('fails closed on bot verification and pause', async () => {
    vi.mocked(verifyRecaptcha).mockResolvedValue({ ok: false, reason: 'low_score' });
    expect((await flagsPOST(context(payload()))).status).toBe(403);
    process.env.FLAGS_SUBMISSIONS_PAUSED = 'true';
    expect((await flagsPOST(context(payload()))).status).toBe(503);
  });

  describe('several targets in one request', () => {
    const post = (body: unknown, token = issueFlagToken(), address?: string) => flagsPOST(context(body, token, address));
    const count = async (token: string) => Number((await client`select count(*)::int as n from flag_admissions where browser_hash=${(await import('../../src/lib/flag-abuse')).flagBrowserHash(token)}`)[0]!.n);

    it('creates one submission per ticked field and counts ONE admission', async () => {
      const token = issueFlagToken();
      const res = await post({ targets: [field('education'), field('assets'), field('cases', { suggestedValue: '2 cases' })], recaptchaToken: 't' }, token);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accepted).toBe(3);
      expect(body.results.map((r: any) => [r.targetRef.split(':')[2], r.state])).toEqual([['education', 'accepted'], ['assets', 'accepted'], ['cases', 'accepted']]);
      expect(await count(token)).toBe(1);
    });

    it('accepts the new fields and names the duplicates without failing the request', async () => {
      const token = issueFlagToken();
      await post({ targets: [field('gender')], recaptchaToken: 't' }, token);
      const res = await post({ targets: [field('gender'), field('party')], recaptchaToken: 't' }, token);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accepted).toBe(1);
      expect(body.results.map((r: any) => r.state)).toEqual(['duplicate', 'accepted']);
      expect(await count(token)).toBe(2);
    });

    it('an all-duplicate request is 200 and costs no admission', async () => {
      const token = issueFlagToken();
      await post({ targets: [field('full_name')], recaptchaToken: 't' }, token);
      const body = await (await post({ targets: [field('full_name')], recaptchaToken: 't' }, token)).json();
      expect(body.accepted).toBe(0);
      expect(await count(token)).toBe(1);
    });

    it('accepts "Other" with a description and no suggested value', async () => {
      const other = { targetType: 'candidate_other', targetRef: targetRefFor('other'), detail: 'This affidavit is of a different person' };
      expect((await post({ targets: [other], recaptchaToken: 't' })).status).toBe(200);
      const [item] = await client`select target_type from flag_items where target_ref=${targetRefFor('other')}`;
      expect(item!.target_type).toBe('candidate_other');
      expect((await post({ targets: [{ ...other, suggestedValue: 'x' }], recaptchaToken: 't' })).status).toBe(400);
      expect((await post({ targets: [{ ...other, targetRef: targetRefFor('age') }], recaptchaToken: 't' })).status).toBe(400);
      expect((await post({ targets: [{ ...field('age'), targetType: 'candidate_other' }], recaptchaToken: 't' })).status).toBe(400);
    });

    it('rejects an empty list, repeated targets, more than nine, and targets of different candidates', async () => {
      expect((await post({ targets: [], recaptchaToken: 't' })).status).toBe(400);
      expect((await post({ targets: [field('age'), field('age')], recaptchaToken: 't' })).status).toBe(400);
      const ten = [...['full_name', 'ward', 'party', 'gender', 'age', 'education', 'assets', 'cases'].map(k => field(k)), { ...field('cases'), targetRef: targetRefFor('other'), targetType: 'candidate_other' }, field('age')];
      expect((await post({ targets: ten, recaptchaToken: 't' })).status).toBe(400);
      expect((await post({ targets: [field('age'), { ...field('ward'), targetRef: 'candidate:999999:ward' }], recaptchaToken: 't' })).status).toBe(400);
    });

    it('rejects a missing detail on any target', async () => {
      expect((await post({ targets: [field('age'), field('ward', { detail: '  ' })], recaptchaToken: 't' })).status).toBe(400);
    });

    it('answers 429 with a retry hint once ten submissions are in ten minutes (daily limit raised for the test)', async () => {
      process.env.FLAGS_REPORTER_DAILY_LIMIT = '50';
      try {
        const token = issueFlagToken(), address = '10.8.0.1';
        const ids = await Promise.all(Array.from({ length: 11 }, async (_, i) => (await db.insert(schema.candidates).values({ slug: `flags-route-burst-${i}-${randomUUID()}`, wardId: WARD_ID, nameEn: 'Burst', partyEn: 'Independent' }).returning())[0]!.id));
        for (const id of ids.slice(0, 10)) {
          expect((await post({ targets: [{ targetType: 'candidate_field', targetRef: `candidate:${id}:age`, detail: 'Wrong' }], recaptchaToken: 't' }, token, address)).status).toBe(200);
        }
        const res = await post({ targets: [{ targetType: 'candidate_field', targetRef: `candidate:${ids[10]}:age`, detail: 'Wrong' }], recaptchaToken: 't' }, token, address);
        expect(res.status).toBe(429);
        const body = await res.json();
        expect(body.error).toBe('rate_limited');
        expect(body.retryAfterSeconds).toBeGreaterThan(0);
        expect(body.retryAfterSeconds).toBeLessThanOrEqual(600);
        expect(Number(res.headers.get('retry-after'))).toBe(body.retryAfterSeconds);
      } finally { delete process.env.FLAGS_REPORTER_DAILY_LIMIT; }
    });
  });
});

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
function context(body: unknown, token = issueFlagToken()) { return { request: req(body), clientAddress: '127.0.0.1', locals: { session: null }, cookies: { get: () => token ? { value: token } : undefined } } as any; }
function payload(extra = {}) { return { wardId: WARD_ID, targetType: 'candidate_field', targetRef: targetRefFor('age'), detail: 'Incorrect age', recaptchaToken: 'test', ...extra }; }
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
  it.each([{ sourceUrl: 'javascript:alert(1)' }, { detail: 'x'.repeat(2001) }, { targetRef: 'candidate:1:affidavit' }, { injected: true }])('rejects invalid input %j', async extra => {
    expect((await flagsPOST(context(payload(extra)))).status).toBe(400);
  });
  it('rejects oversized body before parsing', async () => {
    expect((await flagsPOST(context(payload({ detail: 'x'.repeat(40000) })))).status).toBe(413);
  });
  it('fails closed on bot verification and pause', async () => {
    vi.mocked(verifyRecaptcha).mockResolvedValue({ ok: false, reason: 'low_score' });
    expect((await flagsPOST(context(payload()))).status).toBe(403);
    process.env.FLAGS_SUBMISSIONS_PAUSED = 'true';
    expect((await flagsPOST(context(payload()))).status).toBe(503);
  });
});

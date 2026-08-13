/**
 * `/llms.txt` (Task 57) — a concise, AEO-friendly index of the platform's
 * public content. Reads real ward rows from the DB (for its sample list +
 * count), so this suite seeds its own ward fixture — same high, task-
 * specific id range convention as tests/routes/sitemaps.test.ts — rather
 * than assuming some other test file's fixtures are present when this
 * suite runs standalone.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { GET } from '../../src/pages/llms.txt';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. CI always sets this; for local runs export ' +
      'DATABASE_URL=postgres://postgres@localhost:54329/bv_test (see task brief).',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

const WARD = {
  id: 96501,
  nameEn: 'Llms Txt Test Ward',
  nameKn: 'Llms Txt ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone Llms Test',
  boundaryRef: 'llms-txt-test-ward',
};

describe('llms.txt (Task 57)', () => {
  beforeAll(async () => {
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
  });

  afterAll(async () => {
    await db.delete(schema.wards).where(eq(schema.wards.id, WARD.id));
    await client.end();
  });

  it('returns 200 text/plain, non-empty', async () => {
    const res = await GET({} as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });

  it('links the voting guides as absolute URLs', async () => {
    const body = await (await GET({} as any)).text();
    expect(body).toContain(`${SITE_ORIGIN}/voting-guide`);
    expect(body).toContain(`${SITE_ORIGIN}/check-registration`);
    expect(body).toContain(`${SITE_ORIGIN}/voting-guide/voter-id`);
    expect(body).toContain(`${SITE_ORIGIN}/voting-guide/how-to-vote`);
    expect(body).toContain(`${SITE_ORIGIN}/voting-guide/find-booth`);
  });

  it('links ward pages and the full sitemap index as absolute URLs', async () => {
    const body = await (await GET({} as any)).text();
    expect(body).toMatch(new RegExp(`${SITE_ORIGIN}/ward/\\d+`.replace(/[.]/g, '\\.')));
    expect(body).toContain(`${SITE_ORIGIN}/sitemap-en.xml`);
    expect(body).toContain(`${SITE_ORIGIN}/sitemap-kn.xml`);
  });

  it('does not set cache-control: no-store (public, cacheable response)', async () => {
    const res = await GET({} as any);
    expect(res.headers.get('cache-control')).not.toBe('no-store');
  });
});

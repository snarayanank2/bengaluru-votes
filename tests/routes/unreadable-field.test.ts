/**
 * A field nobody could read from the affidavit is neither a value nor "not
 * declared". The candidate page and the comparison page must say so, in
 * both languages, rather than fall back to "Not declared" — which would be
 * a false statement about what the candidate swore to.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';
import { t } from '../../src/i18n';

import CandidateEn from '../../src/pages/candidate/[slug].astro';
import CandidateKn from '../../src/pages/kn/candidate/[slug].astro';
import CompareEn from '../../src/pages/ward/[id]/compare.astro';
import CompareKn from '../../src/pages/kn/ward/[id]/compare.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// This suite owns ward id 99490.
const WARD = { id: 99490, nameEn: 'Unreadable Field Test Ward', nameKn: 'ಪರೀಕ್ಷಾ ವಾರ್ಡ್', corporation: 'south' as const, zone: 'Zone T', boundaryRef: 'unreadable-field-test-ward' };
let slug: string;
const candidateIds: number[] = [];

async function render(component: unknown, path: string, params: Record<string, string>): Promise<string> {
  const container = await AstroContainer.create({
    astroConfig: { site: SITE_ORIGIN, i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } } },
  });
  const res = await container.renderToResponse(component as any, { partial: false, params, request: new Request(new URL(path, SITE_ORIGIN)) });
  expect(res.status).toBe(200);
  return res.text();
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
  for (const name of ['Unreadable One (FICTIONAL)', 'Unreadable Two (FICTIONAL)']) {
    const [c] = await db
      .insert(schema.candidates)
      .values({ slug: `unreadable-field-test-${randomUUID()}`, wardId: WARD.id, nameEn: name, partyEn: 'Demo Party A', status: 'contesting' })
      .returning({ id: schema.candidates.id, slug: schema.candidates.slug });
    candidateIds.push(c.id);
    slug ??= c.slug;
    await db.insert(schema.candidateFields).values([
      { candidateId: c.id, fieldKey: 'assets', unreadable: true, aiExtracted: true, sourceType: 'official', sourceUrl: '/media/1/x' },
      { candidateId: c.id, fieldKey: 'cases', notDeclared: true, sourceType: 'official', sourceUrl: '/media/1/x' },
      { candidateId: c.id, fieldKey: 'age', valueEn: '52', aiExtracted: true, sourceType: 'official', sourceUrl: '/media/1/x' },
    ]);
  }
});

afterAll(async () => {
  await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
  await db.delete(schema.candidates).where(eq(schema.candidates.wardId, WARD.id));
  await db.delete(schema.wards).where(eq(schema.wards.id, WARD.id));
  await client.end();
});

/** Occurrences of `needle` in `html`. */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('a field that could not be read', () => {
  it.each([
    ['en', CandidateEn, (s: string) => `/candidate/${s}`],
    ['kn', CandidateKn, (s: string) => `/kn/candidate/${s}`],
  ] as const)('%s candidate page says it could not be read, once, and keeps "not declared" for the field that is', async (lang, component, path) => {
    const html = await render(component, path(slug), { slug });
    expect(count(html, t(lang, 'common.unreadable'))).toBe(1);
    // gender, education and the affidavit link have no row at all; cases is declared blank.
    expect(count(html, t(lang, 'common.notDeclared'))).toBe(4);
  });

  it.each([
    ['en', CompareEn, `/ward/${WARD.id}/compare`],
    ['kn', CompareKn, `/kn/ward/${WARD.id}/compare`],
  ] as const)('%s comparison page says it could not be read for each candidate', async (lang, component, path) => {
    const html = await render(component, path, { id: String(WARD.id) });
    expect(count(html, t(lang, 'common.unreadable'))).toBe(2);
  });

  it('uses different words for the two states', () => {
    expect(t('en', 'common.unreadable')).not.toBe(t('en', 'common.notDeclared'));
    expect(t('kn', 'common.unreadable')).not.toBe(t('kn', 'common.notDeclared'));
  });
});

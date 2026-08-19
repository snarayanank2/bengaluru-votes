/**
 * Legacy candidate-list URLs permanently redirect to the ward page, where
 * the candidate list now lives. Invalid and unknown wards remain real 404s.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';
import { localePath, type Lang } from '../../src/i18n';
import WardCandidatesEn from '../../src/pages/ward/[id]/candidates.astro';
import WardCandidatesKn from '../../src/pages/kn/ward/[id]/candidates.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });
const WARD = {
  id: 96201,
  nameEn: 'Legacy Candidate Route Test Ward',
  nameKn: 'ಹಳೆಯ ಅಭ್ಯರ್ಥಿ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone WC',
  boundaryRef: 'legacy-candidate-route-test-ward',
};

async function render(lang: Lang, id: number | string): Promise<Response> {
  const container = await AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
  return container.renderToResponse(lang === 'kn' ? WardCandidatesKn : WardCandidatesEn, {
    partial: false,
    params: { id: String(id) },
    request: new Request(`${SITE_ORIGIN}${localePath(lang, `/ward/${id}/candidates`)}`),
  });
}

describe('legacy candidate-list routes', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
  });

  afterAll(async () => {
    await client.end();
  });

  it.each(['en', 'kn'] as const)('%s: permanently redirects a known ward to its ward page', async (lang) => {
    const response = await render(lang, WARD.id);
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(localePath(lang, `/ward/${WARD.id}`));
  });

  it.each(['en', 'kn'] as const)('%s: returns 404 for an unknown ward', async (lang) => {
    expect((await render(lang, 999999)).status).toBe(404);
  });

  it.each(['en', 'kn'] as const)('%s: returns 404 for an invalid ward id', async (lang) => {
    expect((await render(lang, 'not-a-number')).status).toBe(404);
  });
});

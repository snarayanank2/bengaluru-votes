import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';
import { localePath, type Lang } from '../../src/i18n';
import WardEn from '../../src/pages/ward/[id].astro';
import WardKn from '../../src/pages/kn/ward/[id].astro';
import CompareEn from '../../src/pages/ward/[id]/compare.astro';
import CompareKn from '../../src/pages/kn/ward/[id]/compare.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see AGENTS.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// Real ids, because the share images exist only for the real 369 wards;
// 94101 is a ward with no generated image.
const base = {
  zone: 'Zone T',
  assemblyNumber: 163,
  assemblyNameEn: 'Test Assembly',
  assemblyNameKn: 'ಪರೀಕ್ಷಾ ವಿಧಾನಸಭಾ ಕ್ಷೇತ್ರ',
  populationTotal: 1000,
  populationMale: 500,
  populationFemale: 500,
  reservationEn: 'General',
  reservationKn: 'ಸಾಮಾನ್ಯ',
  factsSourceUrl: 'https://example.org/ward-facts.csv',
  factsSourceDate: '2026-08-19',
};
const WARDS = [
  { ...base, id: 5036, nameEn: '36 - Nalwadi Krishnaraja Wadiyar Ward', nameKn: 'ನಾಲ್ವಡಿ ಕೃಷ್ಣರಾಜ ಒಡೆಯರ್ ವಾರ್ಡ್', corporation: 'west' as const, boundaryRef: 'og-5036' },
  { ...base, id: 94101, nameEn: 'Og None', nameKn: 'ಒಜಿ ಇಲ್ಲ', corporation: 'north' as const, boundaryRef: 'og-94101' },
];

const tag = (html: string, re: RegExp) => (html.match(re)?.[1] ?? '').replace(/&amp;/g, '&');

async function render(component: unknown, lang: Lang, path: string, id: number) {
  const container = await AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
  const res = await container.renderToResponse(component as never, {
    partial: false,
    params: { id: String(id) },
    request: new Request(`${SITE_ORIGIN}${localePath(lang, path)}`),
  });
  const html = await res.text();
  return {
    og: tag(html, /<meta property="og:image" content="([^"]*)"/),
    twitter: tag(html, /<meta name="twitter:image" content="([^"]*)"/),
    width: tag(html, /<meta property="og:image:width" content="([^"]*)"/),
    height: tag(html, /<meta property="og:image:height" content="([^"]*)"/),
    alt: tag(html, /<meta property="og:image:alt" content="([^"]*)"/),
    twitterAlt: tag(html, /<meta name="twitter:image:alt" content="([^"]*)"/),
  };
}

describe('Ward share image metadata (task 196)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    for (const w of WARDS) await db.insert(schema.wards).values(w).onConflictDoUpdate({ target: schema.wards.id, set: w });
  });
  afterAll(async () => {
    await client.end();
  });

  it('en ward page points og:image and twitter:image at the ward image', async () => {
    const m = await render(WardEn, 'en', '/ward/5036', 5036);
    expect(m.og).toBe(`${SITE_ORIGIN}/og/ward/5036-en.png`);
    expect(m.twitter).toBe(m.og);
    expect([m.width, m.height]).toEqual(['1200', '630']);
    expect(m.alt).toBe('Bengaluru Votes: Nalwadi Krishnaraja Wadiyar Ward, Ward 36 · West Corporation');
    expect(m.twitterAlt).toBe(m.alt);
  });

  it('kn ward page uses the Kannada image and alt text', async () => {
    const m = await render(WardKn, 'kn', '/ward/5036', 5036);
    expect(m.og).toBe(`${SITE_ORIGIN}/og/ward/5036-kn.png`);
    expect(m.twitter).toBe(m.og);
    expect(m.alt).toContain('ನಾಲ್ವಡಿ ಕೃಷ್ಣರಾಜ ಒಡೆಯರ್ ವಾರ್ಡ್');
    expect(m.alt).toContain('ವಾರ್ಡ್ 36');
  });

  it('the compare subpage shares the ward image', async () => {
    const compare = await render(CompareEn, 'en', '/ward/5036/compare', 5036);
    expect(compare.og).toBe(`${SITE_ORIGIN}/og/ward/5036-en.png`);
    const compareKn = await render(CompareKn, 'kn', '/ward/5036/compare', 5036);
    expect(compareKn.og).toBe(`${SITE_ORIGIN}/og/ward/5036-kn.png`);
  });

  it('falls back to the default image, with its alt text, when the ward has none', async () => {
    const m = await render(WardEn, 'en', '/ward/94101', 94101);
    expect(m.og).toBe(`${SITE_ORIGIN}/img/og-default.png`);
    expect([m.width, m.height]).toEqual(['1200', '630']);
    expect(m.alt).toBe('Bengaluru Votes: know your ward, know your candidates.');
  });
});

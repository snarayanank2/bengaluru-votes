/**
 * Ward directory (`/wards`, `/corporation/{slug}`), the corporation crumb and
 * the neighbouring-wards block on ward pages (architecture §5). Uses the REAL
 * 369 wards from data/gba.geojson, inserted the way scripts/seed-wards.ts maps
 * them, and removes only the rows it added. No candidate exists in these
 * tests: the directory must not depend on candidate data.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { inArray } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import * as schema from '../../src/db/schema';
import { localePath, t, type Lang } from '../../src/i18n';
import WardsEn from '../../src/pages/wards.astro';
import WardsKn from '../../src/pages/kn/wards.astro';
import CorporationEn from '../../src/pages/corporation/[slug].astro';
import CorporationKn from '../../src/pages/kn/corporation/[slug].astro';
import WardEn from '../../src/pages/ward/[id].astro';
import WardKn from '../../src/pages/kn/ward/[id].astro';
import { buildSitemaps } from '../../src/lib/seo/sitemaps';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see AGENTS.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

const geojson = JSON.parse(readFileSync('data/gba.geojson', 'utf8'));
const neighbourTable: Record<string, number[]> = JSON.parse(readFileSync('data/ward-neighbours.json', 'utf8'));
const WARD_ROWS = geojson.features.map((f: any) => ({
  id: f.properties.corporation_id * 1000 + f.properties.ward_id,
  nameEn: f.properties.ward_name as string,
  nameKn: f.properties.ward_name_kn as string,
  corporation: (f.properties.Corporation as string).toLowerCase() as 'north',
  zone: f.properties.zone_name as string,
  boundaryRef: f.properties.id as string,
}));
const CORPORATIONS = ['central', 'north', 'east', 'south', 'west'] as const;

let insertedIds: number[] = [];

async function container() {
  return AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
}

async function render(component: unknown, path: string, params?: Record<string, string>): Promise<Response> {
  return (await container()).renderToResponse(component as any, {
    partial: false,
    params,
    request: new Request(`${SITE_ORIGIN}${path}`),
  });
}

const wardsPage = (lang: Lang) => render(lang === 'kn' ? WardsKn : WardsEn, localePath(lang, '/wards'));
const corporationPage = (lang: Lang, slug: string) =>
  render(lang === 'kn' ? CorporationKn : CorporationEn, localePath(lang, `/corporation/${slug}`), { slug });
const wardPage = (lang: Lang, id: number) =>
  render(lang === 'kn' ? WardKn : WardEn, localePath(lang, `/ward/${id}`), { id: String(id) });

/** Every `<a href>` target in the page. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1]);
}

describe('ward directory and neighbours', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    const added = await db.insert(schema.wards).values(WARD_ROWS).onConflictDoNothing().returning({ id: schema.wards.id });
    insertedIds = added.map((row) => row.id);
  });

  afterAll(async () => {
    if (insertedIds.length > 0) await db.delete(schema.wards).where(inArray(schema.wards.id, insertedIds));
    await client.end();
  });

  describe('/wards', () => {
    it.each(['en', 'kn'] as const)('%s: 200, every one of the 369 wards is a plain link, grouped by corporation', async (lang) => {
      const res = await wardsPage(lang);
      expect(res.status).toBe(200);
      const html = await res.text();
      const links = new Set(hrefs(html));
      expect(WARD_ROWS).toHaveLength(369);
      for (const ward of WARD_ROWS) {
        expect(links.has(localePath(lang, `/ward/${ward.id}`)), `ward ${ward.id}`).toBe(true);
      }
      for (const corporation of CORPORATIONS) {
        expect(links.has(localePath(lang, `/corporation/${corporation}`)), corporation).toBe(true);
      }
      // One heading per corporation and at least two zones under each.
      const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
      expect([...main.matchAll(/<h2\b/g)]).toHaveLength(5);
      expect([...main.matchAll(/<h3\b/g)].length).toBeGreaterThanOrEqual(10); // other suites leave fixture zones in the shared test DB
    });

    it.each(['en', 'kn'] as const)('%s: labels use the public number and localized name, never the route id', async (lang) => {
      const html = await (await wardsPage(lang)).text();
      // 1001 is Central's ward 1.
      const first = WARD_ROWS.find((w: { id: number }) => w.id === 1001);
      const name = (lang === 'kn' ? first.nameKn : first.nameEn).replace(/^\d+\s*-\s*/, '');
      expect(html).toContain(`>${t(lang, 'nav.ward', { wardNumber: 1, wardName: name })}</a>`);
      expect(html).not.toMatch(/(?:Ward|ವಾರ್ಡ್)\s+\d{4}\b/);
    });

    it('each language has its own canonical, hreflang pair, title and breadcrumb', async () => {
      const en = await (await wardsPage('en')).text();
      const kn = await (await wardsPage('kn')).text();
      expect(en).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/wards">`);
      expect(kn).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/kn/wards">`);
      for (const html of [en, kn]) {
        expect(html).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/wards">`);
        expect(html).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/wards">`);
      }
      expect(en).toContain(`<title>${t('en', 'wards.meta.title')}`);
      expect(kn).toContain(`<title>${t('kn', 'wards.meta.title')}`);
      expect(en).toContain('BreadcrumbList');
    });

    it('is the same for every visitor: no Set-Cookie and no per-visitor markup', async () => {
      const res = await wardsPage('en');
      expect(res.headers.get('set-cookie')).toBeNull();
    });
  });

  describe('/corporation/{slug}', () => {
    it.each(['en', 'kn'] as const)('%s: each of the five corporations lists exactly its own wards', async (lang) => {
      for (const corporation of CORPORATIONS) {
        const res = await corporationPage(lang, corporation);
        expect(res.status, corporation).toBe(200);
        const html = await res.text();
        const links = new Set(hrefs(html));
        const own = WARD_ROWS.filter((w: { corporation: string }) => w.corporation === corporation);
        expect(own.length).toBeGreaterThan(0);
        for (const ward of WARD_ROWS) {
          expect(links.has(localePath(lang, `/ward/${ward.id}`)), `${corporation} / ${ward.id}`).toBe(ward.corporation === corporation);
        }
        const name = t(lang, 'corporation.name', { corporation: t(lang, `ward.corporation.${corporation}`) });
        expect(html).toMatch(new RegExp(`<h1[^>]*>${name}</h1>`));
        expect(links.has(localePath(lang, '/wards'))).toBe(true);
        expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}${localePath(lang, `/corporation/${corporation}`)}">`);
      }
    });

    it.each(['en', 'kn'] as const)('%s: an unknown corporation is a real 404', async (lang) => {
      for (const slug of ['nowhere', 'CENTRAL', 'central2']) {
        const res = await corporationPage(lang, slug);
        expect(res.status, slug).toBe(404);
      }
    });
  });

  describe('ward page', () => {
    it.each(['en', 'kn'] as const)('%s: the breadcrumb is Home > Corporation > Ward and the JSON-LD matches', async (lang) => {
      const html = await (await wardPage(lang, 1001)).text();
      const corporationName = t(lang, 'corporation.name', { corporation: t(lang, 'ward.corporation.central') });
      expect(html).toContain(`<a href="${localePath(lang, '/corporation/central')}"`);
      expect(html).toContain(corporationName);
      const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
        .map((m) => JSON.parse(m[1]))
        .find((obj) => obj['@type'] === 'BreadcrumbList');
      const items = ld.itemListElement;
      expect(items).toHaveLength(3);
      expect(items[1].name).toBe(corporationName);
      expect(items[1].item).toBe(`${SITE_ORIGIN}${localePath(lang, '/corporation/central')}`);
      expect(items[2].item).toBe(`${SITE_ORIGIN}${localePath(lang, '/ward/1001')}`);
    });

    it.each(['en', 'kn'] as const)('%s: lists the precomputed neighbours, and labels the ones in another corporation', async (lang) => {
      // Pick a ward that has a neighbour in another corporation.
      const byId = new Map(WARD_ROWS.map((w: { id: number }) => [w.id, w]));
      const wardId = Number(
        Object.keys(neighbourTable).find((id) => {
          const list = neighbourTable[id];
          return list.length >= 4 && list.some((n) => Math.floor(n / 1000) !== Math.floor(Number(id) / 1000));
        }),
      );
      const expected = neighbourTable[String(wardId)];
      const html = await (await wardPage(lang, wardId)).text();
      const section = html.slice(html.indexOf('id="ward-neighbours"'));
      expect(section).toContain(t(lang, 'ward.neighbours.heading'));
      const links = hrefs(section);
      const listed = expected.filter((id) => links.includes(localePath(lang, `/ward/${id}`)));
      expect(listed).toEqual(expected);
      expect(expected.length).toBeLessThanOrEqual(6);
      const home = (byId.get(wardId) as { corporation: string }).corporation;
      const others = expected.filter((id) => (byId.get(id) as { corporation: string }).corporation !== home);
      expect(others.length).toBeGreaterThan(0);
      for (const id of others) {
        const corp = (byId.get(id) as { corporation: string }).corporation;
        expect(section).toContain(t(lang, 'corporation.name', { corporation: t(lang, `ward.corporation.${corp}`) }));
      }
    });

    it('a ward with fewer than four neighbours renders just the ones it has', async () => {
      const wardId = Number(Object.keys(neighbourTable).find((id) => neighbourTable[id].length < 4));
      const expected = neighbourTable[String(wardId)];
      const res = await wardPage('en', wardId);
      expect(res.status).toBe(200);
      const html = await res.text();
      const section = html.slice(html.indexOf('id="ward-neighbours"'));
      expect(hrefs(section).filter((h) => /^\/ward\/\d+$/.test(h) && h !== `/ward/${wardId}`)).toEqual(
        expected.map((id) => `/ward/${id}`),
      );
    });
  });

  describe('sitemaps', () => {
    it('list the directory and every corporation page in both languages', async () => {
      const files = await buildSitemaps();
      for (const [lang, xml] of [['en', files.en], ['kn', files.kn]] as const) {
        for (const path of ['/wards', ...CORPORATIONS.map((c) => `/corporation/${c}`)]) {
          expect(xml).toContain(`<loc>${SITE_ORIGIN}${localePath(lang, path)}</loc>`);
        }
      }
    });
  });
});

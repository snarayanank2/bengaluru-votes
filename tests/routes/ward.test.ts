import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';
import { localePath, t, type Lang } from '../../src/i18n';
import WardEn from '../../src/pages/ward/[id].astro';
import WardKn from '../../src/pages/kn/ward/[id].astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific id (task-19 brief) so this suite never collides with
// another test file's ward fixtures in the shared (not reset-between-files)
// test DB — audit uses 9001, lookup uses 97xxx, home uses 96001.
const WARD = {
  id: 95001,
  nameEn: 'Ward Result Test Ward',
  nameKn: 'ವಾರ್ಡ್ ಫಲಿತಾಂಶ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'ward-result-test-ward',
};

/**
 * Strips the container API's dev-mode debug attributes and collapses
 * incidental whitespace (see tests/routes/layout.test.ts / home.test.ts for
 * the same helper/rationale).
 */
function normalize(html: string): string {
  return html
    .replace(/\s+data-astro-cid-\w+/g, '')
    .replace(/\s+data-astro-(?:source-file|source-loc)="[^"]*"/g, '')
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<')
    .replace(/\s+/g, ' ');
}

async function makeContainer() {
  return AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
}

function twinFor(lang: Lang) {
  return lang === 'kn' ? WardKn : WardEn;
}

async function renderWard(
  lang: Lang,
  id: number | string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const container = await makeContainer();
  const path = localePath(lang, `/ward/${id}`);
  return container.renderToResponse(twinFor(lang), {
    partial: false,
    params: { id: String(id) },
    request: new Request(`${SITE_ORIGIN}${path}`, { headers: extraHeaders }),
  });
}

describe('Ward result page (/ward/{id}, /kn/ward/{id}) — IA §3.2, PRD §5.1', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
  });

  afterAll(async () => {
    await client.end();
  });

  describe('known ward id', () => {
    it.each(['en', 'kn'] as const)('%s: renders ward name, number, corporation label; status 200', async (lang) => {
      const res = await renderWard(lang, WARD.id);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());

      const expectedName = lang === 'kn' ? WARD.nameKn : WARD.nameEn;
      expect(html).toContain(expectedName);
      expect(html).toContain(String(WARD.id));
      expect(html).toContain(t(lang, 'ward.corporation.south'));
    });

    it('en: corporation label maps "south" -> "South", not the raw enum value', async () => {
      const res = await renderWard('en', WARD.id);
      const html = normalize(await res.text());
      expect(html).toContain('South');
      expect(html).not.toMatch(/>south</);
    });
  });

  describe('unknown ward id -> real 404 (route twin)', () => {
    it.each(['en', 'kn'] as const)('%s: a well-formed but non-existent id 404s', async (lang) => {
      const res = await renderWard(lang, 999999);
      expect(res.status).toBe(404);
    });

    it.each(['en', 'kn'] as const)('%s: a non-numeric id 404s', async (lang) => {
      const res = await renderWard(lang, 'not-a-number');
      expect(res.status).toBe(404);
    });
  });

  describe('register-for-updates slot (design-system.md §7.8, cache invariant)', () => {
    it.each(['en', 'kn'] as const)(
      '%s: renders the anonymous "Register for updates" control with data-register-slot/data-ward-id',
      async (lang) => {
        const res = await renderWard(lang, WARD.id);
        const html = normalize(await res.text());

        expect(html).toContain(t(lang, 'common.registerForUpdates'));
        expect(html).toMatch(new RegExp(`data-register-slot[^>]*data-ward-id="${WARD.id}"|data-ward-id="${WARD.id}"[^>]*data-register-slot`));
        expect(html).toContain(`href="${localePath(lang, '/login')}"`);
      },
    );

    it('server markup is byte-identical whether or not the request carries a session cookie (cache invariant)', async () => {
      const noCookie = normalize(await (await renderWard('en', WARD.id)).text());
      const withCookie = normalize(
        await (await renderWard('en', WARD.id, { cookie: 'session=some-signed-in-users-session-id' })).text(),
      );
      expect(withCookie).toBe(noCookie);
    });
  });

  describe('links to candidates/issues/voting-guide', () => {
    it.each(['en', 'kn'] as const)('%s: locale-correct hrefs', async (lang) => {
      const res = await renderWard(lang, WARD.id);
      const html = normalize(await res.text());

      expect(html).toContain(`href="${localePath(lang, `/ward/${WARD.id}/candidates`)}"`);
      expect(html).toContain(`href="${localePath(lang, `/ward/${WARD.id}/issues`)}"`);
      expect(html).toContain(`href="${localePath(lang, '/voting-guide')}"`);
    });
  });

  describe('lang attribute + hreflang pair', () => {
    it('sets <html lang> and emits the en/kn hreflang alternates', async () => {
      const enHtml = normalize(await (await renderWard('en', WARD.id)).text());
      const knHtml = normalize(await (await renderWard('kn', WARD.id)).text());

      expect(enHtml).toMatch(/<html lang="en"/);
      expect(knHtml).toMatch(/<html lang="kn"/);
      expect(enHtml).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/ward/${WARD.id}">`);
      expect(enHtml).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/ward/${WARD.id}">`);
      expect(knHtml).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/ward/${WARD.id}">`);
      expect(knHtml).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/ward/${WARD.id}">`);
    });
  });

  describe('WardMap island + no-JS fallback', () => {
    it('emits its own WardMap island script, plus Base.astro\'s global Register/Login, Flag, Vote modal, MeSlot, ?src attribution, and Place JSON-LD scripts (Tasks 27/28/32/33/49/56) — no others', async () => {
      const html = normalize(await (await renderWard('en', WARD.id)).text());
      const scriptOpenTags = html.match(/<script\b[^>]*>/g) ?? [];
      // See tests/routes/home.test.ts's equivalent assertion — every page
      // now also carries Base.astro's global Register/Login modal, Flag
      // modal (Task 32, src/components/FlagModal.astro), Vote modal (Task
      // 33, src/components/VoteModal.astro), MeSlot (Task 28,
      // src/islands/MeSlot.ts), the inline `?src` attribution writer
      // (Task 49, src/lib/attribution.ts — deliberately not type="module",
      // architecture §13), and — since Task 56 — this page's own Place
      // JSON-LD inline script (also not type="module").
      expect(scriptOpenTags).toHaveLength(7);
      const moduleScripts = scriptOpenTags.filter((tag) => tag.includes('type="module"'));
      const inlineScripts = scriptOpenTags.filter((tag) => !tag.includes('type="module"'));
      expect(moduleScripts).toHaveLength(5);
      expect(inlineScripts).toHaveLength(2);
      expect(html).toMatch(/Ward\.astro\?astro&type=script/);
      expect(html).toMatch(/RegisterLoginModal\.astro\?astro&type=script/);
      expect(html).toMatch(/FlagModal\.astro\?astro&type=script/);
      expect(html).toMatch(/VoteModal\.astro\?astro&type=script/);
      expect(html).toMatch(/Base\.astro\?astro&type=script/);
      expect(html).toMatch(/bv_src/);
      expect(html).toMatch(/"@type":"AdministrativeArea"/);
    });

    it('emits Place JSON-LD (AdministrativeArea) for this ward, with an absolute url', async () => {
      const html = await (await renderWard('en', WARD.id)).text();
      const match = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
      expect(match, 'expected an application/ld+json script tag').not.toBeNull();
      const parsed = JSON.parse(match![1]);
      expect(parsed['@type']).toBe('AdministrativeArea');
      expect(parsed.name).toBe(WARD.nameEn);
      expect(parsed.identifier).toBe(String(WARD.id));
      expect(parsed.url).toBe(`${SITE_ORIGIN}/ward/${WARD.id}`);
      expect(parsed.containedInPlace).toBeTruthy();
    });

    it('renders the map container with a no-JS fallback text', async () => {
      // Whether the container also gets the island's data attributes
      // (data-ward-map/data-boundary-url/data-maps-key/data-maps-map-id)
      // depends on mapsConfig().enabled, which env vars neither this test
      // nor its beforeAll/afterAll touch — see the "map container" describe
      // block below for that behavior, both enabled and disabled.
      const html = normalize(await (await renderWard('en', WARD.id)).text());
      expect(html).toContain('class="map-container"');
      expect(html).toContain(t('en', 'ward.map.fallback'));
    });
  });

  describe('map container (spec §3, §8)', () => {
    const MAPS_KEYS = ['MAPS_ENABLED', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAPS_MAP_ID'] as const;
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = Object.fromEntries(MAPS_KEYS.map((k) => [k, process.env[k]]));
    });

    afterEach(() => {
      for (const k of MAPS_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k]!;
      }
    });

    it('renders the map container with its config when maps are enabled', async () => {
      process.env.MAPS_ENABLED = 'true';
      process.env.GOOGLE_MAPS_BROWSER_KEY = 'test-browser-key';
      process.env.GOOGLE_MAPS_MAP_ID = 'test-map-id';

      const html = normalize(await (await renderWard('en', WARD.id)).text());

      expect(html).toContain('data-ward-map');
      expect(html).toContain(`data-boundary-url="/ward/${WARD.id}/boundary.json"`);
      expect(html).toContain('data-maps-key="test-browser-key"');
      expect(html).toContain('data-maps-map-id="test-map-id"');
    });

    it('renders only the fallback and no island hook when maps are disabled', async () => {
      delete process.env.MAPS_ENABLED;
      delete process.env.GOOGLE_MAPS_BROWSER_KEY;

      const html = normalize(await (await renderWard('en', WARD.id)).text());

      expect(html).not.toContain('data-ward-map');
      expect(html).not.toContain('data-maps-key');
      expect(html).toContain(t('en', 'ward.map.fallback'));
    });

    it('never leaks the browser key when maps are disabled', async () => {
      delete process.env.MAPS_ENABLED;
      process.env.GOOGLE_MAPS_BROWSER_KEY = 'secret-key';

      expect(normalize(await (await renderWard('en', WARD.id)).text())).not.toContain('secret-key');
    });
  });
});

/**
 * Candidates-in-ward list (`/ward/{id}/candidates`, `/kn/ward/{id}/candidates`)
 * — Task 42, IA §3.3, PRD §5.2, design-system §4.3/§7.12. Drives every
 * request through the REAL route twins + a real DB, same technique as
 * tests/routes/ward-issues.test.ts / candidate.test.ts.
 *
 * COVERAGE MAP:
 *   - ward with candidates -> 200, renders each candidate (name/party/
 *     status), links to /candidate/{slug}; ALPHABETICAL order (seeded out
 *     of order) — never editorially ranked (design-system §4.3).
 *   - withdrawn/rejected candidates shown WITH their status label — not
 *     hidden, not 404'd (PRD §5.2 — the links have already been shared).
 *   - neutrality: no danger/error/alarm class wraps a rejected/withdrawn
 *     status label, and no party-color class anywhere (design-system §4).
 *   - empty ward (no candidates) -> 200 (NOT 404) + the pre-notification
 *     empty state + register-for-updates prompt (design-system §7.12).
 *   - unknown ward id -> real 404 (route twin).
 *   - provisional marker present/absent per app_settings.withdrawals_closed.
 *   - register-for-updates slot: anonymous-only, cache-safe.
 *   - lang/hreflang.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { localePath, t, type Lang } from '../../src/i18n';
import WardCandidatesEn from '../../src/pages/ward/[id]/candidates.astro';
import WardCandidatesKn from '../../src/pages/kn/ward/[id]/candidates.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. CI always sets this; for local runs export ' +
      'DATABASE_URL=postgres://postgres@localhost:54329/bv_test (see task brief).',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific id range (Task 42 brief) so this suite never collides
// with another test file's fixtures in the shared (not reset-between-files)
// test DB — see tests/routes/ward.test.ts's own note for the same convention.
const WARD = {
  id: 96201,
  nameEn: 'Ward Candidates Test Ward',
  nameKn: 'ವಾರ್ಡ್ ಅಭ್ಯರ್ಥಿಗಳ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone WC',
  boundaryRef: 'ward-candidates-test-ward',
};

const EMPTY_WARD = {
  id: 96202,
  nameEn: 'Ward Candidates Empty Test Ward',
  nameKn: 'ವಾರ್ಡ್ ಅಭ್ಯರ್ಥಿಗಳ ಖಾಲಿ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'north' as const,
  zone: 'Zone WC',
  boundaryRef: 'ward-candidates-empty-test-ward',
};

// Astro HTML-escapes text-node content, so a translated string containing a
// literal apostrophe (e.g. "we'll") renders as `&#39;` in the response body.
function escApos(s: string): string {
  return s.replace(/'/g, '&#39;');
}

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
  return lang === 'kn' ? WardCandidatesKn : WardCandidatesEn;
}

async function renderWardCandidates(
  lang: Lang,
  id: number | string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const container = await makeContainer();
  const path = localePath(lang, `/ward/${id}/candidates`);
  return container.renderToResponse(twinFor(lang), {
    partial: false,
    params: { id: String(id) },
    request: new Request(`${SITE_ORIGIN}${path}`, { headers: extraHeaders }),
  });
}

describe('Candidates-in-ward list (/ward/{id}/candidates) — IA §3.3, PRD §5.2', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
    await db
      .insert(schema.wards)
      .values(EMPTY_WARD)
      .onConflictDoUpdate({ target: schema.wards.id, set: EMPTY_WARD });

    // Clean any leftover fixtures from a previous run of this file.
    await db.delete(schema.candidates).where(eq(schema.candidates.wardId, WARD.id));

    // Seeded deliberately OUT OF alphabetical order — the page must sort
    // them, never trust insertion order (design-system §4.3: never
    // editorially ranked).
    await db.insert(schema.candidates).values([
      {
        slug: 'ward-candidates-test-zainab',
        wardId: WARD.id,
        nameEn: 'Zainab Contesting',
        nameKn: 'ಝೈನಬ್ ಸ್ಪರ್ಧಿ',
        partyEn: 'Independent',
        status: 'contesting',
      },
      {
        slug: 'ward-candidates-test-arjun',
        wardId: WARD.id,
        nameEn: 'Arjun Filed',
        nameKn: 'ಅರ್ಜುನ್ ಸಲ್ಲಿಕೆ',
        partyEn: 'Example Party',
        status: 'filed',
      },
      {
        slug: 'ward-candidates-test-meena',
        wardId: WARD.id,
        nameEn: 'Meena Withdrawn',
        nameKn: 'ಮೀನಾ ಹಿಂಪಡೆದ',
        partyEn: 'Independent',
        status: 'withdrawn',
      },
      {
        slug: 'ward-candidates-test-rekha',
        wardId: WARD.id,
        nameEn: 'Rekha Rejected',
        nameKn: 'ರೇಖಾ ತಿರಸ್ಕೃತ',
        partyEn: 'Example Party',
        status: 'rejected',
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.candidates).where(eq(schema.candidates.wardId, WARD.id));
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, 'withdrawals_closed'));
    await client.end();
  });

  describe('ward with candidates', () => {
    it.each(['en', 'kn'] as const)('%s: 200, renders each candidate with name/party/status and links to /candidate/{slug}', async (lang) => {
      const res = await renderWardCandidates(lang, WARD.id);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());

      const names =
        lang === 'kn'
          ? ['ಝೈನಬ್ ಸ್ಪರ್ಧಿ', 'ಅರ್ಜುನ್ ಸಲ್ಲಿಕೆ', 'ಮೀನಾ ಹಿಂಪಡೆದ', 'ರೇಖಾ ತಿರಸ್ಕೃತ']
          : ['Zainab Contesting', 'Arjun Filed', 'Meena Withdrawn', 'Rekha Rejected'];
      for (const name of names) {
        expect(html).toContain(name);
      }
      expect(html).toContain('Independent');
      expect(html).toContain('Example Party');

      expect(html).toContain(`href="${localePath(lang, '/candidate/ward-candidates-test-zainab')}"`);
      expect(html).toContain(`href="${localePath(lang, '/candidate/ward-candidates-test-arjun')}"`);
    });

    it('renders candidates in ALPHABETICAL order regardless of insertion/status order (design-system §4.3)', async () => {
      const html = normalize(await (await renderWardCandidates('en', WARD.id)).text());
      const idxArjun = html.indexOf('Arjun Filed');
      const idxMeena = html.indexOf('Meena Withdrawn');
      const idxRekha = html.indexOf('Rekha Rejected');
      const idxZainab = html.indexOf('Zainab Contesting');

      expect(idxArjun).toBeGreaterThan(-1);
      expect(idxMeena).toBeGreaterThan(idxArjun);
      expect(idxRekha).toBeGreaterThan(idxMeena);
      expect(idxZainab).toBeGreaterThan(idxRekha);
    });
  });

  describe('withdrawn/rejected candidates shown WITH status, neutrally (PRD §5.2, design-system §4)', () => {
    it('withdrawn and rejected candidates are NOT hidden, and show their status label', async () => {
      const html = normalize(await (await renderWardCandidates('en', WARD.id)).text());
      expect(html).toContain('Meena Withdrawn');
      expect(html).toContain(t('en', 'candidate.status.withdrawn'));
      expect(html).toContain('Rekha Rejected');
      expect(html).toContain(t('en', 'candidate.status.rejected'));
    });

    it('active candidates show their status too (filed/contesting) — identical treatment, no special-casing', async () => {
      const html = normalize(await (await renderWardCandidates('en', WARD.id)).text());
      expect(html).toContain(t('en', 'candidate.status.filed'));
      expect(html).toContain(t('en', 'candidate.status.contesting'));
    });

    it('no danger/error/alarm styling class wraps a status label (neutrality)', async () => {
      const html = normalize(await (await renderWardCandidates('en', WARD.id)).text());
      const statusSpanMatches = [...html.matchAll(/<span class="([^"]*status[^"]*)">/g)];
      expect(statusSpanMatches.length).toBeGreaterThan(0);
      for (const match of statusSpanMatches) {
        expect(match[1]).not.toMatch(/danger|error|alarm|red/i);
      }
      expect(html).not.toMatch(/banner--error/);
    });

    it('no party-color class anywhere on the page (neutrality — party is text only)', async () => {
      const html = normalize(await (await renderWardCandidates('en', WARD.id)).text());
      expect(html).not.toMatch(/class="[^"]*party-color[^"]*"/);
      expect(html).not.toMatch(/class="[^"]*party--[a-z]+[^"]*"/);
    });
  });

  describe('empty ward (no candidates yet) -> 200 (NOT 404) + empty state', () => {
    it.each(['en', 'kn'] as const)('%s: 200 with the pre-notification empty state + register prompt', async (lang) => {
      const res = await renderWardCandidates(lang, EMPTY_WARD.id);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain(escApos(t(lang, 'ward.candidates.empty.awaited')));
      expect(html).toContain(t(lang, 'common.registerForUpdates'));
      expect(html).toMatch(
        /data-register-slot[^>]*data-ward-id="96202"|data-ward-id="96202"[^>]*data-register-slot/,
      );
    });

    it('%s: empty state does NOT show the provisional marker', async () => {
      const html = normalize(await (await renderWardCandidates('en', EMPTY_WARD.id)).text());
      expect(html).toContain(escApos(t('en', 'ward.candidates.empty.awaited')));
      expect(html).not.toContain(t('en', 'candidate.provisionalMarker'));
    });

    it('uses the notification date wording once app_settings.notification_date is set', async () => {
      await db
        .insert(schema.appSettings)
        .values({ key: 'notification_date', value: '2026-08-15' })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: '2026-08-15' } });

      try {
        const html = normalize(await (await renderWardCandidates('en', EMPTY_WARD.id)).text());
        expect(html).toContain(escApos(t('en', 'ward.candidates.empty.fact', { date: '2026-08-15' })));
      } finally {
        // Always clean up, even on assertion failure — leaving this set
        // would silently break the OTHER "awaited" tests on the next run.
        await db.delete(schema.appSettings).where(eq(schema.appSettings.key, 'notification_date'));
      }
    });
  });

  describe('unknown ward id -> real 404 (route twin)', () => {
    it.each(['en', 'kn'] as const)('%s: a well-formed but non-existent id 404s', async (lang) => {
      const res = await renderWardCandidates(lang, 999999);
      expect(res.status).toBe(404);
    });

    it.each(['en', 'kn'] as const)('%s: a non-numeric id 404s', async (lang) => {
      const res = await renderWardCandidates(lang, 'not-a-number');
      expect(res.status).toBe(404);
    });
  });

  describe('provisional marker (app_settings.withdrawals_closed, PRD §5.2)', () => {
    it('shown when withdrawals_closed is not set to "true"', async () => {
      const html = normalize(await (await renderWardCandidates('en', WARD.id)).text());
      expect(html).toContain(t('en', 'candidate.provisionalMarker'));
    });

    it('absent once withdrawals_closed is "true"', async () => {
      await db
        .insert(schema.appSettings)
        .values({ key: 'withdrawals_closed', value: 'true' })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: 'true' } });

      try {
        const html = normalize(await (await renderWardCandidates('en', WARD.id)).text());
        expect(html).not.toContain(t('en', 'candidate.provisionalMarker'));
      } finally {
        await db.delete(schema.appSettings).where(eq(schema.appSettings.key, 'withdrawals_closed'));
      }
    });
  });

  describe('Compare entry point (forward reference to Task 43)', () => {
    it('links to /ward/{id}/compare', async () => {
      const html = normalize(await (await renderWardCandidates('en', WARD.id)).text());
      expect(html).toContain(`href="${localePath('en', `/ward/${WARD.id}/compare`)}"`);
    });
  });

  describe('register-for-updates slot (anonymous-only, cache-safe)', () => {
    it('renders the anonymous control with data-register-slot/data-ward-id', async () => {
      const html = normalize(await (await renderWardCandidates('en', WARD.id)).text());
      expect(html).toContain(t('en', 'common.registerForUpdates'));
      expect(html).toMatch(
        /data-register-slot[^>]*data-ward-id="96201"|data-ward-id="96201"[^>]*data-register-slot/,
      );
      expect(html).toContain(`href="${localePath('en', '/login')}"`);
    });

    it('server markup is byte-identical whether or not the request carries a session cookie (cache invariant)', async () => {
      const noCookie = normalize(await (await renderWardCandidates('en', WARD.id)).text());
      const withCookie = normalize(
        await (await renderWardCandidates('en', WARD.id, { cookie: 'session=some-signed-in-users-session-id' })).text(),
      );
      expect(withCookie).toBe(noCookie);
    });
  });

  describe('lang attribute + hreflang pair', () => {
    it('sets <html lang> and emits the en/kn hreflang alternates', async () => {
      const enHtml = normalize(await (await renderWardCandidates('en', WARD.id)).text());
      const knHtml = normalize(await (await renderWardCandidates('kn', WARD.id)).text());

      expect(enHtml).toMatch(/<html lang="en"/);
      expect(knHtml).toMatch(/<html lang="kn"/);
      expect(enHtml).toContain(
        `<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/ward/${WARD.id}/candidates">`,
      );
      expect(enHtml).toContain(
        `<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/ward/${WARD.id}/candidates">`,
      );
      expect(knHtml).toContain(
        `<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/ward/${WARD.id}/candidates">`,
      );
      expect(knHtml).toContain(
        `<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/ward/${WARD.id}/candidates">`,
      );
    });
  });
});

/**
 * Candidate comparison (`/ward/{id}/compare`, `/kn/ward/{id}/compare`) —
 * Task 43, IA §3.5, PRD §5.3, design-system §5.5/§4. Drives every request
 * through the REAL route twins + a real DB, same technique as
 * tests/routes/ward-candidates.test.ts / candidate.test.ts.
 *
 * COVERAGE MAP:
 *   - ward with 3 filed/contesting candidates -> 200; all three appear as
 *     columns; the report-card field rows render each candidate's value.
 *   - LOAD-BEARING: withdrawn/rejected candidates seeded alongside -> their
 *     names/values are absent from the compare grid entirely (unlike the
 *     candidates-in-ward list, which shows every status).
 *   - ALPHABETICAL column order (seeded out of order).
 *   - NO HARD CAP: 8 candidates all appear; the horizontal-scroll container
 *     + pinned field-label column exist in the markup (class/style check).
 *   - neutrality: no party-color class; cases render in plain ink (no
 *     danger/alarm class); every candidate column carries identical markup.
 *   - zero filed/contesting -> empty state at 200, not a broken table, not 404.
 *   - unknown ward -> 404.
 *   - field labels line up with the report card's own field set.
 *   - cache-safe (byte-identical with/without a session cookie); lang/hreflang.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { localePath, t, type Lang } from '../../src/i18n';
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

// High, task-specific id range (Task 43) so this suite never collides with
// another test file's fixtures in the shared (not reset-between-files) test
// DB — see tests/routes/ward.test.ts's own note for the same convention.
const WARD = {
  id: 96301,
  nameEn: 'Compare Test Ward',
  nameKn: 'ಹೋಲಿಕೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone CMP',
  boundaryRef: 'compare-test-ward',
};

const EMPTY_WARD = {
  id: 96302,
  nameEn: 'Compare Empty Test Ward',
  nameKn: 'ಹೋಲಿಕೆ ಖಾಲಿ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'north' as const,
  zone: 'Zone CMP',
  boundaryRef: 'compare-empty-test-ward',
};

// track_record, cases, assets, education, approachability, news — same
// field set as the report card (PRD §5.3).
const REPORT_CARD_ROW_COUNT = 6;

const MANY_WARD = {
  id: 96303,
  nameEn: 'Compare Many Test Ward',
  nameKn: 'ಹೋಲಿಕೆ ಅನೇಕ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'east' as const,
  zone: 'Zone CMP',
  boundaryRef: 'compare-many-test-ward',
};

function escApos(s: string): string {
  return s.replace(/'/g, '&#39;');
}

function escAmp(s: string): string {
  return s.replace(/&/g, '&amp;');
}

/** Scopes an assertion to just the <table class="compare-table">…</table> markup, so a check for e.g. "no error-ish class" isn't tripped up by Base.astro's globally-mounted Flag/Vote/RegisterLogin modals (which legitimately use a `form-error` class elsewhere on the page). */
function extractTable(html: string): string {
  const start = html.indexOf('<table class="compare-table">');
  const end = html.indexOf('</table>', start) + '</table>'.length;
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, end);
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
  return lang === 'kn' ? CompareKn : CompareEn;
}

async function renderCompare(lang: Lang, id: number | string, extraHeaders?: Record<string, string>): Promise<Response> {
  const container = await makeContainer();
  const path = localePath(lang, `/ward/${id}/compare`);
  return container.renderToResponse(twinFor(lang), {
    partial: false,
    params: { id: String(id) },
    request: new Request(`${SITE_ORIGIN}${path}`, { headers: extraHeaders }),
  });
}

describe('Candidate comparison (/ward/{id}/compare) — IA §3.5, PRD §5.3', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
    await db.insert(schema.wards).values(EMPTY_WARD).onConflictDoUpdate({ target: schema.wards.id, set: EMPTY_WARD });
    await db.insert(schema.wards).values(MANY_WARD).onConflictDoUpdate({ target: schema.wards.id, set: MANY_WARD });

    // Clean any leftover fixtures from a previous run of this file.
    for (const wardId of [WARD.id, EMPTY_WARD.id, MANY_WARD.id]) {
      const existing = await db.select({ id: schema.candidates.id }).from(schema.candidates).where(eq(schema.candidates.wardId, wardId));
      const ids = existing.map((c) => c.id);
      if (ids.length > 0) {
        await db.delete(schema.candidateNewsLinks).where(inArray(schema.candidateNewsLinks.candidateId, ids));
        await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, ids));
      }
      await db.delete(schema.candidates).where(eq(schema.candidates.wardId, wardId));
    }

    // WARD: seeded deliberately OUT OF alphabetical order, mixing
    // filed/contesting (comparable) with withdrawn/rejected (must be
    // excluded entirely — PRD §5.3, the load-bearing case).
    await db.insert(schema.candidates).values({
      slug: 'compare-test-zainab',
      wardId: WARD.id,
      nameEn: 'Zainab Contesting',
      nameKn: 'ಝೈನಬ್ ಸ್ಪರ್ಧಿ',
      partyEn: 'Independent',
      status: 'contesting',
    });

    const [arjun] = await db
      .insert(schema.candidates)
      .values({
        slug: 'compare-test-arjun',
        wardId: WARD.id,
        nameEn: 'Arjun Filed',
        nameKn: 'ಅರ್ಜುನ್ ಸಲ್ಲಿಕೆ',
        partyEn: 'Example Party',
        status: 'filed',
      })
      .returning({ id: schema.candidates.id });

    await db.insert(schema.candidates).values({
      slug: 'compare-test-bhavana',
      wardId: WARD.id,
      nameEn: 'Bhavana Filed',
      nameKn: 'ಭಾವನಾ ಸಲ್ಲಿಕೆ',
      partyEn: 'Example Party',
      status: 'filed',
    });

    await db.insert(schema.candidates).values({
      slug: 'compare-test-meena',
      wardId: WARD.id,
      nameEn: 'Meena Withdrawn',
      nameKn: 'ಮೀನಾ ಹಿಂಪಡೆದ',
      partyEn: 'Independent',
      status: 'withdrawn',
    });

    await db.insert(schema.candidates).values({
      slug: 'compare-test-rekha',
      wardId: WARD.id,
      nameEn: 'Rekha Rejected',
      nameKn: 'ರೇಖಾ ತಿರಸ್ಕೃತ',
      partyEn: 'Example Party',
      status: 'rejected',
    });

    // Arjun's fields: cases populated + affidavit-sourced (plain ink, no
    // alarm styling), assets explicitly not declared.
    await db.insert(schema.candidateFields).values([
      {
        candidateId: arjun!.id,
        fieldKey: 'cases',
        valueEn: 'No pending cases declared in the affidavit.',
        valueKn: null,
        sourceType: 'official',
        sourceUrl: '/media/1/deadbeefcafefeed',
        authoredLang: 'en',
        translationStatus: 'done',
      },
      {
        candidateId: arjun!.id,
        fieldKey: 'assets',
        notDeclared: true,
        sourceType: 'official',
        sourceUrl: '/media/1/deadbeefcafefeed',
        authoredLang: 'en',
        translationStatus: 'done',
      },
    ]);

    // EMPTY_WARD: only a withdrawn candidate on file -> zero filed/contesting.
    await db.insert(schema.candidates).values({
      slug: 'compare-test-empty-withdrawn',
      wardId: EMPTY_WARD.id,
      nameEn: 'Empty Ward Withdrawn',
      nameKn: 'ಖಾಲಿ ವಾರ್ಡ್ ಹಿಂಪಡೆದ',
      partyEn: 'Independent',
      status: 'withdrawn',
    });

    // MANY_WARD: 8 filed/contesting candidates — NO hard cap (PRD §5.3).
    const manyValues = Array.from({ length: 8 }, (_, i) => {
      const letter = String.fromCharCode(67 + i); // C, D, E, F, G, H, I, J
      return {
        slug: `compare-test-many-${i}`,
        wardId: MANY_WARD.id,
        nameEn: `Candidate Many${i} ${letter}`,
        nameKn: `ಅಭ್ಯರ್ಥಿ ${i}`,
        partyEn: 'Example Party',
        status: (i % 2 === 0 ? 'filed' : 'contesting') as 'filed' | 'contesting',
      };
    });
    await db.insert(schema.candidates).values(manyValues);
  });

  afterAll(async () => {
    for (const wardId of [WARD.id, EMPTY_WARD.id, MANY_WARD.id]) {
      const existing = await db.select({ id: schema.candidates.id }).from(schema.candidates).where(eq(schema.candidates.wardId, wardId));
      const ids = existing.map((c) => c.id);
      if (ids.length > 0) {
        await db.delete(schema.candidateNewsLinks).where(inArray(schema.candidateNewsLinks.candidateId, ids));
        await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, ids));
      }
      await db.delete(schema.candidates).where(eq(schema.candidates.wardId, wardId));
    }
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, 'withdrawals_closed'));
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, 'notification_date'));
    await client.end();
  });

  describe('ward with 3 filed/contesting candidates', () => {
    it.each(['en', 'kn'] as const)('%s: 200, all three appear as columns with field values', async (lang) => {
      const res = await renderCompare(lang, WARD.id);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());

      const names =
        lang === 'kn'
          ? ['ಝೈನಬ್ ಸ್ಪರ್ಧಿ', 'ಅರ್ಜುನ್ ಸಲ್ಲಿಕೆ', 'ಭಾವನಾ ಸಲ್ಲಿಕೆ']
          : ['Zainab Contesting', 'Arjun Filed', 'Bhavana Filed'];
      for (const name of names) {
        expect(html).toContain(name);
      }

      expect(html).toContain(`href="${localePath(lang, '/candidate/compare-test-arjun')}"`);
      expect(html).toContain(`href="${localePath(lang, '/candidate/compare-test-zainab')}"`);
      expect(html).toContain(`href="${localePath(lang, '/candidate/compare-test-bhavana')}"`);
    });

    it('renders each candidate\'s field values (cases populated, assets not declared)', async () => {
      const html = normalize(await (await renderCompare('en', WARD.id)).text());
      expect(html).toContain('No pending cases declared in the affidavit.');
      expect(html).toContain(t('en', 'common.notDeclared'));
    });
  });

  describe('WITHDRAWN/REJECTED EXCLUDED (PRD §5.3, load-bearing)', () => {
    it('withdrawn and rejected candidate names/values do NOT appear anywhere in the compare grid', async () => {
      const html = normalize(await (await renderCompare('en', WARD.id)).text());
      expect(html).not.toContain('Meena Withdrawn');
      expect(html).not.toContain('Rekha Rejected');
      expect(html).not.toContain('compare-test-meena');
      expect(html).not.toContain('compare-test-rekha');
    });
  });

  describe('ALPHABETICAL column order (design-system §4.3, never ranked)', () => {
    it('columns render alphabetically regardless of insertion/status-mixed seeding', async () => {
      const html = normalize(await (await renderCompare('en', WARD.id)).text());
      const idxArjun = html.indexOf('Arjun Filed');
      const idxBhavana = html.indexOf('Bhavana Filed');
      const idxZainab = html.indexOf('Zainab Contesting');

      expect(idxArjun).toBeGreaterThan(-1);
      expect(idxBhavana).toBeGreaterThan(idxArjun);
      expect(idxZainab).toBeGreaterThan(idxBhavana);
    });
  });

  describe('NO HARD CAP + horizontal scroll / pinned label column (PRD §5.3)', () => {
    it('all 8 seeded candidates appear — no truncation', async () => {
      const html = normalize(await (await renderCompare('en', MANY_WARD.id)).text());
      for (let i = 0; i < 8; i++) {
        expect(html).toContain(`Many${i}`);
        expect(html).toContain(`href="${localePath('en', `/candidate/compare-test-many-${i}`)}"`);
      }
    });

    it('the horizontal-scroll container and sticky field-label column exist in the markup (class check)', async () => {
      const html = normalize(await (await renderCompare('en', MANY_WARD.id)).text());
      // .compare-scroll is styled `overflow-x: auto` and .sticky-col
      // `position: sticky; left: 0` in Compare.astro's own <style> block —
      // asserted here as the class markup, per the brief ("a class/style
      // check"), since scoped-style CSS text isn't inlined into this
      // response body.
      expect(html).toMatch(/class="compare-scroll"/);
      const tableHtml = extractTable(html);
      // Every row's label cell (including the header row's empty corner
      // cell) carries the pinned sticky-col class.
      const labelCells = [...tableHtml.matchAll(/class="label-col sticky-col"/g)];
      expect(labelCells.length).toBe(1 + REPORT_CARD_ROW_COUNT); // header corner + 6 field rows
    });
  });

  describe('neutrality (design-system §4)', () => {
    it('no party-color class anywhere on the page', async () => {
      const html = normalize(await (await renderCompare('en', WARD.id)).text());
      expect(html).not.toMatch(/class="[^"]*party-color[^"]*"/);
      expect(html).not.toMatch(/class="[^"]*party--[a-z]+[^"]*"/);
    });

    it('cases render in plain ink — no danger/alarm class on the field value', async () => {
      const html = normalize(await (await renderCompare('en', WARD.id)).text());
      const tableHtml = extractTable(html);
      expect(tableHtml).toContain('No pending cases declared in the affidavit.');
      expect(tableHtml).not.toMatch(/class="[^"]*(danger|alarm|error)[^"]*"/i);
    });

    it('every candidate header/column carries identical markup (same class, no per-candidate variant)', async () => {
      const html = normalize(await (await renderCompare('en', WARD.id)).text());
      const headerCells = [...html.matchAll(/<th scope="col" class="([^"]*)">/g)].filter((m) => m[1] !== 'label-col sticky-col');
      expect(headerCells.length).toBeGreaterThanOrEqual(3);
      const uniqueClasses = new Set(headerCells.map((m) => m[1]));
      expect(uniqueClasses.size).toBe(1);
      expect([...uniqueClasses][0]).toBe('candidate-col');
    });
  });

  describe('ZERO filed/contesting -> empty state at 200 (not a broken table, not 404)', () => {
    it.each(['en', 'kn'] as const)('%s: 200 with the empty state, no table markup', async (lang) => {
      const res = await renderCompare(lang, EMPTY_WARD.id);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain(escApos(t(lang, 'compare.empty.awaited')));
      expect(html).not.toContain('<table');
      expect(html).not.toContain('Empty Ward Withdrawn');
    });

    it('uses the notification-date wording once app_settings.notification_date is set', async () => {
      await db
        .insert(schema.appSettings)
        .values({ key: 'notification_date', value: '2026-08-20' })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: '2026-08-20' } });

      try {
        const html = normalize(await (await renderCompare('en', EMPTY_WARD.id)).text());
        expect(html).toContain(escApos(t('en', 'compare.empty.fact', { date: '2026-08-20' })));
      } finally {
        await db.delete(schema.appSettings).where(eq(schema.appSettings.key, 'notification_date'));
      }
    });

    it('empty state links back to the ward and offers the register prompt', async () => {
      const html = normalize(await (await renderCompare('en', EMPTY_WARD.id)).text());
      expect(html).toContain(`href="${localePath('en', `/ward/${EMPTY_WARD.id}`)}"`);
      expect(html).toContain(t('en', 'common.registerForUpdates'));
    });
  });

  describe('unknown ward id -> real 404 (route twin)', () => {
    it.each(['en', 'kn'] as const)('%s: a well-formed but non-existent id 404s', async (lang) => {
      const res = await renderCompare(lang, 999999);
      expect(res.status).toBe(404);
    });

    it.each(['en', 'kn'] as const)('%s: a non-numeric id 404s', async (lang) => {
      const res = await renderCompare(lang, 'not-a-number');
      expect(res.status).toBe(404);
    });
  });

  describe('fields line up with the report card (same field set)', () => {
    it('all five report-card field labels plus News & coverage render as row labels', async () => {
      const html = normalize(await (await renderCompare('en', WARD.id)).text());
      expect(html).toContain(t('en', 'candidate.field.trackRecord'));
      expect(html).toContain(t('en', 'candidate.field.cases'));
      expect(html).toContain(t('en', 'candidate.field.assets'));
      expect(html).toContain(t('en', 'candidate.field.education'));
      expect(html).toContain(t('en', 'candidate.field.approachability'));
      expect(html).toContain(escAmp(t('en', 'candidate.news.heading')));
    });
  });

  describe('cache-safety', () => {
    it('server markup is byte-identical whether or not the request carries a session cookie', async () => {
      const noCookie = normalize(await (await renderCompare('en', WARD.id)).text());
      const withCookie = normalize(
        await (await renderCompare('en', WARD.id, { cookie: 'session=some-signed-in-users-session-id' })).text(),
      );
      expect(withCookie).toBe(noCookie);
    });
  });

  describe('lang attribute + hreflang pair', () => {
    it('sets <html lang> and emits the en/kn hreflang alternates', async () => {
      const enHtml = normalize(await (await renderCompare('en', WARD.id)).text());
      const knHtml = normalize(await (await renderCompare('kn', WARD.id)).text());

      expect(enHtml).toMatch(/<html lang="en"/);
      expect(knHtml).toMatch(/<html lang="kn"/);
      expect(enHtml).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/ward/${WARD.id}/compare">`);
      expect(enHtml).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/ward/${WARD.id}/compare">`);
      expect(knHtml).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/ward/${WARD.id}/compare">`);
      expect(knHtml).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/ward/${WARD.id}/compare">`);
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { localePath, t, type Lang } from '../../src/i18n';
import WardIssuesEn from '../../src/pages/ward/[id]/issues.astro';
import WardIssuesKn from '../../src/pages/kn/ward/[id]/issues.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific id (task-20 brief) so this suite never collides with
// another test file's ward fixtures in the shared (not reset-between-files)
// test DB — votes.test.ts (lib-level fixtures) owns 94001, this route suite
// owns 94002.
const WARD = {
  id: 94002,
  nameEn: 'Ward Issues Test Ward',
  nameKn: 'ವಾರ್ಡ್ ಸಮಸ್ಯೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone I',
  boundaryRef: 'ward-issues-test-ward',
};

const EMPTY_WARD = {
  id: 94003,
  nameEn: 'Ward Issues Empty Test Ward',
  nameKn: 'ವಾರ್ಡ್ ಸಮಸ್ಯೆ ಖಾಲಿ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'north' as const,
  zone: 'Zone I',
  boundaryRef: 'ward-issues-empty-test-ward',
};

/**
 * Strips the container API's dev-mode debug attributes and collapses
 * incidental whitespace (see tests/routes/ward.test.ts for the same
 * helper/rationale).
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
  return lang === 'kn' ? WardIssuesKn : WardIssuesEn;
}

async function renderWardIssues(
  lang: Lang,
  id: number | string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const container = await makeContainer();
  const path = localePath(lang, `/ward/${id}/issues`);
  return container.renderToResponse(twinFor(lang), {
    partial: false,
    params: { id: String(id) },
    request: new Request(`${SITE_ORIGIN}${path}`, { headers: extraHeaders }),
  });
}

describe('Ward issues & voting page (/ward/{id}/issues) — IA §3.6, PRD §5.4/§5.5', () => {
  let issueRoads: number;
  let candidateContesting: number;
  let candidateWithdrawn: number;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
    await db
      .insert(schema.wards)
      .values(EMPTY_WARD)
      .onConflictDoUpdate({ target: schema.wards.id, set: EMPTY_WARD });

    // Clean any leftover fixtures from a previous run of this file. Deleting
    // ward_issues cascades their candidate_stances rows first, so the
    // candidates delete below never hits a dangling FK reference.
    await db.delete(schema.wardIssues).where(eq(schema.wardIssues.wardId, WARD.id));
    await db.delete(schema.candidates).where(eq(schema.candidates.wardId, WARD.id));

    const [roads] = await db
      .insert(schema.wardIssues)
      .values({ wardId: WARD.id, titleEn: 'Roads', titleKn: 'ರಸ್ತೆಗಳು', position: 0 })
      .returning({ id: schema.wardIssues.id });
    issueRoads = roads!.id;

    await db
      .insert(schema.wardIssues)
      .values({ wardId: WARD.id, titleEn: 'Water supply', titleKn: 'ನೀರು ಸರಬರಾಜು', position: 1 })
      .returning({ id: schema.wardIssues.id });

    const [contesting] = await db
      .insert(schema.candidates)
      .values({
        slug: 'ward-issues-test-contesting',
        wardId: WARD.id,
        nameEn: 'Contesting Candidate',
        partyEn: 'Independent',
        status: 'contesting',
      })
      .returning({ id: schema.candidates.id });
    candidateContesting = contesting!.id;

    const [withdrawn] = await db
      .insert(schema.candidates)
      .values({
        slug: 'ward-issues-test-withdrawn',
        wardId: WARD.id,
        nameEn: 'Withdrawn Candidate',
        partyEn: 'Independent',
        status: 'withdrawn',
      })
      .returning({ id: schema.candidates.id });
    candidateWithdrawn = withdrawn!.id;

    await db.insert(schema.candidateStances).values({
      wardIssueId: issueRoads,
      candidateId: candidateContesting,
      valueEn: 'Will fix potholes within 6 months',
      valueKn: 'ಆರು ತಿಂಗಳಲ್ಲಿ ಗುಂಡಿಗಳನ್ನು ಸರಿಪಡಿಸುತ್ತೇನೆ',
      sourceType: 'curator',
    });
    await db.insert(schema.candidateStances).values({
      wardIssueId: issueRoads,
      candidateId: candidateWithdrawn,
      valueEn: 'Should never appear',
      valueKn: 'ಎಂದಿಗೂ ಕಾಣಿಸಬಾರದು',
      sourceType: 'curator',
    });
    // issueWater intentionally has no stances — "if no stances, just show the issue".
  });

  afterAll(async () => {
    await client.end();
  });

  describe('empty issue list -> EmptyState', () => {
    it.each(['en', 'kn'] as const)('%s: renders the Phase-1 empty state', async (lang) => {
      const res = await renderWardIssues(lang, EMPTY_WARD.id);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain(t(lang, 'ward.issues.empty.fact'));
      expect(html).toContain(t(lang, 'ward.issues.empty.nextStep'));
    });
  });

  describe('with issues', () => {
    it.each(['en', 'kn'] as const)('%s: renders issue titles and keeps voting/results off this detail page', async (lang) => {
      const res = await renderWardIssues(lang, WARD.id);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());

      const roadsTitle = lang === 'kn' ? 'ರಸ್ತೆಗಳು' : 'Roads';
      const waterTitle = lang === 'kn' ? 'ನೀರು ಸರಬರಾಜು' : 'Water supply';
      expect(html).toContain(roadsTitle);
      expect(html).toContain(waterTitle);

      expect(html).not.toContain('data-vote-action');
      expect(html).not.toContain('data-issue-bars');
    });

    it.each(['en', 'kn'] as const)('%s: withdrawn candidate stance is excluded; contesting stance is shown with source', async (lang) => {
      const res = await renderWardIssues(lang, WARD.id);
      const html = normalize(await res.text());

      expect(html).not.toContain('Withdrawn Candidate');
      expect(html).not.toContain('Should never appear');
      expect(html).not.toContain('ಎಂದಿಗೂ ಕಾಣಿಸಬಾರದು');

      expect(html).toContain('Contesting Candidate');
      const stanceValue = lang === 'kn' ? 'ಆರು ತಿಂಗಳಲ್ಲಿ ಗುಂಡಿಗಳನ್ನು ಸರಿಪಡಿಸುತ್ತೇನೆ' : 'Will fix potholes within 6 months';
      expect(html).toContain(stanceValue);
      expect(html).toContain(t(lang, 'common.source.curator'));
    });
  });

  describe('register-for-updates slot', () => {
    it.each(['en', 'kn'] as const)('%s: renders registration but no voting control', async (lang) => {
      const res = await renderWardIssues(lang, WARD.id);
      const html = normalize(await res.text());

      expect(html).not.toContain('data-vote-action');

      expect(html).toContain(t(lang, 'common.registerForUpdates'));
      expect(html).toMatch(
        /data-register-slot[^>]*data-ward-id="94002"|data-ward-id="94002"[^>]*data-register-slot/,
      );
      expect(html).toContain(`href="${localePath(lang, '/login')}"`);
    });

    it('server markup is byte-identical whether or not the request carries a session cookie (cache invariant)', async () => {
      const noCookie = normalize(await (await renderWardIssues('en', WARD.id)).text());
      const withCookie = normalize(
        await (await renderWardIssues('en', WARD.id, { cookie: 'session=some-signed-in-users-session-id' })).text(),
      );
      expect(withCookie).toBe(noCookie);
    });
  });

  describe('unknown ward id -> real 404 (route twin)', () => {
    it.each(['en', 'kn'] as const)('%s: a well-formed but non-existent id 404s', async (lang) => {
      const res = await renderWardIssues(lang, 999999);
      expect(res.status).toBe(404);
    });

    it.each(['en', 'kn'] as const)('%s: a non-numeric id 404s', async (lang) => {
      const res = await renderWardIssues(lang, 'not-a-number');
      expect(res.status).toBe(404);
    });
  });

  describe('lang attribute + hreflang pair', () => {
    it('sets <html lang> and emits the en/kn hreflang alternates', async () => {
      const enHtml = normalize(await (await renderWardIssues('en', WARD.id)).text());
      const knHtml = normalize(await (await renderWardIssues('kn', WARD.id)).text());

      expect(enHtml).toMatch(/<html lang="en"/);
      expect(knHtml).toMatch(/<html lang="kn"/);
      expect(enHtml).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/ward/${WARD.id}/issues">`);
      expect(enHtml).toContain(
        `<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/ward/${WARD.id}/issues">`,
      );
      expect(knHtml).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/ward/${WARD.id}/issues">`);
      expect(knHtml).toContain(
        `<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/ward/${WARD.id}/issues">`,
      );
    });
  });
});

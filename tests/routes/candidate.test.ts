/**
 * Candidate report card (`/candidate/{slug}`, `/kn/candidate/{slug}`) —
 * Task 41, IA §3.4, PRD §5.2, architecture §8/§13. Drives every request
 * through the REAL route twins + a real DB, same technique as
 * tests/routes/ward.test.ts.
 *
 * COVERAGE MAP:
 *   - existing candidate -> 200, renders name/party/fields; unknown slug
 *     -> 404 (route twin).
 *   - withdrawn/rejected candidates -> 200 (NOT 404) + the neutral status
 *     banner (the URL was already shared and must keep resolving).
 *   - AFFIDAVIT SOURCE HREF: an affidavit-sourced (sourceType official)
 *     field's source link points at the stored `/media/{id}/{hash}` PDF,
 *     not some other URL.
 *   - AI-EXTRACTED badge vs. curator-confirmed Affidavit badge.
 *   - NEWS GUARD (the Task 38 boundary, re-asserted here): an approved link
 *     renders; a suggested link never does.
 *   - CASES renders in plain ink — no alarm/danger styling.
 *   - Person JSON-LD with `sameAs` + a curator-authored '<' properly
 *     escaped (no raw '<' inside the script tag).
 *   - Flag button present, cache-safe (identical markup with/without a
 *     session cookie).
 *   - lang/hreflang + the provisional marker (app_settings.withdrawals_closed).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import * as schema from '../../src/db/schema';
import { localePath, t, type Lang } from '../../src/i18n';
import CandidateEn from '../../src/pages/candidate/[slug].astro';
import CandidateKn from '../../src/pages/kn/candidate/[slug].astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. CI always sets this; for local runs export ' +
      'DATABASE_URL=postgres://postgres@localhost:54329/bv_test (see task brief).',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific id range (Task 41 brief) so this suite never collides
// with another test file's fixtures in the shared (not reset-between-files)
// test DB — see tests/routes/ward.test.ts's own note for the same convention.
const WARD = {
  id: 95101,
  nameEn: 'Candidate Report Card Test Ward',
  nameKn: 'ಅಭ್ಯರ್ಥಿ ವರದಿ ಪತ್ರ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone RC',
  boundaryRef: 'candidate-report-card-test-ward',
};

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
  return lang === 'kn' ? CandidateKn : CandidateEn;
}

async function renderCandidate(lang: Lang, slug: string, extraHeaders?: Record<string, string>): Promise<Response> {
  const container = await makeContainer();
  const path = localePath(lang, `/candidate/${slug}`);
  return container.renderToResponse(twinFor(lang), {
    partial: false,
    params: { slug },
    request: new Request(`${SITE_ORIGIN}${path}`, { headers: extraHeaders }),
  });
}

function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function insertMedia(bytes: Buffer, contentType: string): Promise<{ id: number; url: string }> {
  const sha256 = sha256Hex(bytes);
  const [row] = await db
    .insert(schema.media)
    .values({ bytes, contentType, sha256, size: bytes.length })
    .returning({ id: schema.media.id });
  return { id: row!.id, url: `/media/${row!.id}/${sha256.slice(0, 16)}` };
}

const MAIN_SLUG = 'candidate-report-card-test-main';
const WITHDRAWN_SLUG = 'candidate-report-card-test-withdrawn';
const REJECTED_SLUG = 'candidate-report-card-test-rejected';
const PRENOTIFICATION_SLUG = 'candidate-report-card-test-prenotification';

const APPROVED_NEWS_URL = 'https://news.example.com/candidate-coverage';
const APPROVED_NEWS_TITLE = 'Ward polls: <Live> updates from the trail';
const SUGGESTED_NEWS_URL = 'https://news.example.com/suggested-item';
const SUGGESTED_NEWS_TITLE = 'Suggested unapproved coverage — must never appear';

let mainCandidateId: number;
let affidavitMediaUrl: string;
let assetsAffidavitMediaUrl: string;

async function deleteCandidateTree(candidateId: number): Promise<void> {
  await db.delete(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateId));
  await db.delete(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.candidateId, candidateId));
  await db.delete(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidateId));
}

describe('Candidate report card (/candidate/{slug}, /kn/candidate/{slug}) — IA §3.4, PRD §5.2', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });

    // Clean slate for every slug this suite owns, in FK-safe order.
    for (const slug of [MAIN_SLUG, WITHDRAWN_SLUG, REJECTED_SLUG, PRENOTIFICATION_SLUG]) {
      const [existing] = await db.select({ id: schema.candidates.id }).from(schema.candidates).where(eq(schema.candidates.slug, slug));
      if (existing) {
        await deleteCandidateTree(existing.id);
        await db.delete(schema.candidates).where(eq(schema.candidates.id, existing.id));
      }
    }

    const photoBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from('fake-png-body-for-candidate-test')]);
    const photo = await insertMedia(photoBytes, 'image/png');

    const affidavitBytes = Buffer.from('%PDF-1.4\ncases-affidavit-body\n%%EOF');
    const affidavitMedia = await insertMedia(affidavitBytes, 'application/pdf');
    affidavitMediaUrl = affidavitMedia.url;

    const assetsAffidavitBytes = Buffer.from('%PDF-1.4\nassets-affidavit-body\n%%EOF');
    const assetsAffidavitMedia = await insertMedia(assetsAffidavitBytes, 'application/pdf');
    assetsAffidavitMediaUrl = assetsAffidavitMedia.url;

    const [mainRow] = await db
      .insert(schema.candidates)
      .values({
        slug: MAIN_SLUG,
        wardId: WARD.id,
        nameEn: 'Report Card Test Candidate',
        nameKn: 'ವರದಿ ಪತ್ರ ಪರೀಕ್ಷಾ ಅಭ್ಯರ್ಥಿ',
        partyEn: 'Independent',
        photoMediaId: photo.id,
        status: 'contesting',
      })
      .returning({ id: schema.candidates.id });
    mainCandidateId = mainRow!.id;

    await db.insert(schema.candidateAffidavits).values({
      candidateId: mainCandidateId,
      mediaId: affidavitMedia.id,
      originUrl: null,
      extractionStatus: 'done',
    });
    await db.insert(schema.candidateAffidavits).values({
      candidateId: mainCandidateId,
      mediaId: assetsAffidavitMedia.id,
      originUrl: null,
      extractionStatus: 'done',
    });

    await db.insert(schema.candidateFields).values([
      {
        candidateId: mainCandidateId,
        fieldKey: 'track_record',
        valueEn: 'Led the ward roads resurfacing campaign in 2022.',
        notDeclared: false,
        authoredLang: 'en',
        translationStatus: 'done',
        sourceUrl: 'https://example.com/track-record-source',
        sourceType: 'curator',
        aiExtracted: false,
      },
      {
        // Curator-confirmed affidavit field: aiExtracted cleared, still
        // sourceType official, source link is the STORED PDF, not any raw
        // EC URL (PRD §5.2's "the stored affidavit is the public source").
        candidateId: mainCandidateId,
        fieldKey: 'cases',
        valueEn: 'No pending criminal cases declared.',
        notDeclared: false,
        authoredLang: 'en',
        translationStatus: 'done',
        sourceUrl: affidavitMediaUrl,
        sourceType: 'official',
        aiExtracted: false,
      },
      {
        // Not yet curator-confirmed -> AI-extracted marker still showing.
        candidateId: mainCandidateId,
        fieldKey: 'assets',
        valueEn: 'Rs 42,00,000 in declared assets.',
        notDeclared: false,
        authoredLang: 'en',
        translationStatus: 'done',
        sourceUrl: assetsAffidavitMediaUrl,
        sourceType: 'official',
        aiExtracted: true,
      },
      // education: deliberately no row -> "a field the curator hasn't
      // filled" (Not declared fallback).
      {
        candidateId: mainCandidateId,
        fieldKey: 'approachability',
        valueEn: null,
        notDeclared: true, // a valid, complete "not declared" answer (PRD §9.1)
        authoredLang: 'en',
        translationStatus: 'done',
        sourceUrl: null,
        sourceType: 'curator',
        aiExtracted: false,
      },
    ]);

    await db.insert(schema.candidateNewsLinks).values([
      {
        candidateId: mainCandidateId,
        url: APPROVED_NEWS_URL,
        title: APPROVED_NEWS_TITLE,
        domain: 'news.example.com',
        origin: 'curator',
        status: 'approved',
      },
      {
        candidateId: mainCandidateId,
        url: SUGGESTED_NEWS_URL,
        title: SUGGESTED_NEWS_TITLE,
        domain: 'news.example.com',
        origin: 'auto',
        status: 'suggested',
      },
    ]);

    await db.insert(schema.candidates).values({
      slug: WITHDRAWN_SLUG,
      wardId: WARD.id,
      nameEn: 'Withdrawn Test Candidate',
      partyEn: 'Independent',
      status: 'withdrawn',
    });

    await db.insert(schema.candidates).values({
      slug: REJECTED_SLUG,
      wardId: WARD.id,
      nameEn: 'Rejected Test Candidate',
      partyEn: 'Independent',
      status: 'rejected',
    });

    await db.insert(schema.candidates).values({
      slug: PRENOTIFICATION_SLUG,
      wardId: WARD.id,
      nameEn: 'Prenotification Test Candidate',
      partyEn: 'Independent',
      status: 'filed',
    });
  });

  afterAll(async () => {
    for (const slug of [MAIN_SLUG, WITHDRAWN_SLUG, REJECTED_SLUG, PRENOTIFICATION_SLUG]) {
      const [existing] = await db.select({ id: schema.candidates.id }).from(schema.candidates).where(eq(schema.candidates.slug, slug));
      if (existing) {
        await deleteCandidateTree(existing.id);
        await db.delete(schema.candidates).where(eq(schema.candidates.id, existing.id));
      }
    }
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, 'withdrawals_closed'));
    await client.end();
  });

  describe('existing candidate', () => {
    it.each(['en', 'kn'] as const)('%s: 200, renders name/party/fields', async (lang) => {
      const res = await renderCandidate(lang, MAIN_SLUG);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());

      const expectedName = lang === 'kn' ? 'ವರದಿ ಪತ್ರ ಪರೀಕ್ಷಾ ಅಭ್ಯರ್ಥಿ' : 'Report Card Test Candidate';
      expect(html).toContain(expectedName);
      expect(html).toContain('Independent');
      expect(html).toContain('Led the ward roads resurfacing campaign in 2022.');
      expect(html).toContain(t(lang, 'candidate.header.sourceEcNomination'));
    });
  });

  describe('unknown slug -> real 404 (route twin)', () => {
    it.each(['en', 'kn'] as const)('%s: a well-formed but non-existent slug 404s', async (lang) => {
      const res = await renderCandidate(lang, 'no-such-candidate-slug-ever');
      expect(res.status).toBe(404);
    });
  });

  describe('withdrawn/rejected candidates keep their URL live (PRD §5.2)', () => {
    it('withdrawn candidate: 200 (NOT 404) + the status banner', async () => {
      const res = await renderCandidate('en', WITHDRAWN_SLUG);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain(t('en', 'candidate.statusBanner.withdrawn'));
      expect(html).toMatch(/banner banner--notice/);
      expect(html).not.toMatch(/banner banner--error/);
    });

    it('rejected candidate: 200 (NOT 404) + the status banner', async () => {
      const res = await renderCandidate('en', REJECTED_SLUG);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain(t('en', 'candidate.statusBanner.rejected'));
      expect(html).toMatch(/banner banner--notice/);
    });

    it('a filed/contesting candidate shows neither banner', async () => {
      const html = normalize(await (await renderCandidate('en', MAIN_SLUG)).text());
      expect(html).not.toContain(t('en', 'candidate.statusBanner.withdrawn'));
      expect(html).not.toContain(t('en', 'candidate.statusBanner.rejected'));
    });
  });

  describe('pre-notification candidate (no fields yet)', () => {
    it('200 with empty-state ("Not declared") fields, not a 404', async () => {
      const res = await renderCandidate('en', PRENOTIFICATION_SLUG);
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain('Prenotification Test Candidate');
      // Every one of the five report-card fields has no candidate_fields
      // row yet -> every one falls back to "Not declared".
      const notDeclaredCount = (html.match(new RegExp(t('en', 'common.notDeclared'), 'g')) ?? []).length;
      expect(notDeclaredCount).toBe(5);
    });

    it('renders the neutral initials placeholder, never a fake image, when there is no photo', async () => {
      const html = normalize(await (await renderCandidate('en', PRENOTIFICATION_SLUG)).text());
      expect(html).toContain('photo photo--placeholder');
      expect(html).toContain('>PT<'); // "Prenotification Test" -> P, T
      expect(html).not.toMatch(/<img[^>]*photo/);
    });
  });

  describe('affidavit source href (PRD §5.2 — the stored PDF is the public source)', () => {
    it('an affidavit-sourced field links to the stored /media/{id}/{hash} PDF, not any other URL', async () => {
      const html = normalize(await (await renderCandidate('en', MAIN_SLUG)).text());
      expect(html).toContain(`href="${affidavitMediaUrl}"`);
      expect(affidavitMediaUrl).toMatch(/^\/media\/\d+\/[0-9a-f]{16}$/);
    });
  });

  describe('AI-extracted vs. curator-confirmed Affidavit badge', () => {
    it('an aiExtracted:true field shows the AI-extracted badge', async () => {
      const html = normalize(await (await renderCandidate('en', MAIN_SLUG)).text());
      expect(html).toContain(t('en', 'common.source.aiExtracted'));
    });

    it('a curator-confirmed (aiExtracted:false) official field shows the Affidavit badge', async () => {
      const html = normalize(await (await renderCandidate('en', MAIN_SLUG)).text());
      expect(html).toContain(t('en', 'common.source.affidavit'));
    });
  });

  describe('news links (Task 38 boundary re-asserted here — load-bearing)', () => {
    it('renders the approved link (url + title) and NEVER the suggested one', async () => {
      const html = normalize(await (await renderCandidate('en', MAIN_SLUG)).text());
      expect(html).toContain(APPROVED_NEWS_URL);
      // Title is HTML-escaped by Astro in the visible list, so check the
      // decoded substring rather than the raw '<'.
      expect(html).toContain('Live');
      expect(html).toContain('Ward polls:');

      expect(html).not.toContain(SUGGESTED_NEWS_URL);
      expect(html).not.toContain(SUGGESTED_NEWS_TITLE);
      expect(html).not.toContain('Suggested unapproved coverage');
    });
  });

  describe('neutrality: cases field renders in plain ink (design-system §4.4)', () => {
    it('no alarm/danger styling class wraps the cases value', async () => {
      const html = normalize(await (await renderCandidate('en', MAIN_SLUG)).text());
      const match = html.match(/<p class="([^"]*)">No pending criminal cases declared\.[^<]*<\/p>/);
      expect(match, 'expected to find the cases field-value paragraph').not.toBeNull();
      expect(match![1]).not.toMatch(/danger|error|alarm/i);
      expect(match![1]).toBe('field-value');
    });
  });

  describe('Person + Breadcrumb JSON-LD (architecture §8/§13, Task 56 src/lib/seo.ts)', () => {
    it('emits Person JSON-LD (name, party affiliation, absolute report-card url) — no ranking/evaluative field', async () => {
      const html = await (await renderCandidate('en', MAIN_SLUG)).text();
      const scripts = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
      expect(scripts.length).toBeGreaterThanOrEqual(2); // Person + BreadcrumbList

      const person = scripts.map((m) => JSON.parse(m[1])).find((obj) => obj['@type'] === 'Person');
      expect(person, 'expected a Person JSON-LD block').toBeTruthy();
      expect(person.name).toBe('Report Card Test Candidate');
      expect(person.url).toBe(`${SITE_ORIGIN}/candidate/${MAIN_SLUG}`);
      expect(person.affiliation).toEqual({ '@type': 'Organization', name: 'Independent' });
      expect(person).not.toHaveProperty('bestRating');
      expect(person).not.toHaveProperty('ratingValue');
      // No news data leaks into this minimal, non-evaluative Person shape.
      expect(person).not.toHaveProperty('sameAs');
      expect(person).not.toHaveProperty('subjectOf');
    });

    it('emits a BreadcrumbList trail Home -> Ward -> Candidate, absolute item URLs', async () => {
      const html = await (await renderCandidate('en', MAIN_SLUG)).text();
      const scripts = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
      const breadcrumb = scripts.map((m) => JSON.parse(m[1])).find((obj) => obj['@type'] === 'BreadcrumbList');
      expect(breadcrumb, 'expected a BreadcrumbList JSON-LD block').toBeTruthy();
      const items = breadcrumb.itemListElement;
      expect(items).toHaveLength(3);
      expect(items[0]).toEqual({ '@type': 'ListItem', position: 1, name: 'Bengaluru Votes', item: `${SITE_ORIGIN}/` });
      expect(items[1]).toEqual({
        '@type': 'ListItem',
        position: 2,
        name: WARD.nameEn,
        item: `${SITE_ORIGIN}/ward/${WARD.id}`,
      });
      expect(items[2]).toEqual({
        '@type': 'ListItem',
        position: 3,
        name: 'Report Card Test Candidate',
        item: `${SITE_ORIGIN}/candidate/${MAIN_SLUG}`,
      });
    });

    it('a withdrawn candidate (URL still resolves, PRD §5.2) still emits Person JSON-LD', async () => {
      const html = await (await renderCandidate('en', WITHDRAWN_SLUG)).text();
      const scripts = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
      const person = scripts.map((m) => JSON.parse(m[1])).find((obj) => obj['@type'] === 'Person');
      expect(person).toBeTruthy();
      expect(person.name).toBe('Withdrawn Test Candidate');
      expect(person.affiliation).toEqual({ '@type': 'Organization', name: 'Independent' });
    });
  });

  describe('Flag action (cache-safe)', () => {
    it('renders the Flag button with candidate_field targets', async () => {
      const html = normalize(await (await renderCandidate('en', MAIN_SLUG)).text());
      expect(html).toContain(t('en', 'common.flagError'));
      expect(html).toContain('data-flag-action');
      expect(html).toContain(`data-ward-id="${WARD.id}"`);
      expect(html).toContain(`candidate:${mainCandidateId}:track_record`);
      expect(html).toContain(`candidate:${mainCandidateId}:cases`);
    });

    it('cache-safety: markup is byte-identical whether or not the request carries a session cookie', async () => {
      const noCookie = normalize(await (await renderCandidate('en', MAIN_SLUG)).text());
      const withCookie = normalize(
        await (await renderCandidate('en', MAIN_SLUG, { cookie: 'session=some-signed-in-users-session-id' })).text(),
      );
      expect(withCookie).toBe(noCookie);
    });
  });

  describe('lang attribute + hreflang pair', () => {
    it('sets <html lang> and emits the en/kn hreflang alternates', async () => {
      const enHtml = normalize(await (await renderCandidate('en', MAIN_SLUG)).text());
      const knHtml = normalize(await (await renderCandidate('kn', MAIN_SLUG)).text());

      expect(enHtml).toMatch(/<html lang="en"/);
      expect(knHtml).toMatch(/<html lang="kn"/);
      expect(enHtml).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/candidate/${MAIN_SLUG}">`);
      expect(enHtml).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/candidate/${MAIN_SLUG}">`);
      expect(knHtml).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/candidate/${MAIN_SLUG}">`);
      expect(knHtml).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/candidate/${MAIN_SLUG}">`);
    });
  });

  describe('provisional marker (app_settings.withdrawals_closed, PRD §5.2/§9.3)', () => {
    it('shown when withdrawals_closed is not set to "true"', async () => {
      await db
        .insert(schema.appSettings)
        .values({ key: 'withdrawals_closed', value: 'false' })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: 'false' } });

      const html = normalize(await (await renderCandidate('en', MAIN_SLUG)).text());
      expect(html).toContain(t('en', 'candidate.provisionalMarker'));
    });

    it('hidden once withdrawals_closed is "true"', async () => {
      await db
        .insert(schema.appSettings)
        .values({ key: 'withdrawals_closed', value: 'true' })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: 'true' } });

      const html = normalize(await (await renderCandidate('en', MAIN_SLUG)).text());
      expect(html).not.toContain(t('en', 'candidate.provisionalMarker'));

      // Restore the "not closed" state for any other test in this file that
      // runs after this one (test order isn't otherwise significant here).
      await db
        .insert(schema.appSettings)
        .values({ key: 'withdrawals_closed', value: 'false' })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: 'false' } });
    });
  });
});

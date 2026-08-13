/**
 * Sitemap generation (Task 57; architecture §7). Drives the REAL
 * `regenerateSitemaps` against a temp output directory (never the repo's
 * `public/`) and a real DB, same fixture/high-id-range convention as
 * tests/routes/candidate.test.ts / tests/routes/ward.test.ts.
 *
 * COVERAGE MAP:
 *   - exclusions: none of the noindex/sitemap-excluded prefixes ever leak
 *     into any of the three sitemap files.
 *   - hreflang: both language urlsets declare the xhtml namespace, and
 *     every <url> entry carries the en/kn/x-default alternate triple.
 *   - dynamic entries + lastmod: an active candidate's known
 *     candidate_fields.updated_at flows through to its /candidate/{slug}
 *     entry (NOT the regeneration timestamp); its ward inherits the same
 *     lastmod; a ward with zero candidates gets no <lastmod> at all rather
 *     than a fabricated now().
 *   - CANDIDATE VISIBILITY: a withdrawn candidate IS included — its
 *     /candidate/{slug} route never 404s (PRD §5.2, confirmed against
 *     src/pages/candidate/[slug].astro), so there is no "non-renderable"
 *     candidate row for this module to filter out.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { regenerateSitemaps } from '../../src/lib/seo/sitemaps';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. CI always sets this; for local runs export ' +
      'DATABASE_URL=postgres://postgres@localhost:54329/bv_test (see task brief).',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific id range (Task 57) so this suite never collides with
// another test file's fixtures in the shared (not reset-between-files)
// test DB.
const WARD_WITH_CANDIDATE = {
  id: 96401,
  nameEn: 'Sitemap Test Ward With Candidate',
  nameKn: 'ಸೈಟ್‌ಮ್ಯಾಪ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ (ಅಭ್ಯರ್ಥಿ ಇರುವ)',
  corporation: 'south' as const,
  zone: 'Zone Sitemap Test',
  boundaryRef: 'sitemap-test-ward-with-candidate',
};

const WARD_EMPTY = {
  id: 96402,
  nameEn: 'Sitemap Test Ward Empty',
  nameKn: 'ಸೈಟ್‌ಮ್ಯಾಪ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ (ಖಾಲಿ)',
  corporation: 'south' as const,
  zone: 'Zone Sitemap Test',
  boundaryRef: 'sitemap-test-ward-empty',
};

const ACTIVE_SLUG = 'sitemap-test-active-candidate';
const WITHDRAWN_SLUG = 'sitemap-test-withdrawn-candidate';

// Deliberately older than FIELD_UPDATED_AT so the assertions actually prove
// the field timestamp (not the candidate row's own updatedAt) wins.
const CANDIDATE_ROW_UPDATED_AT = new Date('2025-01-01T00:00:00.000Z');
const FIELD_UPDATED_AT = new Date('2025-03-15T10:00:00.000Z');

let outputDir: string;
let activeCandidateId: number;

function readSitemap(filename: string): string {
  return readFileSync(path.join(outputDir, filename), 'utf-8');
}

function extractUrlBlock(xml: string, locSubstring: string): string {
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  const found = blocks.find((block) => block.includes(locSubstring));
  if (!found) {
    throw new Error(`expected to find a <url> block containing "${locSubstring}"`);
  }
  return found;
}

async function deleteCandidateFixture(slug: string): Promise<void> {
  const [existing] = await db.select({ id: schema.candidates.id }).from(schema.candidates).where(eq(schema.candidates.slug, slug));
  if (existing) {
    await db.delete(schema.candidateFields).where(eq(schema.candidateFields.candidateId, existing.id));
    await db.delete(schema.candidates).where(eq(schema.candidates.id, existing.id));
  }
}

describe('Sitemaps (Task 57; src/lib/seo/sitemaps.ts)', () => {
  beforeAll(async () => {
    outputDir = mkdtempSync(path.join(tmpdir(), 'bv-sitemap-test-'));

    await db.insert(schema.wards).values(WARD_WITH_CANDIDATE).onConflictDoUpdate({ target: schema.wards.id, set: WARD_WITH_CANDIDATE });
    await db.insert(schema.wards).values(WARD_EMPTY).onConflictDoUpdate({ target: schema.wards.id, set: WARD_EMPTY });

    // Clean slate in case a prior failed run left fixtures behind.
    await deleteCandidateFixture(ACTIVE_SLUG);
    await deleteCandidateFixture(WITHDRAWN_SLUG);

    const [activeRow] = await db
      .insert(schema.candidates)
      .values({
        slug: ACTIVE_SLUG,
        wardId: WARD_WITH_CANDIDATE.id,
        nameEn: 'Sitemap Test Active Candidate',
        partyEn: 'Independent',
        status: 'contesting',
        updatedAt: CANDIDATE_ROW_UPDATED_AT,
      })
      .returning({ id: schema.candidates.id });
    activeCandidateId = activeRow!.id;

    await db.insert(schema.candidateFields).values({
      candidateId: activeCandidateId,
      fieldKey: 'track_record',
      valueEn: 'Sitemap test track record value.',
      notDeclared: false,
      authoredLang: 'en',
      translationStatus: 'done',
      sourceUrl: 'https://example.com/sitemap-test-source',
      sourceType: 'curator',
      aiExtracted: false,
      updatedAt: FIELD_UPDATED_AT,
    });

    await db.insert(schema.candidates).values({
      slug: WITHDRAWN_SLUG,
      wardId: WARD_WITH_CANDIDATE.id,
      nameEn: 'Sitemap Test Withdrawn Candidate',
      partyEn: 'Independent',
      status: 'withdrawn',
      // Deliberately OLDER than FIELD_UPDATED_AT: the ward's derived
      // lastmod is the MAX across every candidate in the ward, so this
      // must not be the freshest timestamp, or it (not the active
      // candidate's field update) would win the ward-level assertion
      // below.
      updatedAt: CANDIDATE_ROW_UPDATED_AT,
    });

    await regenerateSitemaps(outputDir);
  });

  afterAll(async () => {
    await deleteCandidateFixture(ACTIVE_SLUG);
    await deleteCandidateFixture(WITHDRAWN_SLUG);
    await db.delete(schema.wards).where(eq(schema.wards.id, WARD_WITH_CANDIDATE.id));
    await db.delete(schema.wards).where(eq(schema.wards.id, WARD_EMPTY.id));
    rmSync(outputDir, { recursive: true, force: true });
    await client.end();
  });

  it('writes all three files to the given outputDir (never the repo public/)', () => {
    expect(existsSync(path.join(outputDir, 'sitemap.xml'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'sitemap-en.xml'))).toBe(true);
    expect(existsSync(path.join(outputDir, 'sitemap-kn.xml'))).toBe(true);
  });

  describe('exclusions (architecture §7/§8 sitemap-exclusion list)', () => {
    // Path-prefix matching (not raw substring matching) on purpose: the
    // shared test DB accumulates candidate fixtures from OTHER test files
    // whose slugs can legitimately contain a substring like "admin" (e.g.
    // "admin-audit-route-csrf-<uuid>") without that candidate's
    // `/candidate/{slug}` URL ever being under the excluded `/admin/*`
    // path — a raw `.not.toContain('/admin')` would false-positive on
    // those. What actually matters is that no <loc>/href PATH starts with
    // an excluded prefix.
    const EXCLUDED_PREFIXES = ['/account/', '/curator/', '/admin/', '/partner/', '/api/'];

    function urlPaths(xml: string): string[] {
      const matches = [...xml.matchAll(/(?:<loc>|href=")(https:\/\/[^"<]+)(?:<\/loc>|")/g)];
      return matches.map((m) => new URL(m[1]).pathname);
    }

    it('none of the excluded path prefixes (or /login) appear in any sitemap file', () => {
      for (const filename of ['sitemap.xml', 'sitemap-en.xml', 'sitemap-kn.xml']) {
        const paths = urlPaths(readSitemap(filename));
        expect(paths.length).toBeGreaterThan(0);
        for (const p of paths) {
          const withoutLocale = p.startsWith('/kn/') ? p.slice(3) : p;
          for (const prefix of EXCLUDED_PREFIXES) {
            expect(withoutLocale.startsWith(prefix), `unexpected excluded path "${p}" in ${filename}`).toBe(false);
          }
          expect(withoutLocale === '/login', `unexpected /login path "${p}" in ${filename}`).toBe(false);
        }
      }
    });
  });

  describe('hreflang alternates', () => {
    it('both language urlsets declare the xhtml namespace', () => {
      expect(readSitemap('sitemap-en.xml')).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
      expect(readSitemap('sitemap-kn.xml')).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    });

    it('the EN candidate entry carries the en/kn/x-default alternate triple', () => {
      const block = extractUrlBlock(readSitemap('sitemap-en.xml'), `/candidate/${ACTIVE_SLUG}`);
      expect(block).toContain(`<xhtml:link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/candidate/${ACTIVE_SLUG}"/>`);
      expect(block).toContain(`<xhtml:link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/candidate/${ACTIVE_SLUG}"/>`);
      expect(block).toContain(`<xhtml:link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}/candidate/${ACTIVE_SLUG}"/>`);
    });

    it('the KN candidate entry cross-references the same triple (x-default still points at EN)', () => {
      const block = extractUrlBlock(readSitemap('sitemap-kn.xml'), `/kn/candidate/${ACTIVE_SLUG}`);
      expect(block).toContain(`<loc>${SITE_ORIGIN}/kn/candidate/${ACTIVE_SLUG}</loc>`);
      expect(block).toContain(`<xhtml:link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/candidate/${ACTIVE_SLUG}"/>`);
      expect(block).toContain(`<xhtml:link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/candidate/${ACTIVE_SLUG}"/>`);
      expect(block).toContain(`<xhtml:link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}/candidate/${ACTIVE_SLUG}"/>`);
    });

    it('a static route entry also carries the alternate triple', () => {
      const block = extractUrlBlock(readSitemap('sitemap-en.xml'), `<loc>${SITE_ORIGIN}/about</loc>`);
      expect(block).toContain(`<xhtml:link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/about"/>`);
      expect(block).toContain(`<xhtml:link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/about"/>`);
    });
  });

  describe('dynamic entries + lastmod (publish timestamps, not now())', () => {
    it('the active candidate appears in both language files with lastmod from candidate_fields.updated_at', () => {
      const enBlock = extractUrlBlock(readSitemap('sitemap-en.xml'), `/candidate/${ACTIVE_SLUG}`);
      expect(enBlock).toContain(`<loc>${SITE_ORIGIN}/candidate/${ACTIVE_SLUG}</loc>`);
      expect(enBlock).toContain(`<lastmod>${FIELD_UPDATED_AT.toISOString()}</lastmod>`);
      expect(enBlock).not.toContain(`<lastmod>${CANDIDATE_ROW_UPDATED_AT.toISOString()}</lastmod>`);

      const knBlock = extractUrlBlock(readSitemap('sitemap-kn.xml'), `/kn/candidate/${ACTIVE_SLUG}`);
      expect(knBlock).toContain(`<lastmod>${FIELD_UPDATED_AT.toISOString()}</lastmod>`);
    });

    it("the candidate's ward inherits the same lastmod (MAX across the ward's candidates)", () => {
      const block = extractUrlBlock(readSitemap('sitemap-en.xml'), `<loc>${SITE_ORIGIN}/ward/${WARD_WITH_CANDIDATE.id}</loc>`);
      expect(block).toContain(`<lastmod>${FIELD_UPDATED_AT.toISOString()}</lastmod>`);
    });

    it('a ward with zero candidates gets NO <lastmod> (never a fabricated now())', () => {
      const block = extractUrlBlock(readSitemap('sitemap-en.xml'), `<loc>${SITE_ORIGIN}/ward/${WARD_EMPTY.id}</loc>`);
      expect(block).not.toContain('<lastmod>');
    });

    it(
      'a withdrawn candidate IS included — its /candidate/{slug} route is always 200, never 404 (PRD §5.2), ' +
        'so there is no "non-renderable" candidate status for the sitemap to exclude',
      () => {
        const block = extractUrlBlock(readSitemap('sitemap-en.xml'), `<loc>${SITE_ORIGIN}/candidate/${WITHDRAWN_SLUG}</loc>`);
        expect(block).toContain(`<loc>${SITE_ORIGIN}/candidate/${WITHDRAWN_SLUG}</loc>`);
      },
    );
  });
});

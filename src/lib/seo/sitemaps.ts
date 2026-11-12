/**
 * Sitemap generation (Task 55/57; architecture §8 "Per-language sitemaps
 * with `lastmod`"). Built per request by `buildSitemaps` and served by
 * `src/pages/sitemap.xml.ts`, `sitemap-en.xml.ts`, `sitemap-kn.xml.ts`.
 *
 * FULL COVERAGE (Task 57): every ward's `/ward/{id}` and every candidate's
 * `/candidate/{slug}`, EN and KN, alongside the fixed STATIC_ROUTES set —
 * with real `lastmod` values derived from publish timestamps, never a
 * fabricated `now()` for a dynamic entity (see the per-entity derivation
 * below).
 *
 * HREFLANG ALTERNATES: every `<url>` entry in both language sitemaps
 * carries the same `en`/`kn`/`x-default` `<xhtml:link rel="alternate">`
 * triple that Base.astro emits in `<head>` for the equivalent page — so a
 * crawler reading either language's sitemap learns about both URLs for
 * that resource.
 *
 * LASTMOD DERIVATION (task 198): every `<lastmod>` is the time the content
 * the URL renders last changed. Nothing is request-time, so repeated fetches
 * of unchanged content return byte-identical files. A URL with no honest
 * signal gets NO `<lastmod>` rather than an invented one.
 *   - Candidate `/candidate/{slug}`: the later of `candidates.updated_at`
 *     (status, ward move, name/party projection) and MAX(`candidate_fields.
 *     updated_at`) across its fields (one grouped query: `candidateRows`).
 *   - Ward `/ward/{id}`: MAX of its candidates' lastmod (the page lists every
 *     candidate). A ward with no candidates renders the `notification_date`
 *     setting instead, so that setting's `updated_at` is its signal; with
 *     neither it has none. Ward issues, key areas and old-ward overlaps carry
 *     no timestamp, and vote tallies reach the browser only through the
 *     uncached `/api/issue-votes`, never the HTML.
 *   - `/wards` and `/corporation/*`: built from the `wards` table alone (names
 *     only, no candidate data, no timestamp), so no `<lastmod>`.
 *   - `/`: the `booth_lookup_url` setting it links to.
 *   - Editorial pages (`/about`, `/about-election`, `/voter-faqs`, `/privacy`,
 *     `/terms`): the `updated` date in the page's EN frontmatter
 *     (content/pages/en/*.md), plus, for `/about-election` and `/voter-faqs`,
 *     the `app_settings` rows they render. One date serves both languages: the
 *     Kannada file's `sourceHash` ties it to the EN source, so the two change
 *     together. Authors bump `updated` when they change the page's wording
 *     (a frontmatter date survives Docker builds, which have no version
 *     history and no meaningful file mtimes). UI-string (`en.json`) edits are
 *     not tracked.
 *   - Sitemap index: MAX of the entries in that child sitemap; omitted when
 *     none has one.
 *   Known limit: moving a candidate out of a ward lowers that ward's MAX
 *   (no tombstone is kept), so its lastmod can go backwards.
 *
 * DEMO DATA: fixture candidates (`isTestCandidate`) are never listed.
 *
 * CANDIDATE VISIBILITY RULE: every non-demo row in `candidates` is included,
 * regardless of `status` — src/pages/candidate/[slug].astro's existence
 * check (and Candidate.astro's own docstring) confirm an UNKNOWN slug is
 * the only thing that 404s; an existing candidate (filed/contesting/
 * withdrawn/rejected/pre-notification) is ALWAYS 200 (architecture §8: withdrawn/
 * rejected candidates keep their already-shared URL live behind a neutral
 * notice banner). So there is no "non-renderable" candidate row to filter
 * out here.
 *
 * EXCLUDED (matches architecture §8's "noindex and sitemap exclusion"
 * list): `/curator/*`, `/admin/*`, `/transcribe/*`, `/login`, `/api/*`. None of these are ever enumerated here —
 * STATIC_ROUTES is a fixed public allowlist, and the ward/candidate
 * queries only ever produce `/ward/{id}` and `/candidate/{slug}` paths.
 */
import { eq, inArray, max } from 'drizzle-orm';
import { localePath, type Lang } from '../../i18n';
import { db } from '../../db/client';
import { appSettings, candidates, candidateFields, wards } from '../../db/schema';
import { getPageContent } from '../../i18n/content';
import { isTestCandidate } from '../demo-data';

/**
 * Root-relative, EN-canonical paths — same convention as Base.astro's
 * `path` prop (never `/kn`-prefixed; `localePath` derives the KN twin).
 * Every one of these is a real static top-level page with a KN twin under
 * src/pages/kn/ as of Task 55.
 */
export const STATIC_ROUTES: string[] = [
  '/',
  '/about',
  '/about-election',
  '/voter-faqs',
  '/wards',
  '/corporation/central',
  '/corporation/north',
  '/corporation/east',
  '/corporation/south',
  '/corporation/west',
  '/privacy',
  '/terms',
];

/**
 * What each static URL renders besides fixed UI strings: the editorial
 * Markdown slug whose `updated` date applies, and the `app_settings` keys it
 * reads. Routes absent here (the ward directory pages) render no dated
 * content and so carry no `<lastmod>`.
 */
const STATIC_SOURCES: Record<string, { slug?: string; settings?: string[] }> = {
  '/': { settings: ['booth_lookup_url'] },
  '/about': { slug: 'about' },
  '/about-election': { slug: 'about-election', settings: ['notification_date', 'election_date'] },
  '/voter-faqs': { slug: 'voter-faqs', settings: ['roll_deadline', 'roll_lookup_url'] },
  '/privacy': { slug: 'privacy' },
  '/terms': { slug: 'terms' },
};

/** Ward pages with no candidates render this setting in their empty state. */
const WARD_EMPTY_SETTINGS = ['notification_date'];

/** The later of several optional dates. */
function latest(...dates: (Date | null | undefined)[]): Date | undefined {
  let best: Date | undefined;
  for (const d of dates) if (d && (!best || d > best)) best = d;
  return best;
}

/** The `updated` date of an editorial page's EN source (UTC midnight), if it has one. */
function editorialUpdated(slug: string): Date | undefined {
  const updated = getPageContent('en', slug)?.updated;
  return updated ? new Date(`${updated}T00:00:00.000Z`) : undefined;
}

/** Same fallback convention as astro.config.mjs / src/lib/send/calendar.ts. */
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://bengaluruvotes.opencity.in';

/** A single sitemap entry: an EN-canonical root-relative path plus an optional ISO 8601 `lastmod`. */
interface RouteEntry {
  path: string;
  lastmod?: string;
}

/** Minimal defensive XML-escaping for text interpolated into the sitemap — `loc`/`href` values here are always `URL#href` output (already percent-encoded), so this is belt-and-braces, not load-bearing. */
function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildUrlSet(lang: Lang, entries: RouteEntry[]): string {
  const urls = entries
    .map((entry) => {
      const loc = new URL(localePath(lang, entry.path), SITE_ORIGIN).href;
      const enHref = new URL(localePath('en', entry.path), SITE_ORIGIN).href;
      const knHref = new URL(localePath('kn', entry.path), SITE_ORIGIN).href;
      const lastmodTag = entry.lastmod ? `\n    <lastmod>${entry.lastmod}</lastmod>` : '';
      return (
        `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmodTag}\n` +
        `    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(enHref)}"/>\n` +
        `    <xhtml:link rel="alternate" hreflang="kn" href="${escapeXml(knHref)}"/>\n` +
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(enHref)}"/>\n` +
        `  </url>`
      );
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    `${urls}\n</urlset>\n`
  );
}

function buildSitemapIndex(lastmod: string | undefined): string {
  const enLoc = new URL('/sitemap-en.xml', SITE_ORIGIN).href;
  const knLoc = new URL('/sitemap-kn.xml', SITE_ORIGIN).href;
  const tag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <sitemap>\n    <loc>${enLoc}</loc>${tag}\n  </sitemap>\n` +
    `  <sitemap>\n    <loc>${knLoc}</loc>${tag}\n  </sitemap>\n` +
    `</sitemapindex>\n`
  );
}

export interface SitemapFiles {
  index: string;
  en: string;
  kn: string;
  routesPerLanguage: number;
}

/**
 * Builds the sitemap index and both language urlsets from the database.
 * Served live by `src/pages/sitemap*.xml.ts` (nginx's micro-cache absorbs
 * the load) — nothing is written to disk. Demo/test candidates
 * (`isTestCandidate`) are never listed.
 */
export async function buildSitemaps(): Promise<SitemapFiles> {
  const settingKeys = [...new Set([...WARD_EMPTY_SETTINGS, ...Object.values(STATIC_SOURCES).flatMap((source) => source.settings ?? [])])];
  const settingRows = await db
    .select({ key: appSettings.key, updatedAt: appSettings.updatedAt })
    .from(appSettings)
    .where(inArray(appSettings.key, settingKeys));
  const settingUpdatedAt = (keys: string[] = []) =>
    latest(...settingRows.filter((row) => keys.includes(row.key)).map((row) => row.updatedAt));

  const wardRows = await db.select({ id: wards.id }).from(wards);

  // One grouped query: every candidate row (ANY status — see the module
  // docstring's visibility rule) alongside the MAX updated_at across its
  // candidate_fields rows. Grouping by candidates.id alone is enough for
  // Postgres to permit selecting the other candidates columns too (they're
  // functionally dependent on the primary key).
  const candidateRows = (
    await db
      .select({
        slug: candidates.slug,
        nameEn: candidates.nameEn,
        wardId: candidates.wardId,
        candidateUpdatedAt: candidates.updatedAt,
        maxFieldUpdatedAt: max(candidateFields.updatedAt),
      })
      .from(candidates)
      .leftJoin(candidateFields, eq(candidateFields.candidateId, candidates.id))
      .groupBy(candidates.id)
  ).filter((row) => !isTestCandidate(row));

  const candidateEntries: RouteEntry[] = [];
  const wardLastmodByWardId = new Map<number, Date>();

  for (const row of candidateRows) {
    const lastmodDate = latest(row.maxFieldUpdatedAt, row.candidateUpdatedAt)!;
    candidateEntries.push({ path: `/candidate/${row.slug}`, lastmod: lastmodDate.toISOString() });

    const currentWardMax = wardLastmodByWardId.get(row.wardId);
    if (!currentWardMax || lastmodDate > currentWardMax) {
      wardLastmodByWardId.set(row.wardId, lastmodDate);
    }
  }

  const wardEntries: RouteEntry[] = wardRows.map((ward) => {
    const lastmodDate = wardLastmodByWardId.get(ward.id) ?? settingUpdatedAt(WARD_EMPTY_SETTINGS);
    return { path: `/ward/${ward.id}`, lastmod: lastmodDate?.toISOString() };
  });

  const staticEntries: RouteEntry[] = STATIC_ROUTES.map((route) => {
    const source = STATIC_SOURCES[route];
    const date = source ? latest(source.slug ? editorialUpdated(source.slug) : undefined, settingUpdatedAt(source.settings)) : undefined;
    return { path: route, lastmod: date?.toISOString() };
  });
  const allEntries = [...staticEntries, ...wardEntries, ...candidateEntries];
  // ISO 8601 strings of equal precision sort chronologically.
  const newest = allEntries.map((entry) => entry.lastmod).filter((v): v is string => !!v).sort().pop();

  return {
    index: buildSitemapIndex(newest),
    en: buildUrlSet('en', allEntries),
    kn: buildUrlSet('kn', allEntries),
    routesPerLanguage: allEntries.length,
  };
}

const XML_HEADERS = { 'content-type': 'application/xml; charset=utf-8' };

/** Shared by the three `sitemap*.xml` route files. */
export async function sitemapResponse(which: 'index' | 'en' | 'kn'): Promise<Response> {
  const files = await buildSitemaps();
  return new Response(files[which], { headers: XML_HEADERS });
}

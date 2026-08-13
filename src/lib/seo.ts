/**
 * JSON-LD structured-data helpers (Task 56; architecture.md §8/§13). This
 * module is the ONE place that builds schema.org objects and serializes
 * them for embedding in a `<script type="application/ld+json">` tag —
 * replacing the small ad-hoc inline builders Candidate.astro and
 * About.astro each carried as a stopgap (see their own docstrings, which
 * point back here).
 *
 * NEUTRALITY (this is a non-partisan election-information site, non-
 * negotiable): every builder below emits ONLY sourced, factual fields —
 * never a ranking, an endorsement, a "bestRating"/aggregate score, or any
 * other evaluative signal. A field whose source value is absent is
 * OMITTED entirely, never filled with a placeholder or a guess (e.g.
 * `personLd` never invents "Independent" for a missing party — the caller
 * simply doesn't pass one, and `affiliation` is left out).
 *
 * PURE BY DESIGN: no DB import, no Astro import, no cookie/session read —
 * every builder is a plain function of the data its caller already loaded
 * (this is what makes it fully unit-testable with no fixtures, and keeps
 * every page that uses it cache-safe: JSON-LD is page-specific but NOT
 * session-specific, see Base.astro's cache-safety docstring).
 */

/** Same fallback convention as astro.config.mjs / src/lib/seo/sitemaps.ts / src/lib/send/calendar.ts. */
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://bengaluruvotes.opencity.in';

/**
 * Resolves a root-relative path to an absolute URL against `SITE_ORIGIN` —
 * NEVER the request's Host header (architecture §5's cache-safety
 * invariant). Callers pass an already-language-localized path (i.e. run
 * through `localePath(lang, path)` themselves first) — this module
 * deliberately doesn't import `localePath` to stay free of any dependency
 * beyond a bare path string.
 */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_ORIGIN).href;
}

// U+2028 LINE SEPARATOR / U+2029 PARAGRAPH SEPARATOR, built from char codes
// rather than typed as literal characters in source — both are valid inside
// a JSON string but are invisible/easy to mis-paste as source text, so this
// is the more reviewable way to reference them.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * Characters escaped by `jsonLd` below, each mapped to its standard
 * `\uXXXX` JSON string escape:
 *   - `<` (U+003C) — MANDATORY: this is what stops a data value containing
 *     a literal `</script>` from prematurely closing the surrounding
 *     `<script type="application/ld+json">` tag.
 *   - `>` (U+003E) and `&` (U+0026) — escaped too, for defense in depth.
 *   - U+2028 / U+2029 — valid inside a JSON string but treated as line
 *     terminators by some HTML/JS parsing contexts, so escaped for the
 *     same reason.
 * Every replacement is a standard JSON `\uXXXX` escape, so the result stays
 * valid JSON — nothing here is lossy.
 */
const JSON_LD_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  [LINE_SEPARATOR]: '\\u2028',
  [PARAGRAPH_SEPARATOR]: '\\u2029',
};

const JSON_LD_ESCAPE_RE = new RegExp(`[<>&${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, 'g');

/**
 * The security-critical serializer (architecture §13): `JSON.stringify`
 * plus the escape set documented above. `JSON.parse(jsonLd(obj))`
 * round-trips back to `obj` unchanged — nothing here is lossy.
 *
 * NEVER call `JSON.stringify` directly when embedding a JSON-LD object in
 * markup — always go through this function.
 */
export function jsonLd(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(JSON_LD_ESCAPE_RE, (ch) => JSON_LD_ESCAPES[ch]);
}

/**
 * The platform `Organization` (architecture §8). Static — every field is a
 * fixed, repo-known fact, not derived from any per-request/per-page data.
 */
export function orgLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Bengaluru Votes',
    url: SITE_ORIGIN,
    parentOrganization: {
      '@type': 'Organization',
      name: 'Oorvani Foundation',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Oorvani Foundation',
    },
  };
}

export interface CandidateForLd {
  /** Candidate's name, already resolved to the page's target language. */
  name: string;
  /**
   * Party name in the target language, or `null`/`undefined` for an
   * independent candidate — omitted from the output entirely; never a
   * placeholder like `"Independent"`.
   */
  party?: string | null;
  /**
   * Already-language-localized, root-relative path to this candidate's
   * report card (e.g. the result of `localePath(lang, '/candidate/{slug}')`).
   */
  path: string;
}

/**
 * A candidate's report-card `Person` (architecture §8). Deliberately
 * minimal and non-evaluative: name, affiliation (party, if declared), and
 * the report-card URL — NO ranking, NO "bestRating", nothing that reads as
 * an assessment of the candidate.
 */
export function personLd(candidate: CandidateForLd): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: candidate.name,
    url: absoluteUrl(candidate.path),
    ...(candidate.party ? { affiliation: { '@type': 'Organization', name: candidate.party } } : {}),
  };
}

export interface WardForLd {
  /** The ward's numeric id (a real, sourced identifier — not invented). */
  id: number;
  /** Ward name, already resolved to the page's target language. */
  name: string;
  /** Already-language-localized, root-relative path to this ward's page. */
  path: string;
}

/**
 * A ward's `AdministrativeArea` (architecture §8) — a GBA ward is a civic
 * administrative division of Bengaluru, the same `@type` the pre-Task-56
 * Candidate.astro stopgap already used for a candidate's `homeLocation`.
 */
export function placeLd(ward: WardForLd): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'AdministrativeArea',
    name: ward.name,
    identifier: String(ward.id),
    url: absoluteUrl(ward.path),
    containedInPlace: {
      '@type': 'AdministrativeArea',
      name: 'Bengaluru',
    },
  };
}

export interface ElectionSettingsForLd {
  /** `app_settings.election_date`, as already read by the caller — an ISO `YYYY-MM-DD` string, or absent/null when not yet set. */
  election_date?: string | null;
}

/**
 * The election `Event` (architecture §8). Returns `null` when
 * `election_date` isn't set yet — the caller then emits nothing, rather
 * than this function inventing a placeholder date.
 */
export function eventLd(settings: ElectionSettingsForLd): Record<string, unknown> | null {
  if (!settings.election_date) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: 'GBA Ward Election',
    startDate: settings.election_date,
    location: {
      '@type': 'Place',
      name: 'Bengaluru',
    },
  };
}

export interface FaqQuestion {
  question: string;
  answer: string;
}

/** An `FAQPage` (architecture §8) built from N question/answer pairs sourced from a guide page's own content — never invented Q&A. */
export function faqLd(questions: FaqQuestion[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: q.answer,
      },
    })),
  };
}

export interface BreadcrumbEntry {
  name: string;
  /** Already-language-localized, root-relative path for this crumb (run through `absoluteUrl`). */
  url: string;
}

/** A `BreadcrumbList` (architecture §8), positions 1..n in trail order. */
export function breadcrumbLd(trail: BreadcrumbEntry[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: absoluteUrl(entry.url),
    })),
  };
}

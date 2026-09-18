/**
 * Public platform metrics (Task 51; PRD §5.14, IA §3.14) — the figures
 * `/press` publishes. "A platform that publishes other people's records
 * should publish its own" (PRD §5.14's opening line). Every figure here is
 * an AGGREGATE COUNT — no user data, no PII, ever (see the module-level
 * note under `citizenSignal` below).
 *
 * DEFINITIONS (decided in the prototype phase; carried here verbatim —
 * see the Task 51 brief):
 *
 *   - `registeredCitizens` counts `users` with `role = 'citizen'` ONLY —
 *     NEVER curator/admin. Counting staff accounts here would both
 *     inflate the number and read as self-serving on the very page whose
 *     purpose is holding the platform to its OWN standard.
 *   - `flagsRaised` is the SUM of `flag_submissions` rows (every citizen
 *     submission, even when several collapse into one deduped
 *     `flag_items` queue entry) — NOT the count of deduped items. PRD
 *     §6.3 frames the submission count as the citizen-policing signal;
 *     halving it by only counting dedup records would understate it.
 *     `flagsResolved` is the count of RESOLVED `flag_items` (accepted or
 *     rejected — resolution acts on the deduped item, once, regardless
 *     of how many submissions fed it).
 *   - `sourcesCited` counts `candidate_fields` rows carrying a non-blank
 *     `sourceUrl` ("sourced fields") — the simplest, most defensible
 *     single number for "how much of what we publish is sourced", not a
 *     distinct-URL count.
 *   - `medianResolveHours` is the median of (resolvedAt - createdAt) in
 *     hours across every RESOLVED `flag_items` row. `null` (with the
 *     figure rendered as "not enough data yet") when there are zero
 *     resolved items — never a fabricated 0.
 *   - Coverage's `wardsWithData` counts wards with >=1 'filed'/'contesting'
 *     candidate that has >=1 `candidate_fields` row — this counts
 *     PUBLISHED DATA, including a ward currently held back from comms by
 *     the §9.1 readiness gate (published data and comms readiness are
 *     different facts, PRD §5.14). `wardsSignedOff` is the SEPARATE,
 *     narrower figure PRD §5.14 insists stay visible rather than folded
 *     into the first one: wards with a CURRENT sign-off (`ward_readiness
 *     .signedOffAt` set and not cleared since — the human-judgement fact,
 *     independent of `computeReadiness`'s mechanical completeness check;
 *     see src/lib/readiness.ts's module docstring on why sign-off does
 *     not require completeness).
 *   - `reportCardsComplete` mirrors `computeReadiness`'s per-candidate
 *     completeness rule (src/lib/readiness.ts) but counts complete
 *     CANDIDATES city-wide directly, rather than looping
 *     `computeReadiness` once per ward — same active-candidates-only
 *     scope ('filed'/'contesting'), same field/source checks, just
 *     computed in two flat queries instead of 369 small ones.
 *   - `activeCurators` counts `users` with `role = 'curator' AND status =
 *     'active'` — NOT admins (a separate role, PRD §7), and not a banned/
 *     erased curator account (an inactive account isn't doing any active
 *     curation work, so counting it here would overstate the platform's
 *     actual coverage capacity).
 *
 * `issueRollup` (`citizenSignal`) aggregates active `issue_vote_selections`
 * across EVERY ward, grouped by a normalized (trimmed, case-insensitive)
 * issue title — "what Bengaluru cares about" is a city-wide picture, and
 * the same issue text is commonly curated independently in more than one
 * ward. `sharePct` follows the exact same convention `issueResults`
 * (src/lib/votes.ts) uses per-ward: each issue's share of the TOTAL
 * selections cast city-wide (a citizen can contribute to up to three
 * issues, so shares needn't sum to 100 across less-than-3 selections, but
 * do sum close to 100 in the typical case). `totalVotesCast` is that same
 * total raw selection count — the "total-votes figure" PRD §5.5/IA §3.6
 * says is deliberately withheld from every ward page and published HERE
 * only.
 *
 * NOTE ON `issueRollup`'s single-language `issueTitle`: `publicMetrics()`
 * takes no `lang` parameter (per this task's interface) and this module
 * has no per-visitor context to key off of — it returns the English
 * title (falling back to Kannada only when a ward issue was authored
 * Kannada-first and has no English title yet), for both language
 * variants of `/press`. This is a known, accepted simplification for this
 * release, not an oversight.
 *
 * NO PII: every figure returned is a count, a percentage, or an issue
 * title string a curator authored — never an email, phone, name, or any
 * other user-identifying value. `publicMetrics()` is safe to render on an
 * anonymous, cookie-free, nginx-microcached page (architecture.md §5;
 * The metrics compute live — the ~5-minute cache TTL is Task 60's
 * nginx concern, not this module's).
 */
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  candidateFields,
  candidates,
  flagItems,
  flagSubmissions,
  issueVoteSelections,
  issueVoteSets,
  users,
  wardIssues,
  wardReadiness,
  wards,
} from '../db/schema';

/** Same scope as src/lib/readiness.ts's `computeReadiness` — withdrawn/rejected candidates never count toward coverage/completeness figures (PRD §5.2/§9.1). */
const ACTIVE_CANDIDATE_STATUSES = ['filed', 'contesting'] as const;

/** The three affidavit-derived report-card fields whose completeness a candidate's "report card complete" figure cares about — same set as `computeReadiness`'s `AFFIDAVIT_FIELD_KEYS`. */
const REPORT_CARD_FIELD_KEYS = ['cases', 'assets', 'education'] as const;

export interface IssueRollupItem {
  issueTitle: string;
  rank: number;
  sharePct: number;
}

export interface Metrics {
  coverage: {
    wardsWithData: number;
    total: number;
    wardsSignedOff: number;
    reportCardsComplete: number;
    activeCurators: number;
    sourcesCited: number;
  };
  integrity: {
    flagsRaised: number;
    flagsResolved: number;
    medianResolveHours: number | null;
  };
  citizenSignal: {
    issueRollup: IssueRollupItem[];
    totalVotesCast: number;
    registeredCitizens: number;
  };
  /** ISO-8601 timestamp — this platform's own "as of" figure (PRD §5.14: every figure carries one; every figure here is computed from the same live read, so one timestamp covers all of them). */
  asOf: string;
}

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === '';
}

function isPopulated(valueEn: string | null, valueKn: string | null): boolean {
  return !isBlank(valueEn) || !isBlank(valueKn);
}

/** Extracts a single row's `count(*)::int` result, defaulting to 0 for an empty result set (never reached in practice — `count()` always returns exactly one row — but keeps this defensive like every other count-reader in this codebase). */
function firstCount(rows: { n: number }[]): number {
  return rows[0]?.n ?? 0;
}

async function computeCoverage(): Promise<Metrics['coverage']> {
  const [totalWardRows, wardsWithDataRows, signedOffRows, activeCandidateRows, sourcedFieldRows, activeCuratorRows] =
    await Promise.all([
      db.select({ id: wards.id }).from(wards),
      // >=1 'filed'/'contesting' candidate that has >=1 candidate_fields row
      // — the inner join alone guarantees "at least one field row exists"
      // per matched candidate; distinct collapses multiple fields/
      // candidates in the same ward to one row.
      db
        .selectDistinct({ wardId: candidates.wardId })
        .from(candidates)
        .innerJoin(candidateFields, eq(candidateFields.candidateId, candidates.id))
        .where(inArray(candidates.status, ACTIVE_CANDIDATE_STATUSES)),
      db
        .select({ signedOffAt: wardReadiness.signedOffAt, clearedAt: wardReadiness.clearedAt })
        .from(wardReadiness)
        .where(isNotNull(wardReadiness.signedOffAt)),
      db
        .select({ id: candidates.id, nameEn: candidates.nameEn, partyEn: candidates.partyEn })
        .from(candidates)
        .where(inArray(candidates.status, ACTIVE_CANDIDATE_STATUSES)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(candidateFields)
        .where(and(isNotNull(candidateFields.sourceUrl), sql`trim(${candidateFields.sourceUrl}) <> ''`)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.role, 'curator'), eq(users.status, 'active'))),
    ]);

  // "Currently signed off" — signedOffAt set AND not cleared SINCE that
  // sign-off (clearedAt null, or an earlier clearedAt than the current
  // signedOffAt — see src/lib/readiness.ts's `isWardReadyForComms` for the
  // same "not cleared since" shape, minus its completeness check: sign-off
  // is a human-judgement fact independent of mechanical completeness).
  const wardsSignedOff = signedOffRows.filter(
    (row) => row.clearedAt == null || row.clearedAt <= row.signedOffAt!,
  ).length;

  const candidateIds = activeCandidateRows.map((c) => c.id);
  const fieldRows = candidateIds.length
    ? await db.select().from(candidateFields).where(inArray(candidateFields.candidateId, candidateIds))
    : [];

  const fieldsByCandidate = new Map<number, Map<string, (typeof fieldRows)[number]>>();
  for (const row of fieldRows) {
    if (!fieldsByCandidate.has(row.candidateId)) fieldsByCandidate.set(row.candidateId, new Map());
    fieldsByCandidate.get(row.candidateId)!.set(row.fieldKey, row);
  }

  let reportCardsComplete = 0;
  for (const candidate of activeCandidateRows) {
    if (isBlank(candidate.nameEn) || isBlank(candidate.partyEn)) continue;

    const fields = fieldsByCandidate.get(candidate.id);
    let complete = true;
    for (const key of REPORT_CARD_FIELD_KEYS) {
      const field = fields?.get(key);
      if (!field) {
        complete = false;
        break;
      }
      if (!field.notDeclared && !isPopulated(field.valueEn, field.valueKn)) {
        complete = false;
        break;
      }
      if (isBlank(field.sourceUrl)) {
        complete = false;
        break;
      }
    }
    if (complete) reportCardsComplete++;
  }

  return {
    wardsWithData: wardsWithDataRows.length,
    total: totalWardRows.length,
    wardsSignedOff,
    reportCardsComplete,
    activeCurators: firstCount(activeCuratorRows),
    sourcesCited: firstCount(sourcedFieldRows),
  };
}

/**
 * Median of `hoursValues`, or `null` for an empty array (never a fabricated
 * 0 — the caller renders this as "not enough data yet"). Rounded to one
 * decimal hour, same precision convention as `issueResults`'s share
 * percentages. Exported (pure, no DB) so its null/rounding edge cases can
 * be unit-tested directly — same convention as scripts/translate.ts's
 * exported pure helpers.
 */
export function computeMedianHours(hoursValues: number[]): number | null {
  if (hoursValues.length === 0) return null;
  const sorted = [...hoursValues].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return Math.round(raw * 10) / 10;
}

async function computeIntegrity(): Promise<Metrics['integrity']> {
  const [flagsRaisedRows, resolvedRows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(flagSubmissions),
    db
      .select({ createdAt: flagItems.createdAt, resolvedAt: flagItems.resolvedAt })
      .from(flagItems)
      .where(isNotNull(flagItems.resolvedAt)),
  ]);

  const resolveHours = resolvedRows.map((row) => (row.resolvedAt!.getTime() - row.createdAt.getTime()) / 3_600_000);

  return {
    flagsRaised: firstCount(flagsRaisedRows),
    flagsResolved: resolvedRows.length,
    medianResolveHours: computeMedianHours(resolveHours),
  };
}

/** Rounds a selection count to a percentage share of `total`, one decimal place — same convention as `issueResults`'s `roundShare` (src/lib/votes.ts). */
function roundShare(selectionCount: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((selectionCount / total) * 1000) / 10;
}

async function computeCitizenSignal(): Promise<Metrics['citizenSignal']> {
  const [registeredRows, selectionCountRows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.role, 'citizen')),
    // Active vote-sets only (PRD §5.5 — a retired set never contributes to
    // any aggregate, city-wide or per-ward), grouped by the ward_issue each
    // selection references.
    db
      .select({ wardIssueId: issueVoteSelections.wardIssueId, n: sql<number>`count(*)::int` })
      .from(issueVoteSelections)
      .innerJoin(issueVoteSets, eq(issueVoteSelections.setId, issueVoteSets.id))
      .where(eq(issueVoteSets.active, true))
      .groupBy(issueVoteSelections.wardIssueId),
  ]);

  const totalVotesCast = selectionCountRows.reduce((sum, row) => sum + row.n, 0);

  const issueIds = selectionCountRows.map((row) => row.wardIssueId);
  const issueRows = issueIds.length
    ? await db
        .select({ id: wardIssues.id, titleEn: wardIssues.titleEn, titleKn: wardIssues.titleKn })
        .from(wardIssues)
        .where(inArray(wardIssues.id, issueIds))
    : [];
  const titleById = new Map(issueRows.map((row) => [row.id, row.titleEn ?? row.titleKn ?? '']));

  // Roll up city-wide by NORMALIZED (trimmed, lowercased) title — the same
  // issue text is often curated independently in more than one ward, and
  // "what Bengaluru cares about" should count those as one issue, not one
  // per ward. The DISPLAYED title keeps the first-seen original casing.
  const aggregated = new Map<string, { display: string; count: number }>();
  for (const row of selectionCountRows) {
    const rawTitle = titleById.get(row.wardIssueId) ?? '';
    const displayTitle = rawTitle.trim();
    if (displayTitle === '') continue;
    const key = displayTitle.toLowerCase();

    const existing = aggregated.get(key);
    if (existing) {
      existing.count += row.n;
    } else {
      aggregated.set(key, { display: displayTitle, count: row.n });
    }
  }

  const ranked = [...aggregated.values()].sort((a, b) => b.count - a.count);
  const issueRollup: IssueRollupItem[] = ranked.map((item, index) => ({
    issueTitle: item.display,
    rank: index + 1,
    sharePct: roundShare(item.count, totalVotesCast),
  }));

  return {
    issueRollup,
    totalVotesCast,
    registeredCitizens: firstCount(registeredRows),
  };
}

/**
 * Computes every `/press` public figure, live (no caching in this
 * module — see the module docstring's note on the nginx TTL being a
 * separate, later concern). Safe to call from a cache-safe, cookie-free
 * page render.
 */
export async function publicMetrics(): Promise<Metrics> {
  const [coverage, integrity, citizenSignal] = await Promise.all([
    computeCoverage(),
    computeIntegrity(),
    computeCitizenSignal(),
  ]);

  return { coverage, integrity, citizenSignal, asOf: new Date().toISOString() };
}

/**
 * Business logic behind the curator pages: the dashboard, the review queue,
 * one flag (the fix and the dismissal), the candidate editor and the
 * matching list. Same split as src/lib/login-flow.ts: this module owns
 * state-loading and the mutation dispatch, the page route twins
 * (src/pages/curator/*) own the HTTP concerns a plain module cannot
 * (redirects, no-store, 403/404 status). What a correction is, and how one
 * is parsed and published, lives in src/lib/curator-fix.ts.
 *
 * NO WARD SCOPE: curators and admins are both city-wide (decided
 * 2026-08-15), so every query here covers every ward. src/middleware.ts
 * admits the `/curator/*` route class by role alone.
 *
 * LANGUAGE: curator/admin routes have no `/kn/` twin (they're internal
 * tooling, not public bilingual content — see src/middleware.ts's noindex
 * list). UI strings still render bilingually, driven by the signed-in
 * user's OWN saved preference (`users.language`, the same column `/account`
 * writes) rather than the URL — there is no URL to derive it from. See
 * `loadCuratorLang` below.
 */
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { candidateIdentitySelection } from './candidate-identity';
import {
  candidateAffidavits,
  candidates,
  flagItems,
  flagSubmissions,
  media,
  users,
  wards,
  type candidateStatusEnum,
  type affidavitStateEnum,
  type flagStatusEnum,
  type flagTargetEnum,
} from '../db/schema';
import { resolveFlag, type FlagFix } from './flags';
import { AFFIDAVIT_FIELD_KEYS, type AffidavitFieldKey } from './affidavit-publish';
import type { FieldError, RawField } from './affidavit-form';
import { loadFixCandidate, loadFixFields, parseFieldFix, parseWardFix, publishedFieldData, saveFieldFix, saveWardFix, type FixCandidate, type FixField, type StaffActor } from './curator-fix';
import { countWaitingMatches } from './affidavit-queue';
import type { Lang } from '../i18n';

type FlagTargetType = (typeof flagTargetEnum.enumValues)[number];
type FlagStatus = (typeof flagStatusEnum.enumValues)[number];
type CandidateStatus = (typeof candidateStatusEnum.enumValues)[number];
type AffidavitState = (typeof affidavitStateEnum.enumValues)[number];
/** What the editor shows for a stored affidavit: waiting on the worker or an admin match, extracted, or failed. */
type ExtractionStatus = 'pending' | 'done' | 'failed';

function extractionStatusOf(state: AffidavitState): ExtractionStatus {
  if (state === 'published') return 'done';
  if (state === 'failed') return 'failed';
  return 'pending';
}

/** Same shape `src/middleware.ts` puts on `locals.session` for an authed request. */
export type CuratorActor = StaffActor;

// ---------------------------------------------------------------------------
// Language (see module docstring)
// ---------------------------------------------------------------------------

/** The signed-in curator/admin's own saved UI language — defaults to 'en' for a user row that (defensively) no longer resolves. */
export async function loadCuratorLang(userId: number): Promise<Lang> {
  const [row] = await db.select({ language: users.language }).from(users).where(eq(users.id, userId));
  return row?.language ?? 'en';
}

// ---------------------------------------------------------------------------
// Target ref parsing
// ---------------------------------------------------------------------------

/** Parses a `candidate_field` targetRef of the shape `candidate:<id>:<fieldKey>` (see src/lib/flags.ts's module docstring for the targetRef convention). `null` for anything else. */
export function parseCandidateFieldTargetRef(targetRef: string): { candidateId: number; fieldKey: string } | null {
  const match = /^candidate:(\d+):(.+)$/.exec(targetRef);
  if (!match) return null;
  return { candidateId: Number(match[1]), fieldKey: match[2]! };
}

/** What a queue row is about, in words: the candidate's field for today's flags, the raw reference for rows older than the eight-field rule. */
export function flagFieldKey(targetType: FlagTargetType, targetRef: string): string | null {
  return targetType === 'candidate_field' || targetType === 'candidate_other' ? (parseCandidateFieldTargetRef(targetRef)?.fieldKey ?? null) : null;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardData {
  queueCount: number;
  /** Affidavits waiting for a person to match them to a candidate and ward. */
  matchCount: number;
}

export async function loadDashboard(): Promise<DashboardData> {
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(flagItems)
    .where(eq(flagItems.status, 'pending'));

  return { queueCount: Number(countRow?.count ?? 0), matchCount: await countWaitingMatches() };
}

// ---------------------------------------------------------------------------
// Queue list
// ---------------------------------------------------------------------------

export type QueueSort = 'recent' | 'ward';

export interface QueueListItem {
  id: number;
  wardId: number;
  wardNameEn: string;
  wardNameKn: string;
  targetType: FlagTargetType;
  targetRef: string;
  /** The flagged field's key, or null for a row that is not about a candidate's field. */
  fieldKey: string | null;
  /** The flagged candidate's name, or null when the row names no candidate that still exists. */
  candidateNameEn: string | null;
  submissionCount: number;
  spamCount: number;
  createdAt: Date;
}

/** Every PENDING flag_item, city-wide. */
export async function loadQueueList(sort: QueueSort = 'recent', page = 1): Promise<QueueListItem[]> {
  const whereClause = eq(flagItems.status, 'pending');

  const rows = await db
    .select({
      id: flagItems.id,
      wardId: flagItems.wardId,
      wardNameEn: wards.nameEn,
      wardNameKn: wards.nameKn,
      targetType: flagItems.targetType,
      targetRef: flagItems.targetRef,
      createdAt: flagItems.createdAt,
      submissionCount: sql<number>`count(${flagSubmissions.id}) filter(where not ${flagSubmissions.isSpam})::int`,
      spamCount: sql<number>`count(${flagSubmissions.id}) filter(where ${flagSubmissions.isSpam})::int`,
    })
    .from(flagItems)
    .innerJoin(wards, eq(wards.id, flagItems.wardId))
    .leftJoin(flagSubmissions, eq(flagSubmissions.flagItemId, flagItems.id))
    .where(whereClause)
    .groupBy(flagItems.id, wards.id)
    .orderBy(sort === 'ward' ? wards.nameEn : desc(flagItems.createdAt),desc(flagItems.id)).limit(50).offset((Math.max(1,Math.min(10000,Math.trunc(page)||1))-1)*50);

  // The candidate is named only inside `target_ref`, so the names come from a second query.
  const targets = rows.map((row) => (row.targetType === 'candidate_field' || row.targetType === 'candidate_other' ? parseCandidateFieldTargetRef(row.targetRef) : null));
  const candidateIds = [...new Set(targets.flatMap((target) => (target ? [target.candidateId] : [])))];
  const named = candidateIds.length
    ? await db.select({ id: candidates.id, nameEn: candidates.nameEn }).from(candidates).where(inArray(candidates.id, candidateIds))
    : [];
  const nameById = new Map(named.map((candidate) => [candidate.id, candidate.nameEn]));

  return rows.map((row, i) => {
    const target = targets[i] ?? null;
    return {
      ...row,
      submissionCount: Number(row.submissionCount),
      fieldKey: flagFieldKey(row.targetType, row.targetRef),
      candidateNameEn: (target && nameById.get(target.candidateId)) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Queue item
// ---------------------------------------------------------------------------

export interface FlagSubmissionRow {
  id: number;
  isSpam: boolean;
  detail: string;
  suggestedValue: string | null;
  sourceUrl: string | null;
  createdAt: Date;
}

export interface QueueItemDetail {
  id: number;
  wardId: number;
  wardNameEn: string;
  wardNameKn: string;
  targetType: FlagTargetType;
  targetRef: string;
  status: FlagStatus;
  resolutionReason: string | null;
  createdAt: Date;
  submissions: FlagSubmissionRow[];
  /** Every report on this flag, not only this page's: the "of M" in "Report N of M". */
  totalSubmissions: number;
  page: number;
  hasMore: boolean;
  priorResolutions: { id: number; status: FlagStatus; reason: string | null; resolvedAt: Date | null }[];
  /** The flagged candidate; null for a row that is not about a candidate's field, or whose candidate no longer exists. */
  candidate: FixCandidate | null;
  /** The flagged field's key as the row carries it; null for a row that is not about a candidate's field. */
  fieldKey: string | null;
  /**
   * How this flag can be fixed: one affidavit field through its structured
   * inputs, the ward through a move, or not at all (`none`: no stored
   * affidavit to check against, or a kind of flag that is no longer taken).
   */
  fix: { kind: 'field'; field: FixField } | { kind: 'ward'; wardId: number } | { kind: 'none' };
}

/** `null` when no such flag_items row exists (the route twin turns that into a 404). */
export async function loadQueueItem(id: number, page = 1): Promise<QueueItemDetail | null> {
  const [item] = await db
    .select({
      id: flagItems.id,
      wardId: flagItems.wardId,
      wardNameEn: wards.nameEn,
      wardNameKn: wards.nameKn,
      targetType: flagItems.targetType,
      targetRef: flagItems.targetRef,
      status: flagItems.status,
      resolutionReason: flagItems.resolutionReason,
      createdAt: flagItems.createdAt,
    })
    .from(flagItems)
    .innerJoin(wards, eq(wards.id, flagItems.wardId))
    .where(eq(flagItems.id, id));
  if (!item) return null;

  page = Math.max(1,Math.min(10000,Math.trunc(page)||1));
  const submissions = await db
    .select({
      id: flagSubmissions.id,
      isSpam: flagSubmissions.isSpam,
      detail: flagSubmissions.detail,
      suggestedValue: flagSubmissions.suggestedValue,
      sourceUrl: flagSubmissions.sourceUrl,
      createdAt: flagSubmissions.createdAt,
    })
    .from(flagSubmissions)
    .where(eq(flagSubmissions.flagItemId, id))
    .orderBy(flagSubmissions.createdAt,flagSubmissions.id).limit(21).offset((page-1)*20);

  const [{ count: totalSubmissions }] = await db.select({ count: sql<number>`count(*)::int` }).from(flagSubmissions).where(eq(flagSubmissions.flagItemId, id));

  let candidate: FixCandidate | null = null;
  let fieldKey: string | null = null;
  let fix: QueueItemDetail['fix'] = { kind: 'none' };
  const parsed = item.targetType === 'candidate_field' || item.targetType === 'candidate_other' ? parseCandidateFieldTargetRef(item.targetRef) : null;
  if (parsed) {
    candidate = await loadFixCandidate(parsed.candidateId);
    fieldKey = parsed.fieldKey;
    if (candidate && candidate.pdfUrl) {
      if (parsed.fieldKey === 'ward') fix = { kind: 'ward', wardId: candidate.wardId };
      else if ((AFFIDAVIT_FIELD_KEYS as readonly string[]).includes(parsed.fieldKey)) {
        fix = { kind: 'field', field: (await loadFixFields(candidate)).find((f) => f.key === parsed.fieldKey)! };
      }
    }
  }

  const priorResolutions = await db.select({ id:flagItems.id,status:flagItems.status,reason:flagItems.resolutionReason,resolvedAt:flagItems.resolvedAt }).from(flagItems)
    .where(and(eq(flagItems.targetRef,item.targetRef),sql`${flagItems.status}<>'pending'`,sql`${flagItems.id}<>${id}`)).orderBy(desc(flagItems.resolvedAt)).limit(5);
  return { ...item, submissions:submissions.slice(0,20), totalSubmissions, page,hasMore:submissions.length>20,priorResolutions,candidate,fieldKey,fix };
}

// ---------------------------------------------------------------------------
// Fix / dismiss
// ---------------------------------------------------------------------------

export type ResolveOutcome =
  | { kind: 'rejected' }
  | { kind: 'already_resolved' }
  | { kind: 'validation_error'; key: string };

export type FixOutcome =
  | { kind: 'accepted' }
  | { kind: 'already_resolved' }
  | { kind: 'refused'; key: string; error?: FieldError; raw?: RawField };

/**
 * Handles the FIX form: the flagged field's corrected value, or the ward
 * the candidate belongs in. The correction and the flag's acceptance are
 * one transaction (`resolveFlag`). Refused when there is no affidavit to
 * check against, and for
 * everything `parseFieldFix` / `parseWardFix` refuse. A
 * `flag_already_resolved` throw (another curator resolved it first) becomes
 * a friendly outcome rather than a 500.
 */
export async function handleFlagFix(actor: CuratorActor, item: QueueItemDetail, form: FormData): Promise<FixOutcome> {
  if (item.fix.kind === 'none' || !item.candidate) {
    const noAffidavit = item.candidate !== null && item.candidate.pdfUrl === null;
    return { kind: 'refused', key: noAffidavit ? 'curator.fix.error.noAffidavit' : 'curator.fix.error.unsupported' };
  }
  const candidate = item.candidate;
  const sourceUrl = candidate.pdfUrl!;
  let fix: FlagFix;
  if (item.fix.kind === 'ward') {
    const parsed = await parseWardFix(form, candidate.wardId);
    if (!parsed.ok) return { kind: 'refused', key: parsed.key };
    fix = { kind: 'ward', candidateId: candidate.id, wardId: parsed.wardId, sourceUrl };
  } else {
    const key = item.fix.field.key;
    const parsed = parseFieldFix(form, key, await publishedFieldData(candidate, key));
    if (!parsed.ok) return { kind: 'refused', key: parsed.key, error: parsed.error, raw: parsed.raw };
    fix = { kind: 'field', candidateId: candidate.id, data: parsed.data, sourceUrl };
  }
  try {
    await resolveFlag(actor, item.id, { accept: true, fix });
  } catch (err) {
    if (err instanceof Error && err.message === 'flag_already_resolved') return { kind: 'already_resolved' };
    throw err;
  }
  return { kind: 'accepted' };
}

/** Handles the REJECT form — a reason is required; same `flag_already_resolved` handling as `handleFlagFix`. */
export async function handleReject(actor: CuratorActor, itemId: number, form: FormData): Promise<ResolveOutcome> {
  const reason = String(form.get('reason') ?? '').trim();
  if (!reason) {
    return { kind: 'validation_error', key: 'curator.queueItem.error.reasonRequired' };
  }

  try {
    await resolveFlag(actor, itemId, { accept: false, reason });
  } catch (err) {
    if (err instanceof Error && err.message === 'flag_already_resolved') {
      return { kind: 'already_resolved' };
    }
    throw err;
  }

  return { kind: 'rejected' };
}

// ---------------------------------------------------------------------------
// Candidate editor (Task 36) — create/correct a
// candidate's core record + report-card fields. Edits publish immediately
// (curator trust, no approval gate); every report-card field carries a
// required source.
// ---------------------------------------------------------------------------

/** One row of the affidavit ingestion history (Task 37) — newest first. `mediaUrl` is the stored PDF's public, content-hashed URL (the source every extracted field points back to). */
export interface CandidateAffidavitRow {
  id: number;
  extractionStatus: ExtractionStatus;
  mediaUrl: string;
  createdAt: Date;
}

export interface CandidateEditData {
  id: number;
  slug: string;
  wardId: number;
  wardNameEn: string;
  wardNameKn: string;
  nameEn: string;
  partyEn: string;
  status: CandidateStatus;
  /** The stored affidavit every value is checked against; null for a candidate with none. */
  pdfUrl: string | null;
  /** With no published affidavit: the candidate's affidavit that waits in Matching, if there is one. */
  waitingAffidavitId: number | null;
  /** The seven affidavit fields as their forms open; empty when there is no affidavit. */
  fields: FixField[];
  affidavits: CandidateAffidavitRow[];
}

/**
 * Whether the candidate was written to within the last `windowMs`: a field
 * published (which stamps that field row; only a name or party also stamps the
 * candidate) or a ward move (which stamps the candidate). Backs the
 * "Saved and published" notice, which must be true rather than read off the
 * query string.
 */
export async function wasEditedRecently(candidateId: number, windowMs: number): Promise<boolean> {
  const [row] = await db
    .select({
      // Both columns are UTC `timestamp`s without a zone; render the later one as an ISO instant to parse it as UTC.
      // (Written out with table names: drizzle drops them from a single-table select, which would make `id` below mean the field row's.)
      editedAt: sql<string | null>`to_char(greatest(candidates.updated_at, (select max(candidate_fields.updated_at) from candidate_fields where candidate_fields.candidate_id = candidates.id)), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    })
    .from(candidates)
    .where(eq(candidates.id, candidateId));
  return !!row?.editedAt && Date.now() - new Date(row.editedAt).getTime() < windowMs;
}

/** Loads everything `/curator/candidate/{id}` needs to render: the candidate's core row (+ ward name) and its seven affidavit fields as the structured forms open them. `null` when no such candidate exists — the route twin turns that into a 404. */
export async function loadCandidateForEdit(candidateId: number): Promise<CandidateEditData | null> {
  const [row] = await db
    .select({
      id: candidates.id,
      slug: candidates.slug,
      wardId: candidates.wardId,
      wardNameEn: wards.nameEn,
      wardNameKn: wards.nameKn,
      ...candidateIdentitySelection(),
      status: candidates.status,
    })
    .from(candidates)
    .innerJoin(wards, eq(wards.id, candidates.wardId))
    .where(eq(candidates.id, candidateId));
  if (!row) return null;

  const fixCandidate = (await loadFixCandidate(candidateId))!;

  const affidavitRows = await db
    .select({
      id: candidateAffidavits.id,
      state: candidateAffidavits.state,
      createdAt: candidateAffidavits.createdAt,
      mediaHash: media.sha256,
      mediaId: media.id,
    })
    .from(candidateAffidavits)
    .innerJoin(media, eq(media.id, candidateAffidavits.mediaId))
    .where(eq(candidateAffidavits.candidateId, candidateId))
    .orderBy(desc(candidateAffidavits.createdAt));

  const affidavits: CandidateAffidavitRow[] = affidavitRows.map((a) => ({
    id: a.id,
    extractionStatus: extractionStatusOf(a.state),
    mediaUrl: `/media/${a.mediaId}/${a.mediaHash.slice(0, 16)}`,
    createdAt: a.createdAt,
  }));

  return {
    id: row.id,
    slug: row.slug,
    wardId: row.wardId,
    wardNameEn: row.wardNameEn,
    wardNameKn: row.wardNameKn,
    nameEn: row.nameEn,
    partyEn: row.partyEn,
    status: row.status,
    pdfUrl: fixCandidate.pdfUrl,
    waitingAffidavitId: fixCandidate.waitingAffidavitId,
    fields: fixCandidate.pdfUrl ? await loadFixFields(fixCandidate) : [],
    affidavits,
  };
}

export type EditFixOutcome = { kind: 'saved' } | { kind: 'refused'; key: string; error?: FieldError; raw?: RawField };

/** Saves one affidavit field from the editor: the same rules as a flag fix, with no flag involved. */
export async function handleCandidateFieldFix(actor: CuratorActor, candidate: CandidateEditData, key: AffidavitFieldKey, form: FormData): Promise<EditFixOutcome> {
  if (!candidate.pdfUrl) return { kind: 'refused', key: 'curator.fix.error.noAffidavit' };
  const fixCandidate = (await loadFixCandidate(candidate.id))!;
  const parsed = parseFieldFix(form, key, await publishedFieldData(fixCandidate, key));
  if (!parsed.ok) return { kind: 'refused', key: parsed.key, error: parsed.error, raw: parsed.raw };
  await saveFieldFix(actor, candidate.id, parsed.data, candidate.pdfUrl);
  return { kind: 'saved' };
}

/** Moves the candidate to another ward from the editor. */
export async function handleCandidateWardFix(candidate: CandidateEditData, form: FormData): Promise<EditFixOutcome> {
  if (!candidate.pdfUrl) return { kind: 'refused', key: 'curator.fix.error.noAffidavit' };
  const parsed = await parseWardFix(form, candidate.wardId);
  if (!parsed.ok) return { kind: 'refused', key: parsed.key };
  await saveWardFix(candidate.id, parsed.wardId, candidate.pdfUrl);
  return { kind: 'saved' };
}

export const SEARCH_CAP = 50;

export interface CandidateHit {
  id: number;
  nameEn: string;
  partyEn: string;
  status: CandidateStatus;
  wardId: number;
  wardNameEn: string;
  wardNameKn: string;
}

export interface CuratorSearch {
  candidates: CandidateHit[];
  /** More candidates matched than `SEARCH_CAP`; the list is cut short. */
  capped: boolean;
}

/** `%`, `_` and `\` are what the person typed, not wildcards. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * Candidates whose name contains `q`. A
 * few thousand candidates: a sequential scan is enough.
 * Null for a query under two characters. A NUL byte is dropped (Postgres
 * refuses one in a bind parameter) and the query is cut at 100 characters.
 */
export async function searchCurator(q: string): Promise<CuratorSearch | null> {
  const term = q.replace(/\0/g, '').trim().slice(0, 100);
  if (term.length < 2) return null;
  const pattern = likePattern(term);

  const hits = await db
    .select({ id: candidates.id, ...candidateIdentitySelection(), status: candidates.status, wardId: wards.id, wardNameEn: wards.nameEn, wardNameKn: wards.nameKn })
    .from(candidates)
    .innerJoin(wards, eq(wards.id, candidates.wardId))
    .where(or(ilike(candidateIdentitySelection().nameEn, pattern), ilike(candidateIdentitySelection().nameKn, pattern)))
    .orderBy(candidates.nameEn, candidates.id)
    .limit(SEARCH_CAP + 1);

  return { candidates: hits.slice(0, SEARCH_CAP), capped: hits.length > SEARCH_CAP };
}

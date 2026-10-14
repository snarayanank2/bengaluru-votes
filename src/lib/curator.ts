/**
 * Business logic behind the curator pages: the dashboard, the review queue,
 * one flag (the fix and the dismissal), the candidate editor and the ward
 * page. Mirrors the split used by src/lib/account-flow.ts: this module owns
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
import { desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
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
import { createCandidate, publishCandidateCore } from './publish';
import { storeMedia, type MediaStoreErrorCode } from './media';
import { countWaitingMatches, enqueueAffidavit } from './affidavit-queue';
import { checkDefaultLimit } from './rate-limit';
import { fetchAffidavitFromEc, type AffidavitFetchErrorCode } from './affidavit-fetch';
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
const CANDIDATE_STATUSES = ['filed', 'contesting', 'rejected', 'withdrawn'] as const satisfies readonly CandidateStatus[];

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
  return targetType === 'candidate_field' ? (parseCandidateFieldTargetRef(targetRef)?.fieldKey ?? null) : null;
}

// ---------------------------------------------------------------------------
// Dashboard (IA §5.1)
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
// Queue list (IA §5.2)
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
  createdAt: Date;
}

/** Every PENDING flag_item, city-wide. */
export async function loadQueueList(sort: QueueSort = 'recent'): Promise<QueueListItem[]> {
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
      submissionCount: sql<number>`count(${flagSubmissions.id})::int`,
    })
    .from(flagItems)
    .innerJoin(wards, eq(wards.id, flagItems.wardId))
    .leftJoin(flagSubmissions, eq(flagSubmissions.flagItemId, flagItems.id))
    .where(whereClause)
    .groupBy(flagItems.id, wards.id)
    .orderBy(sort === 'ward' ? wards.nameEn : desc(flagItems.createdAt));

  // The candidate is named only inside `target_ref`, so the names come from a second query.
  const targets = rows.map((row) => (row.targetType === 'candidate_field' ? parseCandidateFieldTargetRef(row.targetRef) : null));
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
// Queue item (IA §5.3)
// ---------------------------------------------------------------------------

export interface FlagSubmissionRow {
  id: number;
  userId: number;
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
export async function loadQueueItem(id: number): Promise<QueueItemDetail | null> {
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

  const submissions = await db
    .select({
      id: flagSubmissions.id,
      userId: flagSubmissions.userId,
      detail: flagSubmissions.detail,
      suggestedValue: flagSubmissions.suggestedValue,
      sourceUrl: flagSubmissions.sourceUrl,
      createdAt: flagSubmissions.createdAt,
    })
    .from(flagSubmissions)
    .where(eq(flagSubmissions.flagItemId, id))
    .orderBy(flagSubmissions.createdAt);

  let candidate: FixCandidate | null = null;
  let fieldKey: string | null = null;
  let fix: QueueItemDetail['fix'] = { kind: 'none' };
  const parsed = item.targetType === 'candidate_field' ? parseCandidateFieldTargetRef(item.targetRef) : null;
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

  return { ...item, submissions, candidate, fieldKey, fix };
}

// ---------------------------------------------------------------------------
// Fix / dismiss (IA §5.3, PRD §6.1)
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
 * check against, when the flag is one that can only be dismissed, and for
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

/** Handles the REJECT form — a reason is required (PRD §6.1 step 3); same `flag_already_resolved` handling as `handleFlagFix`. */
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
// Candidate editor (Task 36; IA §5.4; PRD §5.2/§9.1/§11) — create/correct a
// candidate's core record + report-card fields. Edits publish immediately
// (curator trust, no approval gate); every report-card field carries a
// required source.
// ---------------------------------------------------------------------------

/** One row of the affidavit ingestion history (Task 37) — newest first. `mediaUrl` is the stored PDF's public, content-hashed URL (the source every extracted field points back to). */
export interface CandidateAffidavitRow {
  id: number;
  originUrl: string | null;
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
  nameKn: string | null;
  partyEn: string;
  partyKn: string | null;
  photoMediaId: number | null;
  photoUrl: string | null;
  status: CandidateStatus;
  /** The stored affidavit every value is checked against; null for a candidate with none. */
  pdfUrl: string | null;
  /** With no published affidavit: the candidate's affidavit that waits in Matching, if there is one. */
  waitingAffidavitId: number | null;
  /** The seven affidavit fields as their forms open; empty when there is no affidavit. */
  fields: FixField[];
  affidavits: CandidateAffidavitRow[];
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
      nameEn: candidates.nameEn,
      nameKn: candidates.nameKn,
      partyEn: candidates.partyEn,
      partyKn: candidates.partyKn,
      photoMediaId: candidates.photoMediaId,
      photoHash: media.sha256,
      status: candidates.status,
    })
    .from(candidates)
    .innerJoin(wards, eq(wards.id, candidates.wardId))
    .leftJoin(media, eq(media.id, candidates.photoMediaId))
    .where(eq(candidates.id, candidateId));
  if (!row) return null;

  const fixCandidate = (await loadFixCandidate(candidateId))!;

  const affidavitRows = await db
    .select({
      id: candidateAffidavits.id,
      originUrl: candidateAffidavits.originUrl,
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
    originUrl: a.originUrl,
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
    nameKn: row.nameKn,
    partyEn: row.partyEn,
    partyKn: row.partyKn,
    photoMediaId: row.photoMediaId,
    photoUrl: row.photoMediaId != null && row.photoHash ? `/media/${row.photoMediaId}/${row.photoHash.slice(0, 16)}` : null,
    status: row.status,
    pdfUrl: fixCandidate.pdfUrl,
    waitingAffidavitId: fixCandidate.waitingAffidavitId,
    fields: fixCandidate.pdfUrl ? await loadFixFields(fixCandidate) : [],
    affidavits,
  };
}

/** Ward name lookup for `/curator/candidate/new?ward={id}` (no candidate exists yet to hang the ward name off of). `null` when the ward id doesn't exist — the route twin turns that into a 404. */
export async function loadWardBasic(wardId: number): Promise<{ id: number; nameEn: string; nameKn: string } | null> {
  const [row] = await db.select({ id: wards.id, nameEn: wards.nameEn, nameKn: wards.nameKn }).from(wards).where(eq(wards.id, wardId));
  return row ?? null;
}

export type CandidateCoreOutcome = { kind: 'saved' } | { kind: 'validation_error'; key: string };
export type CandidateCreateOutcome = { kind: 'created'; id: number } | { kind: 'validation_error'; key: string };

/** Error key for a `storeMedia` throw — shared by the core-publish and create paths below. */
function photoErrorKey(err: unknown): string {
  const code = err instanceof Error ? (err.message as MediaStoreErrorCode | string) : '';
  if (code === 'media_too_large') return 'curator.candidateEdit.error.photoTooLarge';
  return 'curator.candidateEdit.error.photoUnsupported';
}

/** Stores the photo chosen on a candidate form, if any: `photoMediaId` is `undefined` when no file was chosen (the caller decides what "no file" means for its path), else a freshly stored media id. */
async function storePhotoFrom(actor: { userId: number }, form: FormData): Promise<{ ok: true; photoMediaId?: number } | { ok: false; key: string }> {
  const photo = form.get('photo');
  if (!(photo instanceof File) || photo.size === 0) return { ok: true };
  const allowed = await checkDefaultLimit(actor.userId, 'upload');
  if (!allowed) return { ok: false, key: 'curator.candidateEdit.error.uploadRateLimited' };
  try {
    const bytes = Buffer.from(await photo.arrayBuffer());
    const stored = await storeMedia(actor, { bytes, declaredType: photo.type }, 'photo');
    return { ok: true, photoMediaId: stored.id };
  } catch (err) {
    return { ok: false, key: photoErrorKey(err) };
  }
}

/** Reads+validates the name/party/photo fields of the create form. Returns a validation-error key, or the parsed values plus a freshly stored `photoMediaId` (`undefined` when no file was chosen). */
async function parseCandidateCoreForm(
  actor: { userId: number },
  form: FormData,
): Promise<
  | { ok: true; nameEn: string; nameKn: string | null; partyEn: string; partyKn: string | null; photoMediaId?: number }
  | { ok: false; key: string }
> {
  const nameEn = String(form.get('nameEn') ?? '').trim();
  const partyEn = String(form.get('partyEn') ?? '').trim();
  const nameKnRaw = String(form.get('nameKn') ?? '').trim();
  const partyKnRaw = String(form.get('partyKn') ?? '').trim();

  if (!nameEn) return { ok: false, key: 'curator.candidateEdit.error.nameRequired' };
  if (!partyEn) return { ok: false, key: 'curator.candidateEdit.error.partyRequired' };

  const photo = await storePhotoFrom(actor, form);
  if (!photo.ok) return photo;

  return {
    ok: true,
    nameEn,
    nameKn: nameKnRaw || null,
    partyEn,
    partyKn: partyKnRaw || null,
    ...(photo.photoMediaId !== undefined ? { photoMediaId: photo.photoMediaId } : {}),
  };
}

/**
 * Handles the CORE form on `/curator/candidate/{id}`: the Kannada name and
 * party, the photo and the status. The English name and party are the
 * `full_name` and `party` affidavit fields, which have one writer
 * (`handleCandidateFieldFix`), so a posted `nameEn`/`partyEn` is ignored. A photo file is only read (and stored) when one was actually
 * chosen — an empty file input leaves the existing photo untouched, it does
 * NOT clear it. Publishes via `publishCandidateCore`.
 *
 * INVARIANT: status is validated BEFORE the photo is stored, so an
 * invalid status → 400 with NO media row created and NO rate-limit consumed.
 */
export async function handleCandidateCorePublish(
  actor: CuratorActor,
  candidateId: number,
  form: FormData,
): Promise<CandidateCoreOutcome> {
  // Validate status FIRST, before any expensive operations like photo storage
  const status = String(form.get('status') ?? '') as CandidateStatus;
  if (!CANDIDATE_STATUSES.includes(status)) {
    return { kind: 'validation_error', key: 'curator.candidateEdit.error.statusInvalid' };
  }

  const photo = await storePhotoFrom(actor, form);
  if (!photo.ok) return { kind: 'validation_error', key: photo.key };

  await publishCandidateCore(actor, {
    candidateId,
    nameKn: String(form.get('nameKn') ?? '').trim() || null,
    partyKn: String(form.get('partyKn') ?? '').trim() || null,
    status,
    ...(photo.photoMediaId !== undefined ? { photoMediaId: photo.photoMediaId } : {}),
  });

  return { kind: 'saved' };
}

/** Handles the CORE (create) form on `/curator/candidate/new?ward={id}`. Status is always the schema default (`'filed'`) — there is no status select on the create form. */
export async function handleCandidateCreate(
  actor: CuratorActor,
  wardId: number,
  form: FormData,
): Promise<CandidateCreateOutcome> {
  const parsed = await parseCandidateCoreForm(actor, form);
  if (!parsed.ok) return { kind: 'validation_error', key: parsed.key };

  const { id } = await createCandidate(actor, {
    wardId,
    nameEn: parsed.nameEn,
    nameKn: parsed.nameKn,
    partyEn: parsed.partyEn,
    partyKn: parsed.partyKn,
    ...(parsed.photoMediaId !== undefined ? { photoMediaId: parsed.photoMediaId } : {}),
  });

  return { kind: 'created', id };
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

// ---------------------------------------------------------------------------
// Affidavit ingestion (Task 37; architecture §7/§13; PRD §5.2) — the
// `formAction=affidavit` form on `/curator/candidate/{id}`: upload the PDF
// directly, OR paste its EC link (fetched SSRF-hardened, src/lib/affidavit-fetch.ts).
// Either path lands the same way from here on: `storeMedia(kind:'affidavit')`
// (magic-byte + size validation, identical for both paths — architecture
// §7's "fetched bytes pass the same validation as a direct upload"), a new
// `candidate_affidavits` row queued for the extraction worker
// (src/lib/affidavit-queue.ts), which publishes the AI-read values onto this
// candidate when it gets to it.
// ---------------------------------------------------------------------------

export type CandidateAffidavitOutcome =
  | { kind: 'saved' }
  | { kind: 'validation_error'; key: string };

/** Error key for a `fetchAffidavitFromEc` throw — every SSRF rejection reads to the curator as "that's not a link this platform can fetch"; the size cap gets its own (shared with storeMedia's) message. */
function affidavitFetchErrorKey(err: unknown): string {
  const code = err instanceof Error ? (err.message as AffidavitFetchErrorCode | string) : '';
  if (code === 'media_too_large') return 'curator.candidateEdit.error.affidavitTooLarge';
  if (code === 'ssrf_scheme' || code === 'ssrf_host' || code === 'ssrf_ip' || code === 'ssrf_redirect_cap') {
    return 'curator.candidateEdit.error.affidavitUrlRejected';
  }
  return 'curator.candidateEdit.error.affidavitFetchFailed';
}

/** Error key for a `storeMedia` throw on the affidavit path — shared size-cap key with `affidavitFetchErrorKey` above (the cap is the same 20 MB either way). */
function affidavitStoreErrorKey(err: unknown): string {
  const code = err instanceof Error ? (err.message as MediaStoreErrorCode | string) : '';
  if (code === 'media_too_large') return 'curator.candidateEdit.error.affidavitTooLarge';
  return 'curator.candidateEdit.error.affidavitUnsupported';
}

/**
 * Handles the affidavit form (`formAction=affidavit`) on
 * `/curator/candidate/{id}`: exactly one of an uploaded PDF (`affidavitFile`)
 * or a pasted EC link (`ecUrl`) must be present. Shares the same per-account
 * `upload` rate limit as the core photo upload (both write `media` rows).
 *
 * The PDF is queued for the extraction worker with this candidate
 * attached, so the worker publishes onto this candidate instead of reading
 * an identity from the affidavit. A PDF that is already stored, for this or
 * any other candidate, is refused rather than queued twice.
 */
export async function handleCandidateAffidavitPublish(
  actor: CuratorActor,
  candidateId: number,
  form: FormData,
): Promise<CandidateAffidavitOutcome> {
  const ecUrl = String(form.get('ecUrl') ?? '').trim();
  const fileField = form.get('affidavitFile');
  const hasFile = fileField instanceof File && fileField.size > 0;

  if (!ecUrl && !hasFile) {
    return { kind: 'validation_error', key: 'curator.candidateEdit.error.affidavitRequired' };
  }
  if (ecUrl && hasFile) {
    return { kind: 'validation_error', key: 'curator.candidateEdit.error.affidavitBothProvided' };
  }

  const allowed = await checkDefaultLimit(actor.userId, 'upload');
  if (!allowed) {
    return { kind: 'validation_error', key: 'curator.candidateEdit.error.uploadRateLimited' };
  }

  let bytes: Buffer;
  if (ecUrl) {
    try {
      bytes = await fetchAffidavitFromEc(ecUrl);
    } catch (err) {
      return { kind: 'validation_error', key: affidavitFetchErrorKey(err) };
    }
  } else {
    bytes = Buffer.from(await (fileField as File).arrayBuffer());
  }

  const result = await enqueueAffidavit(bytes, { uploadedBy: actor.userId, originUrl: ecUrl || null, candidateId });
  if (result.kind === 'rejected') {
    return { kind: 'validation_error', key: affidavitStoreErrorKey(new Error(result.reason)) };
  }
  if (result.kind === 'duplicate') {
    return { kind: 'validation_error', key: 'curator.candidateEdit.error.affidavitDuplicate' };
  }

  return { kind: 'saved' };
}

// ---------------------------------------------------------------------------
// Ward page (Task 39) — `/curator/ward/{id}`'s data-loading side: read-only
// ward metadata, with links out to the issues editor and "add candidate".
// ---------------------------------------------------------------------------

export interface WardEditData {
  id: number;
  nameEn: string;
  nameKn: string;
  corporation: string;
  zone: string;
  boundaryRef: string;
}

/**
 * Loads the ward's own (official, read-only) metadata for
 * `/curator/ward/{id}`. `null` when no such ward exists — the route twin
 * turns that into a 404.
 */
export async function loadWardForEdit(wardId: number): Promise<WardEditData | null> {
  const [ward] = await db.select().from(wards).where(eq(wards.id, wardId));
  if (!ward) return null;

  return {
    id: ward.id,
    nameEn: ward.nameEn,
    nameKn: ward.nameKn,
    corporation: ward.corporation,
    zone: ward.zone,
    boundaryRef: ward.boundaryRef,
  };
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
  wards: Array<{ id: number; nameEn: string; nameKn: string }>;
}

/** `%`, `_` and `\` are what the person typed, not wildcards. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * Candidates and wards whose name contains `q` (a ward also by its id). A
 * few thousand candidates and 369 wards: a sequential scan is enough.
 * Null for a query under two characters. A NUL byte is dropped (Postgres
 * refuses one in a bind parameter) and the query is cut at 100 characters.
 */
export async function searchCurator(q: string): Promise<CuratorSearch | null> {
  const term = q.replace(/\0/g, '').trim().slice(0, 100);
  if (term.length < 2) return null;
  const pattern = likePattern(term);

  const hits = await db
    .select({ id: candidates.id, nameEn: candidates.nameEn, partyEn: candidates.partyEn, status: candidates.status, wardId: wards.id, wardNameEn: wards.nameEn, wardNameKn: wards.nameKn })
    .from(candidates)
    .innerJoin(wards, eq(wards.id, candidates.wardId))
    .where(or(ilike(candidates.nameEn, pattern), ilike(candidates.nameKn, pattern)))
    .orderBy(candidates.nameEn, candidates.id)
    .limit(SEARCH_CAP + 1);

  const wardId = /^\d{1,9}$/.test(term) ? Number(term) : null;
  const wardHits = await db
    .select({ id: wards.id, nameEn: wards.nameEn, nameKn: wards.nameKn })
    .from(wards)
    .where(or(ilike(wards.nameEn, pattern), ilike(wards.nameKn, pattern), wardId === null ? undefined : eq(wards.id, wardId)))
    .orderBy(wards.id)
    .limit(SEARCH_CAP);

  return { candidates: hits.slice(0, SEARCH_CAP), capped: hits.length > SEARCH_CAP, wards: wardHits };
}

/** Every candidate of one ward, for the curator ward page. */
export async function loadWardCandidates(wardId: number): Promise<Array<{ id: number; nameEn: string; partyEn: string; status: CandidateStatus }>> {
  return db
    .select({ id: candidates.id, nameEn: candidates.nameEn, partyEn: candidates.partyEn, status: candidates.status })
    .from(candidates)
    .where(eq(candidates.wardId, wardId))
    .orderBy(candidates.nameEn, candidates.id);
}

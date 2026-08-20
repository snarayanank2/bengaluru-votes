/**
 * Business logic behind the curator dashboard + review-queue pages (Task 34,
 * information-architecture.md §5.1/§5.2/§5.3; PRD §6.1/§7/§9.1). Mirrors the
 * split used by src/lib/account-flow.ts: this module owns state-loading and
 * the accept/reject mutation dispatch, the page route twins
 * (src/pages/curator/*) own the HTTP concerns a plain module cannot
 * (redirects, no-store, 403/404 status).
 *
 * SCOPE ENFORCEMENT (the security core of this task): every query here that
 * lists data is scoped to the caller's wards via `scopedWardIds` — a curator
 * with no matching `curator_scopes` row for a ward never sees that ward's
 * queue items or sign-off status. `null` from `scopedWardIds`
 * is the admin sentinel ("no ward filter — see every ward"), never confused
 * with an empty array ("this curator has zero assigned wards — see
 * nothing"). The single-item lookup (`loadQueueItem`) does NOT scope-check
 * on its own — the caller (src/pages/curator/queue/[id].astro) MUST call
 * `canEditWard` against the loaded item's `wardId` before showing or acting
 * on it; that per-item check is what makes an out-of-scope item 403 rather
 * than merely absent from the list.
 *
 * LANGUAGE: curator/admin routes have no `/kn/` twin (they're internal
 * tooling, not public bilingual content — see src/middleware.ts's noindex
 * list). UI strings still render bilingually, driven by the signed-in
 * user's OWN saved preference (`users.language`, the same column `/account`
 * writes) rather than the URL — there is no URL to derive it from. See
 * `loadCuratorLang` below.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  candidateAffidavits,
  candidateFields,
  candidateNewsLinks,
  candidates,
  curatorScopes,
  flagItems,
  flagSubmissions,
  media,
  users,
  wardReadiness,
  wards,
  type candidateStatusEnum,
  type extractionStatusEnum,
  type flagStatusEnum,
  type flagTargetEnum,
  type sourceTypeEnum,
  type langEnum,
} from '../db/schema';
import { resolveFlag } from './flags';
import { createCandidate, publishCandidateCore, publishCandidateField } from './publish';
import { storeMedia, type MediaStoreErrorCode } from './media';
import { checkDefaultLimit } from './rate-limit';
import { fetchAffidavitFromEc, type AffidavitFetchErrorCode } from './affidavit-fetch';
import { extractAffidavitFields } from './extract';
import { addNewsLink, approveNewsLink } from './news';
import { computeReadiness, signOffWard, wasClearedByChange, type ReadinessResult } from './readiness';
import type { Lang } from '../i18n';
import type { Role } from './session';

type FlagTargetType = (typeof flagTargetEnum.enumValues)[number];
type FlagStatus = (typeof flagStatusEnum.enumValues)[number];
type SourceType = (typeof sourceTypeEnum.enumValues)[number];
type AuthoredLang = (typeof langEnum.enumValues)[number];
type CandidateStatus = (typeof candidateStatusEnum.enumValues)[number];
type ExtractionStatus = (typeof extractionStatusEnum.enumValues)[number];
const CANDIDATE_STATUSES = ['filed', 'contesting', 'rejected', 'withdrawn'] as const satisfies readonly CandidateStatus[];

/** Same shape `src/middleware.ts` puts on `locals.session` for an authed request. */
export type CuratorActor = { userId: number; role: 'curator' | 'admin' };

// ---------------------------------------------------------------------------
// Language (see module docstring)
// ---------------------------------------------------------------------------

/** The signed-in curator/admin's own saved UI language — defaults to 'en' for a user row that (defensively) no longer resolves. */
export async function loadCuratorLang(userId: number): Promise<Lang> {
  const [row] = await db.select({ language: users.language }).from(users).where(eq(users.id, userId));
  return row?.language ?? 'en';
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * `null` = no ward filter (admin — every ward is in scope). An empty array
 * (curator with no `curator_scopes` rows) is a real, distinct value: it
 * means "in scope for nothing", not "unfiltered".
 */
export async function scopedWardIds(userId: number, role: Role): Promise<number[] | null> {
  if (role === 'admin') return null;
  const rows = await db.select({ wardId: curatorScopes.wardId }).from(curatorScopes).where(eq(curatorScopes.userId, userId));
  return rows.map((r) => r.wardId);
}

// ---------------------------------------------------------------------------
// Target ref parsing / labeling
// ---------------------------------------------------------------------------

/** Parses a `candidate_field` targetRef of the shape `candidate:<id>:<fieldKey>` (see src/lib/flags.ts's module docstring for the targetRef convention). `null` for anything else. */
export function parseCandidateFieldTargetRef(targetRef: string): { candidateId: number; fieldKey: string } | null {
  const match = /^candidate:(\d+):(.+)$/.exec(targetRef);
  if (!match) return null;
  return { candidateId: Number(match[1]), fieldKey: match[2]! };
}

/** A short, human-readable label for a queue item's target — used in the queue list and item view. Deliberately lightweight (no extra query): the item view additionally resolves the candidate's real name for candidate_field targets (see `loadQueueItem`). */
export function humanTargetLabel(targetType: FlagTargetType, targetRef: string): string {
  const parts = targetRef.split(':');
  if (targetType === 'candidate_field' && parts.length === 3) {
    return `Candidate #${parts[1]} — ${parts[2]}`;
  }
  if (targetType === 'ward_field' && parts.length === 3) {
    return `Ward #${parts[1]} — ${parts[2]}`;
  }
  if (targetType === 'ward_issue') {
    return `Ward issue — ${targetRef}`;
  }
  return targetRef;
}

// ---------------------------------------------------------------------------
// Dashboard (IA §5.1)
// ---------------------------------------------------------------------------

export interface AwaitingSignOffWard {
  wardId: number;
  nameEn: string;
  nameKn: string;
  /** true = this ward WAS signed off, but a later candidate-set change cleared it (IA §5.1: called out first — a curator who doesn't know a ward is held won't sign it off). */
  clearedByChange: boolean;
}

export interface DashboardData {
  queueCount: number;
  awaitingSignOff: AwaitingSignOffWard[];
}

export async function loadDashboard(userId: number, role: Role): Promise<DashboardData> {
  const wardIds = await scopedWardIds(userId, role);
  if (wardIds !== null && wardIds.length === 0) {
    return { queueCount: 0, awaitingSignOff: [] };
  }

  const flagWardFilter = wardIds ? inArray(flagItems.wardId, wardIds) : undefined;
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(flagItems)
    .where(flagWardFilter ? and(eq(flagItems.status, 'pending'), flagWardFilter) : eq(flagItems.status, 'pending'));

  const wardFilter = wardIds ? inArray(wards.id, wardIds) : undefined;
  const wardRows = await db
    .select({
      wardId: wards.id,
      nameEn: wards.nameEn,
      nameKn: wards.nameKn,
      signedOffAt: wardReadiness.signedOffAt,
      clearedAt: wardReadiness.clearedAt,
    })
    .from(wards)
    .leftJoin(wardReadiness, eq(wardReadiness.wardId, wards.id))
    .where(wardFilter);

  const awaitingSignOff: AwaitingSignOffWard[] = [];
  for (const row of wardRows) {
    // wasClearedByChange (src/lib/readiness.ts) is the shared, correct
    // formula — signedOffAt and clearedAt are mutually exclusive by
    // construction (see that helper's docstring), so clearedByChange
    // already implies signedOffAt == null; `needsSignOff` is written as an
    // explicit OR anyway as defense-in-depth against a future write path
    // that might not preserve that invariant.
    const clearedByChange = wasClearedByChange(row);
    const needsSignOff = row.signedOffAt == null || clearedByChange;
    if (needsSignOff) {
      awaitingSignOff.push({ wardId: row.wardId, nameEn: row.nameEn, nameKn: row.nameKn, clearedByChange });
    }
  }
  // Cleared-by-change wards FIRST (IA §5.1) — a stable sort keeps the
  // never-signed-off wards in their original (ward-id) order behind them.
  awaitingSignOff.sort((a, b) => Number(b.clearedByChange) - Number(a.clearedByChange));

  return { queueCount: Number(countRow?.count ?? 0), awaitingSignOff };
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
  targetLabel: string;
  submissionCount: number;
  createdAt: Date;
}

/**
 * PENDING flag_items in the caller's scoped wards ONLY (out-of-scope items
 * are simply never selected — this is the list-side half of the scope
 * test; src/pages/curator/queue/[id].astro's `canEditWard` check is the
 * other half, for direct navigation to an item's URL).
 */
export async function loadQueueList(userId: number, role: Role, sort: QueueSort = 'recent'): Promise<QueueListItem[]> {
  const wardIds = await scopedWardIds(userId, role);
  if (wardIds !== null && wardIds.length === 0) return [];

  const wardFilter = wardIds ? inArray(flagItems.wardId, wardIds) : undefined;
  const whereClause = wardFilter ? and(eq(flagItems.status, 'pending'), wardFilter) : eq(flagItems.status, 'pending');

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

  return rows.map((row) => ({
    ...row,
    submissionCount: Number(row.submissionCount),
    targetLabel: humanTargetLabel(row.targetType, row.targetRef),
  }));
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

export interface CandidateFieldContext {
  candidateId: number;
  candidateNameEn: string;
  fieldKey: string;
  valueEn: string | null;
  valueKn: string | null;
  notDeclared: boolean;
  sourceUrl: string | null;
  sourceType: SourceType;
  authoredLang: AuthoredLang;
}

export interface QueueItemDetail {
  id: number;
  wardId: number;
  wardNameEn: string;
  wardNameKn: string;
  targetType: FlagTargetType;
  targetRef: string;
  targetLabel: string;
  status: FlagStatus;
  resolutionReason: string | null;
  createdAt: Date;
  submissions: FlagSubmissionRow[];
  /** Only populated for a candidate_field target whose targetRef parses — the accept path (Task 34) only supports this target type; ward_field/ward_issue publish lands in Task 39. */
  candidateField: CandidateFieldContext | null;
}

/** `null` when no such flag_items row exists (the route twin turns that into a 404). Does NOT check scope — see module docstring. */
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

  let candidateField: CandidateFieldContext | null = null;
  if (item.targetType === 'candidate_field') {
    const parsed = parseCandidateFieldTargetRef(item.targetRef);
    if (parsed) {
      const [candidate] = await db
        .select({ id: candidates.id, nameEn: candidates.nameEn })
        .from(candidates)
        .where(eq(candidates.id, parsed.candidateId));
      const [field] = await db
        .select()
        .from(candidateFields)
        .where(and(eq(candidateFields.candidateId, parsed.candidateId), eq(candidateFields.fieldKey, parsed.fieldKey)));

      candidateField = {
        candidateId: parsed.candidateId,
        candidateNameEn: candidate?.nameEn ?? `Candidate #${parsed.candidateId}`,
        fieldKey: parsed.fieldKey,
        valueEn: field?.valueEn ?? null,
        valueKn: field?.valueKn ?? null,
        notDeclared: field?.notDeclared ?? false,
        sourceUrl: field?.sourceUrl ?? null,
        sourceType: field?.sourceType ?? 'curator',
        authoredLang: field?.authoredLang ?? 'en',
      };
    }
  }

  return {
    ...item,
    targetLabel: humanTargetLabel(item.targetType, item.targetRef),
    submissions,
    candidateField,
  };
}

// ---------------------------------------------------------------------------
// Accept / reject (IA §5.3, PRD §6.1)
// ---------------------------------------------------------------------------

export type ResolveOutcome =
  | { kind: 'accepted' }
  | { kind: 'rejected' }
  | { kind: 'already_resolved' }
  | { kind: 'validation_error'; key: string };

/** True iff `value` parses as an absolute http: or https: URL — same rule as src/pages/api/flags.ts's `sourceUrl` validation, kept local so this module doesn't reach into an API route file. */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Handles the ACCEPT form (candidate_field targets only, for now — see
 * `QueueItemDetail.candidateField`'s docstring). Validates the required
 * source + at least one value (or explicit `notDeclared`), then calls
 * `resolveFlag`, which publishes the field and marks the item accepted
 * atomically. A `flag_already_resolved` throw (someone else resolved it
 * first, e.g. another curator covering the same ward) is caught here and
 * turned into a friendly outcome rather than propagating as a 500.
 */
export async function handleAccept(actor: CuratorActor, item: QueueItemDetail, form: FormData): Promise<ResolveOutcome> {
  if (item.targetType !== 'candidate_field' || !item.candidateField) {
    // ward_field/ward_issue accept-publish lands in Task 39 — see module
    // docstring. The UI disables this form for those target types, but a
    // direct POST is still rejected defensively rather than faking a publish.
    return { kind: 'validation_error', key: 'curator.queueItem.error.acceptUnsupported' };
  }

  const sourceUrl = String(form.get('sourceUrl') ?? '').trim();
  const sourceType: SourceType = String(form.get('sourceType') ?? '') === 'official' ? 'official' : 'curator';
  const authoredLang: AuthoredLang = String(form.get('authoredLang') ?? '') === 'kn' ? 'kn' : 'en';
  const notDeclared = form.get('notDeclared') != null;
  const valueEnRaw = String(form.get('valueEn') ?? '').trim();
  const valueKnRaw = String(form.get('valueKn') ?? '').trim();
  const confirmed = form.get('confirmPublish') != null;

  // Server-side belt-and-suspenders for the "publishes immediately to
  // /ward/{id}" confirmation checkbox (design-system.md §7.13) — the HTML
  // `required` attribute only stops a REAL browser submission; a direct POST
  // (or a future non-browser client) must not be able to skip it.
  if (!confirmed) {
    return { kind: 'validation_error', key: 'curator.queueItem.error.confirmRequired' };
  }
  if (!sourceUrl || !isHttpUrl(sourceUrl)) {
    return { kind: 'validation_error', key: 'curator.queueItem.error.sourceRequired' };
  }
  if (!notDeclared && !valueEnRaw && !valueKnRaw) {
    return { kind: 'validation_error', key: 'curator.queueItem.error.valueRequired' };
  }

  try {
    await resolveFlag(actor, item.id, {
      accept: true,
      publish: {
        candidateId: item.candidateField.candidateId,
        fieldKey: item.candidateField.fieldKey,
        valueEn: valueEnRaw || null,
        valueKn: valueKnRaw || null,
        notDeclared,
        sourceUrl,
        sourceType,
        authoredLang,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'flag_already_resolved') {
      return { kind: 'already_resolved' };
    }
    throw err;
  }

  return { kind: 'accepted' };
}

/** Handles the REJECT form — a reason is required (PRD §6.1 step 3); same `flag_already_resolved` handling as `handleAccept`. */
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
// required source. A status transition or a brand-new candidate is a
// "candidate-set change" that clears the ward's sign-off — see
// src/lib/publish.ts's `publishCandidateCore`/`createCandidate`.
// ---------------------------------------------------------------------------

/** The five report-card fields (PRD §5.2) — fixed set, in display order. */
export const REPORT_CARD_FIELD_KEYS = ['track_record', 'cases', 'assets', 'education', 'approachability'] as const;
export type ReportCardFieldKey = (typeof REPORT_CARD_FIELD_KEYS)[number];

export interface ReportCardFieldEditRow {
  fieldKey: ReportCardFieldKey;
  valueEn: string | null;
  valueKn: string | null;
  notDeclared: boolean;
  sourceUrl: string | null;
  sourceType: SourceType;
  authoredLang: AuthoredLang;
}

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
  fields: Record<ReportCardFieldKey, ReportCardFieldEditRow>;
  affidavits: CandidateAffidavitRow[];
}

/** Loads everything `/curator/candidate/{id}` needs to render: the candidate's core row (+ ward name) and its five report-card fields, defaulting any field with no `candidate_fields` row yet to an empty, not-yet-declared state. `null` when no such candidate exists — the route twin turns that into a 404. Does NOT check scope (same convention as `loadQueueItem` — the caller must `canEditWard` against the returned `wardId`). */
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

  const fieldRows = await db.select().from(candidateFields).where(eq(candidateFields.candidateId, candidateId));
  const byKey = new Map(fieldRows.map((f) => [f.fieldKey, f]));

  const fields = Object.fromEntries(
    REPORT_CARD_FIELD_KEYS.map((key) => {
      const f = byKey.get(key);
      const editRow: ReportCardFieldEditRow = {
        fieldKey: key,
        valueEn: f?.valueEn ?? null,
        valueKn: f?.valueKn ?? null,
        notDeclared: f?.notDeclared ?? false,
        sourceUrl: f?.sourceUrl ?? null,
        sourceType: f?.sourceType ?? 'curator',
        authoredLang: f?.authoredLang ?? 'en',
      };
      return [key, editRow];
    }),
  ) as Record<ReportCardFieldKey, ReportCardFieldEditRow>;

  const affidavitRows = await db
    .select({
      id: candidateAffidavits.id,
      originUrl: candidateAffidavits.originUrl,
      extractionStatus: candidateAffidavits.extractionStatus,
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
    extractionStatus: a.extractionStatus,
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
    fields,
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
export type CandidateFieldOutcome = { kind: 'saved' } | { kind: 'validation_error'; key: string };

/** Error key for a `storeMedia` throw — shared by the core-publish and create paths below. */
function photoErrorKey(err: unknown): string {
  const code = err instanceof Error ? (err.message as MediaStoreErrorCode | string) : '';
  if (code === 'media_too_large') return 'curator.candidateEdit.error.photoTooLarge';
  return 'curator.candidateEdit.error.photoUnsupported';
}

/** Reads+validates the shared name/party/photo fields off a multipart `form` (used by both the core-edit and create paths). Returns a validation-error key, or the parsed values plus a freshly stored `photoMediaId` (`undefined` when no file was chosen — the caller decides what "no file" means for its path). */
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

  let photoMediaId: number | undefined;
  const photo = form.get('photo');
  if (photo instanceof File && photo.size > 0) {
    const allowed = await checkDefaultLimit(actor.userId, 'upload');
    if (!allowed) return { ok: false, key: 'curator.candidateEdit.error.uploadRateLimited' };

    try {
      const bytes = Buffer.from(await photo.arrayBuffer());
      const stored = await storeMedia(actor, { bytes, declaredType: photo.type }, 'photo');
      photoMediaId = stored.id;
    } catch (err) {
      return { ok: false, key: photoErrorKey(err) };
    }
  }

  return {
    ok: true,
    nameEn,
    nameKn: nameKnRaw || null,
    partyEn,
    partyKn: partyKnRaw || null,
    ...(photoMediaId !== undefined ? { photoMediaId } : {}),
  };
}

/**
 * Handles the CORE form on `/curator/candidate/{id}` (name/party/photo/
 * status). A photo file is only read (and stored) when one was actually
 * chosen — an empty file input leaves the existing photo untouched, it does
 * NOT clear it. Publishes via `publishCandidateCore`, which itself clears
 * the ward's sign-off atomically IF `status` actually changed (see that
 * function's docstring) — this handler doesn't need to know or care which
 * case applies.
 *
 * INVARIANT: status is validated BEFORE parseCandidateCoreForm runs, so an
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

  const parsed = await parseCandidateCoreForm(actor, form);
  if (!parsed.ok) return { kind: 'validation_error', key: parsed.key };

  await publishCandidateCore(actor, {
    candidateId,
    nameEn: parsed.nameEn,
    nameKn: parsed.nameKn,
    partyEn: parsed.partyEn,
    partyKn: parsed.partyKn,
    status,
    ...(parsed.photoMediaId !== undefined ? { photoMediaId: parsed.photoMediaId } : {}),
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

/**
 * Handles ONE report-card field's form on `/curator/candidate/{id}`
 * (`formAction=field:{fieldKey}`). SOURCE REQUIRED (PRD §11 — source is the
 * trust mechanism): a submission with a value (or `notDeclared`) but no
 * source is rejected before anything is published — this mirrors
 * `handleAccept`'s identical rule for the flag-queue accept path. A
 * `notDeclared` field still needs a source (the affidavit itself, even when
 * it declares nothing) — there is no path that skips this check.
 */
export async function handleCandidateFieldPublish(
  actor: CuratorActor,
  candidateId: number,
  fieldKey: ReportCardFieldKey,
  form: FormData,
): Promise<CandidateFieldOutcome> {
  const sourceUrl = String(form.get('sourceUrl') ?? '').trim();
  const sourceType: SourceType = String(form.get('sourceType') ?? '') === 'official' ? 'official' : 'curator';
  const authoredLang: AuthoredLang = String(form.get('authoredLang') ?? '') === 'kn' ? 'kn' : 'en';
  const notDeclared = form.get('notDeclared') != null;
  const valueEnRaw = String(form.get('valueEn') ?? '').trim();
  const valueKnRaw = String(form.get('valueKn') ?? '').trim();

  if (!sourceUrl || !isHttpUrl(sourceUrl)) {
    return { kind: 'validation_error', key: 'curator.candidateEdit.error.sourceRequired' };
  }
  if (!notDeclared && !valueEnRaw && !valueKnRaw) {
    return { kind: 'validation_error', key: 'curator.candidateEdit.error.valueRequired' };
  }

  await publishCandidateField(actor, {
    candidateId,
    fieldKey,
    valueEn: valueEnRaw || null,
    valueKn: valueKnRaw || null,
    notDeclared,
    sourceUrl,
    sourceType,
    authoredLang,
  });

  return { kind: 'saved' };
}

// ---------------------------------------------------------------------------
// Affidavit ingestion (Task 37; architecture §7/§13; PRD §5.2) — the
// `formAction=affidavit` form on `/curator/candidate/{id}`: upload the PDF
// directly, OR paste its EC link (fetched SSRF-hardened, src/lib/affidavit-fetch.ts).
// Either path lands the same way from here on: `storeMedia(kind:'affidavit')`
// (magic-byte + size validation, identical for both paths — architecture
// §7's "fetched bytes pass the same validation as a direct upload"), a new
// `candidate_affidavits` row, then AI extraction
// (src/lib/extract.ts) run in-request so the editor can surface a failure
// immediately rather than leaving the curator wondering.
// ---------------------------------------------------------------------------

export type CandidateAffidavitOutcome =
  | { kind: 'saved'; extractionFailed: boolean }
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
 * Extraction runs in-request (`await`ed): a failure there does NOT fail this
 * whole publish — the affidavit is still stored and the
 * `candidate_affidavits` row still lands (`extractionStatus: 'failed'`,
 * written by `extractAffidavitFields` itself); the caller surfaces
 * `extractionFailed: true` as a notice rather than a hard error, since the
 * curator can still see/re-trigger extraction later (a jobs-based retry is
 * a later concern per the task brief).
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

  let mediaId: number;
  try {
    const stored = await storeMedia(actor, { bytes }, 'affidavit');
    mediaId = stored.id;
  } catch (err) {
    return { kind: 'validation_error', key: affidavitStoreErrorKey(err) };
  }

  await db.insert(candidateAffidavits).values({
    candidateId,
    mediaId,
    originUrl: ecUrl || null,
    extractionStatus: 'pending',
  });

  let extractionFailed = false;
  try {
    await extractAffidavitFields(mediaId, candidateId, { userId: actor.userId });
  } catch {
    extractionFailed = true;
  }

  return { kind: 'saved', extractionFailed };
}

// ---------------------------------------------------------------------------
// News links (Task 38; PRD §5.2 "News & coverage"; architecture §7) — the
// `formAction=news_link_add` / `formAction=news_link_approve` forms on
// `/curator/candidate/{id}`. The engine (write-time http(s) validation,
// curator-added-vs-auto-suggested lifecycles, the public `approvedOnly`
// guard) lives in src/lib/news.ts; these two handlers only own the
// FormData parsing + the extra scope-hop guard described below.
// ---------------------------------------------------------------------------

export type NewsLinkOutcome = { kind: 'saved' } | { kind: 'validation_error'; key: string };

/**
 * Handles the "add a link" form. A curator-added link publishes directly
 * (src/lib/news.ts's `addNewsLink`) — no approval step. `url`/`title` are
 * re-validated here for a nicer inline error message; `addNewsLink` itself
 * re-validates the URL independently regardless (defense in depth — see
 * its docstring).
 */
export async function handleNewsLinkAdd(actor: CuratorActor, candidateId: number, form: FormData): Promise<NewsLinkOutcome> {
  const url = String(form.get('url') ?? '').trim();
  const title = String(form.get('title') ?? '').trim();

  if (!title) {
    return { kind: 'validation_error', key: 'curator.candidateEdit.newsLinks.error.titleRequired' };
  }
  if (!url || !isHttpUrl(url)) {
    return { kind: 'validation_error', key: 'curator.candidateEdit.newsLinks.error.urlInvalid' };
  }

  try {
    await addNewsLink(actor, candidateId, url, title);
  } catch (err) {
    if (err instanceof Error && err.message === 'duplicate_url') {
      return { kind: 'validation_error', key: 'curator.candidateEdit.newsLinks.error.duplicateUrl' };
    }
    throw err;
  }

  return { kind: 'saved' };
}

/**
 * Handles the "approve" form on a `suggested` link. `approveNewsLink`
 * itself trusts its caller on ward-scope (see that function's docstring) —
 * the SCOPE-HOP GUARD here is what makes that trust safe: the page has
 * already 403'd for a curator out of scope for `candidateId`'s ward, but
 * without this extra check a curator could still POST an arbitrary
 * `linkId` belonging to a DIFFERENT (out-of-scope) candidate alongside
 * this in-scope candidate's URL. Re-selecting the link and confirming its
 * `candidateId` matches the page's `candidateId` before calling
 * `approveNewsLink` closes that gap.
 */
export async function handleNewsLinkApprove(actor: CuratorActor, candidateId: number, form: FormData): Promise<NewsLinkOutcome> {
  const linkId = Number(form.get('linkId'));
  if (!Number.isInteger(linkId)) {
    return { kind: 'validation_error', key: 'curator.candidateEdit.newsLinks.error.notFound' };
  }

  const [link] = await db
    .select({ candidateId: candidateNewsLinks.candidateId })
    .from(candidateNewsLinks)
    .where(eq(candidateNewsLinks.id, linkId));
  if (!link || link.candidateId !== candidateId) {
    return { kind: 'validation_error', key: 'curator.candidateEdit.newsLinks.error.notFound' };
  }

  await approveNewsLink(actor, linkId);
  return { kind: 'saved' };
}

// ---------------------------------------------------------------------------
// Ward editor + readiness panel (Task 39; IA §5.5-adjacent; PRD §9.1;
// design-system.md §7.13) — `/curator/ward/{id}`'s data-loading side. The
// mechanical completeness check, sign-off, and the comms send-gate
// themselves live in src/lib/readiness.ts; this module only assembles the
// page-level view model (ward metadata + the current readiness/sign-off
// state) and dispatches the "Mark ward ready" POST.
// ---------------------------------------------------------------------------

export interface WardEditData {
  id: number;
  nameEn: string;
  nameKn: string;
  corporation: string;
  zone: string;
  boundaryRef: string;
  readiness: ReadinessResult;
  signedOffAt: Date | null;
  /** The signing curator/admin's email, when resolvable — falls back to their raw user id in the view (WardEdit.astro) when a user row no longer resolves. */
  signedOffByEmail: string | null;
  signedOffByUserId: number | null;
  clearedAt: Date | null;
}

/**
 * Loads everything `/curator/ward/{id}` needs to render: the ward's own
 * (official, curator-read-only in this task) metadata, the live
 * `computeReadiness` result, and the current `ward_readiness` sign-off
 * state. `null` when no such ward exists — the route twin turns that into
 * a 404. Does NOT check scope (same convention as `loadCandidateForEdit` —
 * the caller must `canEditWard` against the returned ward id).
 */
export async function loadWardForEdit(wardId: number): Promise<WardEditData | null> {
  const [ward] = await db.select().from(wards).where(eq(wards.id, wardId));
  if (!ward) return null;

  const [readinessRow] = await db
    .select({
      signedOffAt: wardReadiness.signedOffAt,
      signedOffBy: wardReadiness.signedOffBy,
      clearedAt: wardReadiness.clearedAt,
    })
    .from(wardReadiness)
    .where(eq(wardReadiness.wardId, wardId));

  let signedOffByEmail: string | null = null;
  if (readinessRow?.signedOffBy != null) {
    const [signer] = await db.select({ email: users.email }).from(users).where(eq(users.id, readinessRow.signedOffBy));
    signedOffByEmail = signer?.email ?? null;
  }

  const readiness = await computeReadiness(wardId);

  return {
    id: ward.id,
    nameEn: ward.nameEn,
    nameKn: ward.nameKn,
    corporation: ward.corporation,
    zone: ward.zone,
    boundaryRef: ward.boundaryRef,
    readiness,
    signedOffAt: readinessRow?.signedOffAt ?? null,
    signedOffByEmail,
    signedOffByUserId: readinessRow?.signedOffBy ?? null,
    clearedAt: readinessRow?.clearedAt ?? null,
  };
}

export type SignOffOutcome = { kind: 'saved' } | { kind: 'out_of_scope' };

/**
 * Handles the "Mark ward ready" form. `signOffWard` (src/lib/readiness.ts)
 * itself re-checks scope (defense in depth — the route twin has already
 * 403'd once for GET/POST, same convention as every other scope-checked
 * mutator in this module) and writes the readiness snapshot.
 */
export async function handleWardSignOff(actor: CuratorActor, wardId: number): Promise<SignOffOutcome> {
  try {
    await signOffWard(actor, wardId);
  } catch (err) {
    if (err instanceof Error && err.message === 'out_of_scope') {
      return { kind: 'out_of_scope' };
    }
    throw err;
  }
  return { kind: 'saved' };
}

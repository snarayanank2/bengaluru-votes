/**
 * Ward data-readiness (Task 39; PRD §9.1; design-system.md §7.13). A ward is
 * "ready for comms" when TWO independent things are both true:
 *
 *   1. COMPLETENESS — a mechanical check over the ward's active candidates
 *      (`computeReadiness`).
 *   2. SIGN-OFF — a curator/admin has explicitly vouched for the ward
 *      (`signOffWard`), which a later "candidate-set change" (a status
 *      transition or a new filing — see src/lib/publish.ts's
 *      `clearWardSignOff`) clears.
 *
 * `isWardReadyForComms` is the combined SEND GATE Task 54's jobs container
 * checks before mailing/WhatsApp-ing a ward's report cards.
 *
 * IMPORTANT — sign-off does NOT require completeness. `signOffWard` records
 * a human judgement ON TOP of the mechanical check; it never refuses to
 * sign off an incomplete ward. The readiness panel (WardEdit.astro) always
 * shows the gap list precisely so that judgement is INFORMED, not a blind
 * reflex click (design-system.md §7.13). It is `isWardReadyForComms` —
 * completeness AND sign-off together — that actually gates anything.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { candidateFields, candidates, wardReadiness } from '../db/schema';
import { canEditWard } from './authz';

/** The three affidavit-derived report-card fields whose completeness this task's gate cares about (name/party are checked separately, off the `candidates` row itself). */
const AFFIDAVIT_FIELD_KEYS = ['cases', 'assets', 'education'] as const;

/** Candidate statuses that count towards ward readiness — 'withdrawn'/'rejected' are excluded entirely (PRD §5.2/§9.1): a withdrawn candidate's data gaps never block (or even appear against) the ward. */
const ACTIVE_CANDIDATE_STATUSES = ['filed', 'contesting'] as const;

export interface ReadinessGap {
  candidateId: number;
  candidateName: string;
  /** Field identifiers with a gap — 'name' | 'party' | one of AFFIDAVIT_FIELD_KEYS. */
  missing: string[];
}

export interface ReadinessResult {
  complete: boolean;
  gaps: ReadinessGap[];
}

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === '';
}

function isPopulated(valueEn: string | null, valueKn: string | null): boolean {
  return !isBlank(valueEn) || !isBlank(valueKn);
}

/**
 * Computes the mechanical completeness check for `wardId` (PRD §9.1),
 * considering ONLY 'filed'/'contesting' candidates.
 *
 * ZERO active candidates -> `{ complete: false, gaps: [] }`. This is
 * deliberate, not an oversight: a ward with no filed/contesting candidates
 * can never be "ready" — there is nothing for a citizen to read on its
 * report-card page. A prototype bug once let an empty ward get signed off,
 * sending citizens to a blank page. Callers distinguish "no candidates yet"
 * from "candidates but all complete" by checking `gaps.length === 0`
 * alongside `complete === false` — the FIRST case (no candidates) has an
 * empty `gaps` array too, so a caller wanting the human-readable
 * distinction must check candidate count separately (WardEdit.astro does,
 * for its own copy).
 *
 * For each active candidate: `nameEn`/`partyEn` must be non-blank (a gap
 * otherwise, keyed `'name'`/`'party'`), and each of `cases`/`assets`/
 * `education` must have a `candidate_fields` row that is EITHER populated
 * (non-blank `valueEn` or `valueKn`) OR explicitly `notDeclared` — a
 * missing row, or a row that is neither populated nor notDeclared, is a
 * gap keyed by the field key. Every PRESENT field (populated or
 * notDeclared) must also carry a non-blank `sourceUrl` — a populated (or
 * notDeclared) field with no source is ALSO a gap (PRD §11: source is the
 * trust mechanism, and a "not declared" answer is still sourced from the
 * affidavit that declared nothing).
 */
export async function computeReadiness(wardId: number): Promise<ReadinessResult> {
  const candidateRows = await db
    .select({ id: candidates.id, nameEn: candidates.nameEn, partyEn: candidates.partyEn })
    .from(candidates)
    .where(and(eq(candidates.wardId, wardId), inArray(candidates.status, ACTIVE_CANDIDATE_STATUSES)));

  if (candidateRows.length === 0) {
    return { complete: false, gaps: [] };
  }

  const candidateIds = candidateRows.map((c) => c.id);
  const fieldRows = await db.select().from(candidateFields).where(inArray(candidateFields.candidateId, candidateIds));

  const fieldsByCandidate = new Map<number, Map<string, (typeof fieldRows)[number]>>();
  for (const row of fieldRows) {
    if (!fieldsByCandidate.has(row.candidateId)) fieldsByCandidate.set(row.candidateId, new Map());
    fieldsByCandidate.get(row.candidateId)!.set(row.fieldKey, row);
  }

  const gaps: ReadinessGap[] = [];

  for (const candidate of candidateRows) {
    const missing: string[] = [];

    if (isBlank(candidate.nameEn)) missing.push('name');
    if (isBlank(candidate.partyEn)) missing.push('party');

    const fields = fieldsByCandidate.get(candidate.id);
    for (const key of AFFIDAVIT_FIELD_KEYS) {
      const field = fields?.get(key);

      if (!field) {
        missing.push(key);
        continue;
      }
      if (!field.notDeclared && !isPopulated(field.valueEn, field.valueKn)) {
        missing.push(key);
        continue;
      }
      if (isBlank(field.sourceUrl)) {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      gaps.push({ candidateId: candidate.id, candidateName: candidate.nameEn, missing });
    }
  }

  return { complete: gaps.length === 0, gaps };
}

export type CuratorActor = { userId: number; role: 'curator' | 'admin' };

/**
 * True iff a `ward_readiness` row represents "was signed off, then cleared
 * by a later candidate-set change" (PRD §9.1; IA §5.1: must be called out
 * FIRST on the curator dashboard's awaiting-sign-off list). `clearWardSignOff`
 * (src/lib/publish.ts) always NULLS `signedOffAt` the instant it clears a
 * ward, and `signOffWard` above always NULLS `clearedAt` the instant it
 * (re-)signs off a ward — so these two fields are mutually exclusive by
 * construction, never both non-null at once. "Cleared by change" is
 * therefore exactly `signedOffAt == null && clearedAt != null` — a ward
 * that has NEVER been signed off (both null) is a different state and must
 * NOT match this.
 *
 * Shared by src/lib/curator.ts's dashboard (`loadDashboard`) and
 * src/features/pages/curator/WardEdit.astro's readiness panel so the two
 * views can't independently drift out of sync — the dashboard's own inline
 * copy of this check previously used a different (permanently-false, dead)
 * formula, which silently broke the IA §5.1 early-warning sort. Route both
 * through here instead of re-deriving it.
 */
export function wasClearedByChange(row: { signedOffAt: Date | null; clearedAt: Date | null }): boolean {
  return row.signedOffAt == null && row.clearedAt != null;
}

/**
 * Records a curator/admin's sign-off for `wardId` (PRD §9.1). SCOPE-CHECKED
 * (`canEditWard`) — throws `Error('out_of_scope')` for a curator not
 * assigned to this ward; admin is always allowed.
 *
 * Snapshots the CURRENT `computeReadiness` result into
 * `completeness_snapshot` (so a later audit/dispute can see exactly what
 * the curator saw at sign-off time, even if the underlying data changes
 * afterwards), sets `signed_off_by`/`signed_off_at` to this actor/now, and
 * resets `cleared_at` to null — a fresh sign-off always supersedes any
 * earlier "cleared by a candidate-set change" state.
 *
 * DOES NOT REFUSE ON INCOMPLETENESS — see the module docstring. The
 * curator has just been shown the gap list (WardEdit.astro renders it
 * unconditionally); clicking "Mark ward ready" anyway is an informed
 * human override, not a bug to guard against here. `isWardReadyForComms`
 * is what actually enforces completeness for anything downstream.
 *
 * Upserts the `ward_readiness` row (a ward may never have had one).
 */
export async function signOffWard(actor: CuratorActor, wardId: number): Promise<void> {
  const inScope = await canEditWard(actor.userId, actor.role, wardId);
  if (!inScope) {
    throw new Error('out_of_scope');
  }

  const readiness = await computeReadiness(wardId);
  const now = new Date();

  await db.transaction(async (tx) => {
    const newValue = {
      completenessSnapshot: readiness,
      signedOffBy: actor.userId,
      signedOffAt: now,
      clearedAt: null as Date | null,
    };

    await tx
      .insert(wardReadiness)
      .values({ wardId, ...newValue })
      .onConflictDoUpdate({ target: wardReadiness.wardId, set: newValue });

  });
}

/**
 * The comms SEND GATE (Task 54's jobs container calls this before mailing/
 * WhatsApp-ing a ward's candidate report cards): true iff
 * `computeReadiness(wardId).complete` AND the ward is currently signed off
 * (`signedOffAt` set, and not cleared since) — OR `commsHoldOverride` is
 * true (an admin's explicit release valve, independent of the mechanical
 * state, for a judgement call this gate can't model).
 *
 * "Not cleared since" is `clearedAt == null || clearedAt <= signedOffAt` —
 * in practice, `clearWardSignOff` (src/lib/publish.ts) always NULLS
 * `signedOffAt` the moment it clears a ward, so `signedOffAt` being set at
 * all already implies "not currently cleared"; the explicit `clearedAt`
 * comparison is a defensive belt-and-suspenders check against any future
 * write path that might set both fields without going through that
 * function, kept because a comms send-gate is exactly the kind of check
 * that must fail closed on an ambiguous row rather than assume the only
 * write path in place today is the only one that will ever exist.
 */
export async function isWardReadyForComms(wardId: number): Promise<boolean> {
  const [row] = await db.select().from(wardReadiness).where(eq(wardReadiness.wardId, wardId));

  if (row?.commsHoldOverride) return true;
  if (!row || row.signedOffAt == null) return false;

  const clearedSinceSignOff = row.clearedAt != null && row.clearedAt > row.signedOffAt;
  if (clearedSinceSignOff) return false;

  const { complete } = await computeReadiness(wardId);
  return complete;
}

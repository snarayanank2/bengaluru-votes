/**
 * The deduped flag queue (PRD §6.1-§6.3; architecture §7) — the citizen
 * misinformation-flagging path and the curator correction loop's front
 * door.
 *
 * DEDUPE (PRD §6.3): "multiple flags on the same field collapse into ONE
 * queue item with a count; resolving resolves every collapsed flag at
 * once, same outcome + reason". The schema encodes this as a PARTIAL
 * unique index, `flag_dedupe_uq` on `target_ref` WHERE `status = 'pending'`
 * — at most one PENDING `flag_items` row per `target_ref` at any time, but
 * any number of already-resolved (accepted/rejected) rows for that same
 * `target_ref` are allowed to coexist (a full composite index on
 * `(target_ref, status)` would wrongly also forbid two rows sharing the
 * SAME non-pending status, e.g. a second reject after flag→reject→flag→
 * reject on the same target). Every citizen submission for the same
 * `targetRef` finds-or-creates that one pending item and appends its own
 * `flag_submissions` row; the item's submission count IS the "count" the
 * queue UI shows. A fresh flag on a target whose prior item was already
 * resolved (accepted or rejected) opens a brand-new pending item — the
 * resolved item(s) and the new pending one coexist; resolution history is
 * never overwritten.
 *
 * RACE (two submitters flagging the same never-before-flagged target at
 * the same instant): both find no pending row and both attempt to INSERT
 * one; the unique index lets exactly one succeed, and the loser gets a
 * 23505. A failed statement aborts the enclosing Postgres transaction for
 * every subsequent statement UNTIL a ROLLBACK (or a ROLLBACK TO SAVEPOINT)
 * — so the insert attempt below runs inside a NESTED transaction
 * (`tx.transaction(...)`, which drizzle-orm's postgres-js driver
 * implements as a SAVEPOINT, see node_modules/drizzle-orm/postgres-js).
 * When the insert fails, only that savepoint rolls back; the outer
 * transaction (still open) can then re-SELECT the winner's row and
 * proceed with the submission as normal.
 */
import { and, eq } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { candidates, flagItems, flagSubmissions, wardIssues, wards } from '../db/schema';
import { canEditWard } from './authz';
import { isUniqueViolation } from './db-errors';
import { publishCandidateFieldTx, type PublishCandidateFieldInput } from './publish';
import { translateFieldSoon } from './translate-runtime';

export type FlagTargetType = 'candidate_field' | 'ward_field' | 'ward_issue';

export interface SubmitFlagInput {
  /**
   * ADVISORY ONLY — NOT TRUSTED. The ward a flag is filed under is DERIVED
   * server-side from `targetRef` (see `deriveTargetWardId`), never taken from
   * this client-supplied value. It stays on the type only because the API
   * route's request schema still carries it; `submitFlag` ignores it. A
   * mismatch between this and the target's real ward means the derived (real)
   * ward wins — this is what stops a curator/citizen from filing a flag whose
   * target candidate lives in ward B into ward A's queue and having ward A's
   * curator (who has no scope over B) accept+publish it.
   */
  wardId?: number;
  targetType: FlagTargetType;
  targetRef: string;
  detail: string;
  suggestedValue?: string | null;
  sourceUrl?: string | null;
}

/** Thrown by `deriveTargetWardId` (and surfaced by `submitFlag`) when `targetRef` is malformed for its `targetType`, or points at a target that doesn't exist — the API route turns this into a 400 rather than filing a flag against a nonexistent target. */
export class InvalidFlagTargetError extends Error {
  constructor(message = 'invalid_flag_target') {
    super(message);
    this.name = 'InvalidFlagTargetError';
  }
}

/**
 * The ONLY authority on which ward a flag is filed under: derives it from the
 * TARGET, server-side, never from the client. A citizen may flag ANY ward's
 * content (flagging is city-wide), but the resulting queue item MUST land in
 * the TARGET's real ward so the correct (scoped) curator sees and can act on
 * it. Rejects (throws {@link InvalidFlagTargetError}) a malformed targetRef or
 * a target row that doesn't exist.
 *
 *   - candidate_field (`candidate:<id>:<fieldKey>`): the candidate's own
 *     `wardId` (the field being flagged belongs to that candidate).
 *   - ward_field     (`ward:<id>:<fieldKey>`): the ward IS the id in the ref
 *     (verified to exist).
 *   - ward_issue     (`ward_issue:<id>`): the `ward_issues` row's `wardId`.
 */
export async function deriveTargetWardId(targetType: FlagTargetType, targetRef: string): Promise<number> {
  if (targetType === 'candidate_field') {
    const match = /^candidate:(\d+):(.+)$/.exec(targetRef);
    if (!match) throw new InvalidFlagTargetError();
    const candidateId = Number(match[1]);
    const [row] = await db.select({ wardId: candidates.wardId }).from(candidates).where(eq(candidates.id, candidateId));
    if (!row) throw new InvalidFlagTargetError();
    return row.wardId;
  }

  if (targetType === 'ward_field') {
    const match = /^ward:(\d+):(.+)$/.exec(targetRef);
    if (!match) throw new InvalidFlagTargetError();
    const wardId = Number(match[1]);
    const [row] = await db.select({ id: wards.id }).from(wards).where(eq(wards.id, wardId));
    if (!row) throw new InvalidFlagTargetError();
    return row.id;
  }

  // ward_issue
  const match = /^ward_issue:(\d+)$/.exec(targetRef);
  if (!match) throw new InvalidFlagTargetError();
  const issueId = Number(match[1]);
  const [row] = await db.select({ wardId: wardIssues.wardId }).from(wardIssues).where(eq(wardIssues.id, issueId));
  if (!row) throw new InvalidFlagTargetError();
  return row.wardId;
}

export type ResolveFlagResolution =
  | { accept: true; publish: PublishCandidateFieldInput }
  | { accept: false; reason: string };

/** Finds the current PENDING flag_items row for `targetRef`, if any. */
async function selectPending(tx: Tx, targetRef: string): Promise<{ id: number } | undefined> {
  const [row] = await tx
    .select({ id: flagItems.id })
    .from(flagItems)
    .where(and(eq(flagItems.targetRef, targetRef), eq(flagItems.status, 'pending')));
  return row;
}

/**
 * Finds or creates the PENDING flag_items row for `input.targetRef`,
 * inside `tx`. See the module docstring for the race/savepoint handling.
 */
async function findOrCreatePendingItem(tx: Tx, input: SubmitFlagInput, wardId: number): Promise<number> {
  const existing = await selectPending(tx, input.targetRef);
  if (existing) return existing.id;

  try {
    // Nested transaction (SAVEPOINT): if the insert below loses the unique-
    // index race, only this savepoint rolls back — the outer `tx` stays
    // usable for the re-select and everything submitFlag does after this.
    return await tx.transaction(async (tx2) => {
      const [created] = await tx2
        .insert(flagItems)
        .values({
          wardId,
          targetType: input.targetType,
          targetRef: input.targetRef,
          status: 'pending',
        })
        .returning({ id: flagItems.id });
      return created!.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await selectPending(tx, input.targetRef);
      if (winner) return winner.id;
    }
    throw err;
  }
}

/**
 * Submits a citizen's misinformation flag against `targetRef` (PRD §6.1,
 * §6.2). Finds-or-creates the pending queue item for `targetRef`, appends
 * this submitter's `flag_submissions` row in one transaction.
 */
export async function submitFlag(userId: number, input: SubmitFlagInput): Promise<{ flagItemId: number }> {
  // Derive the ward from the TARGET, server-side — the client-supplied
  // `input.wardId` is never trusted (see `SubmitFlagInput.wardId` /
  // `deriveTargetWardId`). A malformed/nonexistent target throws
  // InvalidFlagTargetError here, BEFORE any transaction opens — nothing is
  // written for a target that doesn't exist.
  const wardId = await deriveTargetWardId(input.targetType, input.targetRef);

  const flagItemId = await db.transaction(async (tx) => {
    const itemId = await findOrCreatePendingItem(tx, input, wardId);

    await tx.insert(flagSubmissions).values({
      flagItemId: itemId,
      userId,
      detail: input.detail,
      suggestedValue: input.suggestedValue ?? null,
      sourceUrl: input.sourceUrl ?? null,
    });

    return itemId;
  });

  return { flagItemId };
}

/**
 * Resolves a queue item (curator/admin only — PRD §6.1; the caller, e.g.
 * Task 34's curator route, ALSO does a per-ward `canEditWard` scope check
 * on the loaded item BEFORE calling this).
 *
 * ACCEPT-PATH SCOPE RE-CHECK (final-review Fix 1, defense-in-depth): before
 * publishing, this re-derives the REAL ward of the candidate actually being
 * written (`resolution.publish.candidateId`'s `wardId`) and asserts the
 * acting curator `canEditWard` THAT ward — not merely the flag item's stored
 * `wardId`. Admin (city-wide) always passes. This closes the seam
 * permanently: even a legacy/hand-inserted flag_items row whose stored
 * `wardId` was filed against the wrong ward (so the route's item.wardId
 * check passed for a curator who has no scope over the candidate's true
 * ward) can never publish a field in a ward the curator doesn't own — the
 * publish is authorized against the write's ACTUAL target ward. Throws
 * `out_of_scope` (failing closed — no publish, no status flip) when not
 * allowed.
 *
 * ACCEPT (candidate_field targets only, for now — ward_field/ward_issue
 * accept-publish paths land in Tasks 34/39): publishes the field via
 * {@link publishCandidateFieldTx} and marks the item `accepted` in the
 * SAME transaction, so a publish can never land without its flag item
 * being marked resolved (or vice versa).
 *
 * REJECT: marks the item `rejected` with `reason`; never publishes
 * anything.
 *
 * Either way, resolving the ITEM resolves every collapsed submission at
 * once (PRD §6.3) — the outcome/reason lives on `flag_items`, and every
 * `flag_submissions` row for this item points at it, so there is no
 * per-submission update to make.
 *
 * RE-RESOLVE GUARD: an item can only be resolved once. The transaction
 * opens by re-selecting the flag_item row `FOR UPDATE` — this locks the
 * row against any concurrent resolveFlag call on the same id for the
 * duration of the transaction, and lets us assert `status === 'pending'`
 * BEFORE doing any publish work. If the item is no longer pending (already
 * accepted or rejected — including by a call that's racing us and wins the
 * lock first), this throws `flag_already_resolved` and rolls back: no
 * publish and no status flip. Without this, two concurrent
 * accepts on the same item could both publish (double-publish), or an
 * accept followed by a reject could flip an already-published item's
 * status to `rejected` while leaving the publish in place. The UPDATE
 * statements additionally carry `status = 'pending'` in their WHERE clause
 * as defense in depth (belt-and-suspenders alongside the row lock).
 */
export async function resolveFlag(
  actor: { userId: number; role: 'curator' | 'admin' },
  flagItemId: number,
  resolution: ResolveFlagResolution,
): Promise<void> {
  const published = await db.transaction(async (tx) => {
    const [item] = await tx.select().from(flagItems).where(eq(flagItems.id, flagItemId)).for('update');

    if (!item || item.status !== 'pending') {
      throw new Error('flag_already_resolved');
    }

    if (resolution.accept) {
      // ACCEPT-PATH SCOPE RE-CHECK (see docstring): authorize the write
      // against the candidate's REAL ward, re-derived here — not the flag
      // item's stored `wardId`. Admin passes via canEditWard's role branch.
      const [targetCandidate] = await tx
        .select({ wardId: candidates.wardId })
        .from(candidates)
        .where(eq(candidates.id, resolution.publish.candidateId));
      if (!targetCandidate) {
        throw new Error(`resolveFlag: no candidate with id ${resolution.publish.candidateId}`);
      }
      const allowed = await canEditWard(actor.userId, actor.role, targetCandidate.wardId);
      if (!allowed) {
        throw new Error('out_of_scope');
      }

      // Task 31 scope: accept only supports candidate_field targets, via
      // the shared publish core. ward_field/ward_issue accept-publish
      // paths are added by Tasks 34/39 (a discriminated union over
      // resolution.publish's target type, once those publish helpers
      // exist) — this is not a runtime branch yet because there is only
      // one publish path to call.
      const { id: fieldId, translationStatus } = await publishCandidateFieldTx(tx, actor, resolution.publish);

      await tx
        .update(flagItems)
        .set({
          status: 'accepted',
          resolutionReason: null,
          resolvedBy: actor.userId,
          resolvedAt: new Date(),
        })
        .where(and(eq(flagItems.id, flagItemId), eq(flagItems.status, 'pending')));

      return { fieldId, translationStatus };
    }

    await tx
      .update(flagItems)
      .set({
        status: 'rejected',
        resolutionReason: resolution.reason,
        resolvedBy: actor.userId,
        resolvedAt: new Date(),
      })
      .where(and(eq(flagItems.id, flagItemId), eq(flagItems.status, 'pending')));

    return null;
  });

  // Mirrors publishCandidateField: only fire the (fire-and-forget)
  // translation kickoff once the transaction has actually committed, only
  // on the accept path (a reject never publishes anything to translate),
  // and only when the publish-path coordination (`decideTranslationStatus`,
  // src/lib/publish.ts) decided this was a `'pending'` change — not a
  // `'manual'` translation edit (Task 40; architecture §9).
  if (published !== null && published.translationStatus === 'pending') {
    translateFieldSoon({ table: 'candidate_fields', id: published.fieldId });
  }
}

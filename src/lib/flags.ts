/**
 * The deduped flag queue (architecture §7) — the citizen
 * misinformation-flagging path and the curator correction loop's front
 * door.
 *
 * DEDUPE: "multiple flags on the same field collapse into ONE
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
import { and, eq, sql, or } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { candidates, candidateFields, flagItems, flagSubmissions } from '../db/schema';
import { FLAGGABLE_FIELD_KEYS } from './candidate-profile';
import { isUniqueViolation } from './db-errors';
import { moveCandidateWard, publishAffidavitFields, type FieldData } from './affidavit-publish';
import { translateFieldSoon } from './translate-runtime';
import { createHash } from 'node:crypto';
import { flagLock, lockReporter, checkFlagAllowance, recordFlagAdmission, reportFingerprint, metric, type FlagReporter } from './flag-abuse';

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
 * it.
 *
 * The one remaining case is `candidate_field` (`candidate:<id>:<fieldKey>`):
 * the candidate's own `wardId`, provided `<fieldKey>` is one of
 * {@link FLAGGABLE_FIELD_KEYS} and the candidate exists. Anything else — a
 * ward_field or ward_issue target, the affidavit document, an unknown field,
 * a malformed ref — throws {@link InvalidFlagTargetError}. `ward_field` and
 * `ward_issue` remain in the DB enum only so old rows can still be read.
 */
export async function deriveTargetWardId(targetType: FlagTargetType, targetRef: string): Promise<number> {
  if (targetType !== 'candidate_field') throw new InvalidFlagTargetError();
  const match = /^candidate:(\d+):(.+)$/.exec(targetRef);
  if (!match || !(FLAGGABLE_FIELD_KEYS as readonly string[]).includes(match[2]!)) throw new InvalidFlagTargetError();
  const candidateId = Number(match[1]);
  if (!Number.isSafeInteger(candidateId) || candidateId < 1 || candidateId > 2147483647 || String(candidateId) !== match[1]) throw new InvalidFlagTargetError();
  const [row] = await db.select({ wardId: candidates.wardId }).from(candidates).where(eq(candidates.id, Number(match[1])));
  if (!row) throw new InvalidFlagTargetError();
  return row.wardId;
}

/** What accepting a flag publishes: one affidavit field's corrected value, or the candidate moved to another ward. `sourceUrl` is the stored affidavit it was checked against. */
export type FlagFix =
  | { kind: 'field'; candidateId: number; data: FieldData; sourceUrl: string }
  | { kind: 'ward'; candidateId: number; wardId: number; sourceUrl: string };

export type ResolveFlagResolution = { accept: true; fix: FlagFix } | { accept: false; reason: string };

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
 * Submits a citizen's misinformation flag against `targetRef`
 * (docs/architecture.md §7). Finds-or-creates the pending queue item for `targetRef`, appends
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

export interface FlagResult { state: 'accepted' | 'duplicate' | 'already_reported' | 'already_reviewed'; flagItemId?: number }

/** Canonical published value, including translations and unreadable/not-declared state. */
export async function flagValueHash(tx: Tx, targetRef: string): Promise<string> {
  const [, id, key] = targetRef.split(':');
  let value: unknown;
  if (key === 'ward') {
    const [c] = await tx.select({ wardId: candidates.wardId }).from(candidates).where(eq(candidates.id, Number(id)));
    value = c ?? null;
  } else {
    const [f] = await tx.select({ en: candidateFields.valueEn, kn: candidateFields.valueKn, data: candidateFields.valueData, unreadable: candidateFields.unreadable, notDeclared: candidateFields.notDeclared }).from(candidateFields).where(and(eq(candidateFields.candidateId, Number(id)), eq(candidateFields.fieldKey, key!)));
    value = f ?? null;
  }
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Public admission. Locks target and all reporter budgets before checking/inserting. */
export async function submitPublicFlag(who: FlagReporter, input: SubmitFlagInput): Promise<FlagResult> {
  const wardId = await deriveTargetWardId(input.targetType, input.targetRef);
  const fingerprint = reportFingerprint(input);
  return db.transaction(async tx => {
    await flagLock(tx, `target:${input.targetRef}`);
    await lockReporter(tx, who);
    const valueHash = await flagValueHash(tx, input.targetRef);
    const reviewed = await tx.execute(sql`select i.id from flag_items i join flag_submissions s on s.flag_item_id=i.id
      where i.target_ref=${input.targetRef} and i.status<>'pending' and i.resolved_at>now()-interval '7 days'
      and i.resolved_value_hash=${valueHash} and s.fingerprint=${fingerprint} limit 1`);
    if (reviewed.length) { await metric('duplicate', tx); return { state: 'already_reviewed' }; }
    const pending = await selectPending(tx, input.targetRef);
    if (pending) {
      const [prior] = await tx.select().from(flagSubmissions).where(and(eq(flagSubmissions.flagItemId,pending.id),
        or(and(eq(flagSubmissions.browserHash,who.browserHash), sql`${flagSubmissions.createdAt}>now()-interval '30 days'`), who.userId !== null ? eq(flagSubmissions.userId,who.userId) : sql`false`))).limit(1);
      if (prior) { await metric('duplicate', tx); return { state: prior.fingerprint === fingerprint ? 'duplicate' : 'already_reported', flagItemId: pending.id }; }
    }
    await checkFlagAllowance(tx, who);
    const id = pending?.id ?? await findOrCreatePendingItem(tx,input,wardId);
    await tx.insert(flagSubmissions).values({ flagItemId: id, userId: who.userId, browserHash: who.browserHash, fingerprint, detail: input.detail, suggestedValue: input.suggestedValue ?? null, sourceUrl: input.sourceUrl ?? null });
    await recordFlagAdmission(tx,who);
    return { state: 'accepted', flagItemId: id };
  });
}

/**
 * Resolves a queue item (curator/admin only). Both roles are
 * city-wide, so there is no per-ward check.
 *
 * ACCEPT: applies the fix — a structured field correction
 * ({@link publishAffidavitFields}, as a value a person checked) or a ward
 * move ({@link moveCandidateWard}) — and marks the item `accepted` in the
 * SAME transaction, so a correction can never land without its flag item
 * being marked resolved (or vice versa).
 *
 * REJECT: marks the item `rejected` with `reason`; never publishes
 * anything.
 *
 * Either way, resolving the ITEM resolves every collapsed submission at
 * once — the outcome/reason lives on `flag_items`, and every
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
  const translate = await db.transaction(async (tx) => {
    const [reference] = await tx.select({ targetRef: flagItems.targetRef }).from(flagItems).where(eq(flagItems.id, flagItemId));
    if (!reference) throw new Error('flag_already_resolved');
    await flagLock(tx, `target:${reference.targetRef}`);
    const [item] = await tx.select().from(flagItems).where(eq(flagItems.id, flagItemId)).for('update');

    if (!item || item.status !== 'pending') {
      throw new Error('flag_already_resolved');
    }

    if (resolution.accept) {
      const { fix } = resolution;
      let needsTranslation: number[] = [];
      if (fix.kind === 'field') {
        needsTranslation = await publishAffidavitFields(tx, actor, fix.candidateId, [fix.data], { sourceUrl: fix.sourceUrl, checked: true });
      } else {
        await moveCandidateWard(tx, fix.candidateId, fix.wardId, fix.sourceUrl);
      }

      await tx
        .update(flagItems)
        .set({ status: 'accepted', resolutionReason: null, resolvedBy: actor.userId, resolvedAt: new Date(), resolvedValueHash: await flagValueHash(tx, item.targetRef) })
        .where(and(eq(flagItems.id, flagItemId), eq(flagItems.status, 'pending')));

      return needsTranslation;
    }

    await tx
      .update(flagItems)
      .set({
        status: 'rejected',
        resolutionReason: resolution.reason,
        resolvedValueHash: await flagValueHash(tx, item.targetRef),
        resolvedBy: actor.userId,
        resolvedAt: new Date(),
      })
      .where(and(eq(flagItems.id, flagItemId), eq(flagItems.status, 'pending')));

    return [];
  });

  // Only once the transaction has committed: a rolled-back fix must not
  // start a translation for a value that was never written. A reject, a
  // ward move and a fix whose English text did not change hand back nothing.
  for (const fieldId of translate) translateFieldSoon({ table: 'candidate_fields', id: fieldId });
}

/** Spam moderation never changes candidate data and never closes others' active reports. */
export async function markFlagSpam(actor: { userId: number; role: 'curator' | 'admin' }, itemId: number, ids: number[], reason: string): Promise<void> {
  const selected = [...new Set(ids)];
  if (!selected.length || selected.length > 20 || selected.some(id => !Number.isSafeInteger(id) || id <= 0) || !reason.trim() || reason.length > 1000) throw new Error('invalid_spam_selection');
  await db.transaction(async tx => {
    const [reference] = await tx.select().from(flagItems).where(eq(flagItems.id,itemId));
    if (!reference) throw new Error('flag_already_resolved');
    await flagLock(tx, `target:${reference.targetRef}`);
    const [item] = await tx.select().from(flagItems).where(eq(flagItems.id,itemId)).for('update');
    if (item!.status !== 'pending') throw new Error('flag_already_resolved');
    const matches = await tx.select().from(flagSubmissions).where(and(eq(flagSubmissions.flagItemId,itemId),sql`${flagSubmissions.id} in (${sql.join(selected.map(id => sql`${id}`),sql`,`)})`));
    if (matches.length !== selected.length) throw new Error('invalid_spam_selection');
    const changed = matches.filter(s => !s.isSpam);
    for (const submission of changed) await tx.update(flagSubmissions).set({isSpam:true,moderatedBy:actor.userId,moderatedAt:new Date(),moderationReason:reason.trim()}).where(eq(flagSubmissions.id,submission.id));
    if (changed.length) await metric('spam',tx,changed.length);
    const [active] = await tx.select({ id:flagSubmissions.id }).from(flagSubmissions).where(and(eq(flagSubmissions.flagItemId,itemId),eq(flagSubmissions.isSpam,false))).limit(1);
    if (!active) await tx.update(flagItems).set({status:'rejected',resolutionReason:'spam',resolvedBy:actor.userId,resolvedAt:new Date(),resolvedValueHash:await flagValueHash(tx,item!.targetRef)}).where(eq(flagItems.id,itemId));
  });
}

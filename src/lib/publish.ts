import { and, eq } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { candidateFields, candidateStances, candidates, wardReadiness, type candidateStatusEnum } from '../db/schema';
import { translateFieldSoon } from './translate-runtime';

export type Actor = {
  userId: number | null;
  role: 'curator' | 'admin' | 'system' | 'citizen';
};

export type CandidateStatus = (typeof candidateStatusEnum.enumValues)[number];

export type PublishCandidateFieldInput = {
  candidateId: number;
  fieldKey: string;
  valueEn?: string | null;
  valueKn?: string | null;
  notDeclared?: boolean;
  sourceUrl: string | null;
  sourceType: 'official' | 'curator';
  authoredLang: 'en' | 'kn';
  aiExtracted?: boolean;
};

/**
 * MANUAL OVERRIDE + SOURCE-CHANGE REGENERATION (architecture §9) — the
 * publish-path half of the MT coordination (`src/lib/translate-runtime.ts`
 * owns the other half, the actual translate call). Every `candidate_fields`
 * / `candidate_stances` row carries BOTH `valueEn` and `valueKn`; exactly
 * one language is "authored" (`authoredLang`) and the other is normally
 * machine-generated. A publish call always supplies both columns' next
 * value (the curator's edit form round-trips both, pre-filled with the
 * current stored values — see `src/lib/curator.ts`), so the RULE this
 * function implements is a pure value-diff against what's already stored:
 *
 *   - No existing row (a brand-new field/stance): `'pending'` — a freshly
 *     authored value always needs MT. (If a creator happens to supply
 *     BOTH languages themselves on the very first publish, this still
 *     comes back `'pending'` and MT will overwrite the second language —
 *     a documented, untested-by-brief edge case: there is no reliable
 *     signal, on a brand-new row, to tell "coincidentally identical
 *     first value" apart from "deliberate day-one manual translation".)
 *   - The AUTHORED-language value changed (including a change of WHICH
 *     language is authored): `'pending'` — the source changed, so MT
 *     must regenerate. This is also how a stale `'manual'` override gets
 *     un-stuck: the curator's manual fix described the OLD source, and a
 *     new source value means that fix no longer describes the current
 *     text — the regenerated translation is expected to replace it.
 *   - The authored value is UNCHANGED but the OTHER-language value
 *     changed: `'manual'` — the curator hand-edited the translation
 *     directly (e.g. fixing an MT error in place); MT must not touch it
 *     again until the source changes.
 *   - Neither changed (an identical re-publish, or a field re-saved with
 *     no real edits): keep whatever status the row already had — this is
 *     not a "publish sets the other language" event.
 *
 * The two callers (`publishCandidateFieldTx`, `publishStance`) only fire
 * `translateFieldSoon` when this returns `'pending'` — a `'manual'` write
 * or a status-preserving no-op re-publish must NOT kick off a translation
 * attempt at all (not just rely on `translateFieldNow`'s own `'manual'`
 * short-circuit — the point is to not even start the async work).
 */
export function decideTranslationStatus(
  existing:
    | { valueEn: string | null; valueKn: string | null; authoredLang: 'en' | 'kn'; translationStatus: 'pending' | 'done' | 'manual' }
    | null
    | undefined,
  input: { valueEn?: string | null; valueKn?: string | null; authoredLang: 'en' | 'kn' },
): 'pending' | 'done' | 'manual' {
  if (!existing) return 'pending';

  const nextValueEn = input.valueEn === undefined ? existing.valueEn : input.valueEn;
  const nextValueKn = input.valueKn === undefined ? existing.valueKn : input.valueKn;

  const authoredChanged =
    input.authoredLang !== existing.authoredLang ||
    (input.authoredLang === 'en' ? nextValueEn !== existing.valueEn : nextValueKn !== existing.valueKn);
  if (authoredChanged) return 'pending';

  const otherChanged = input.authoredLang === 'en' ? nextValueKn !== existing.valueKn : nextValueEn !== existing.valueEn;
  if (otherChanged) return 'manual';

  return existing.translationStatus;
}

/**
 * Tx-accepting core of the publish path: upserts the candidate_fields row
 * using the CALLER's transaction handle, so a
 * caller that must publish a field atomically alongside other writes of its
 * own (Task 31's `resolveFlag` — publish the field AND mark the flag item
 * accepted in one transaction) can do so without nesting a second top-level
 * `db.transaction()`. Returns the field's id (candidate_fields.id); does NOT
 * kick off translation — that only happens once the whole transaction has
 * actually committed (see `publishCandidateField` below, and Task 31's
 * `resolveFlag` accept path), otherwise a rolled-back publish could still
 * enqueue a translation for a field that was never written.
 */
export async function publishCandidateFieldTx(
  tx: Tx,
  actor: Actor,
  input: PublishCandidateFieldInput,
): Promise<{ id: number; translationStatus: 'pending' | 'done' | 'manual' }> {
  const [existing] = await tx
    .select()
    .from(candidateFields)
    .where(and(eq(candidateFields.candidateId, input.candidateId), eq(candidateFields.fieldKey, input.fieldKey)));

  const [candidate] = await tx
    .select({ wardId: candidates.wardId })
    .from(candidates)
    .where(eq(candidates.id, input.candidateId));

  if (!candidate) {
    throw new Error(`publishCandidateField: no candidate with id ${input.candidateId}`);
  }

  // AI-extracted only sticks when the actor writing it is the system
  // (extraction pipeline). Any curator/admin publish is a human
  // confirmation of the value, so it always clears the flag.
  const aiExtracted = input.aiExtracted === true && actor.role === 'system';

  const translationStatus = decideTranslationStatus(existing, input);

  const [field] = await tx
    .insert(candidateFields)
    .values({
      candidateId: input.candidateId,
      fieldKey: input.fieldKey,
      valueEn: input.valueEn ?? null,
      valueKn: input.valueKn ?? null,
      notDeclared: input.notDeclared ?? false,
      authoredLang: input.authoredLang,
      translationStatus,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      aiExtracted,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [candidateFields.candidateId, candidateFields.fieldKey],
      set: {
        valueEn: input.valueEn ?? null,
        valueKn: input.valueKn ?? null,
        notDeclared: input.notDeclared ?? false,
        authoredLang: input.authoredLang,
        translationStatus,
        sourceUrl: input.sourceUrl,
        sourceType: input.sourceType,
        aiExtracted,
        updatedAt: new Date(),
      },
    })
    .returning({ id: candidateFields.id });

  return { id: field.id, translationStatus };
}

/**
 * The single publish path for candidate report-card fields. Upserts the
 * field in one transaction. After the transaction commits, kicks off
 * (fire-and-forget)
 * machine translation for the field — but ONLY when
 * {@link decideTranslationStatus} decided this publish is a `'pending'`
 * (authored-value / source) change. A `'manual'` write (the curator hand-
 * editing the OTHER language) or a status-preserving no-op re-publish must
 * NOT start a translation attempt at all (Task 40; architecture §9).
 *
 * Thin wrapper around {@link publishCandidateFieldTx}: opens its own
 * top-level transaction and hands the tx handle down. Kept as the public
 * entry point for every caller that does NOT need to coordinate this
 * publish with other writes of its own — behavior is identical to before
 * the Task 31 tx-refactor.
 */
export async function publishCandidateField(actor: Actor, input: PublishCandidateFieldInput): Promise<void> {
  const { id: fieldId, translationStatus } = await db.transaction((tx) => publishCandidateFieldTx(tx, actor, input));

  if (translationStatus === 'pending') {
    translateFieldSoon({ table: 'candidate_fields', id: fieldId });
  }
}

// ---------------------------------------------------------------------------
// Candidate core fields + lifecycle status (Task 36; architecture §6;
// PRD §5.2/§9.1) — name/party/photo/status, and the sign-off-clearing side
// effect of a "candidate-set change" (a status transition, or a brand-new
// candidate landing in a ward).
// ---------------------------------------------------------------------------

/**
 * Strips diacritics and anything non-ASCII-alphanumeric from `name`,
 * lowercases it, and collapses the rest to single hyphens — the "name-slug"
 * half of a candidate slug (IA §3.4). Never touches the ward-id prefix; the
 * caller composes the two.
 */
function slugifyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics after NFD decomposition
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Generates the candidate slug `{wardId}-{name-slug}` (IA §3.4: slugs are
 * unique CITY-WIDE, and the ward prefix is what keeps two same-named
 * candidates in different wards from colliding). Appends `-2`, `-3`, … on a
 * collision — e.g. two same-named candidates filed in the SAME ward.
 * Queried (and the eventual insert) inside the caller's transaction so the
 * uniqueness check and the insert that relies on it are atomic together.
 *
 * The slug is generated ONCE, at creation, and is never regenerated on a
 * later rename (`publishCandidateCore` never touches `slug`) — a stable
 * slug is load-bearing for anything that already links to
 * `/candidate/{slug}` before a name correction lands.
 */
async function generateUniqueSlug(tx: Tx, wardId: number, nameEn: string): Promise<string> {
  const base = `${wardId}-${slugifyName(nameEn)}`;
  let candidate = base;
  let suffix = 2;
  // Small, curator-driven write volume (never a hot path) — a simple
  // select-then-retry loop is preferable here to a cleverer single query,
  // and is still race-safe in practice: candidate creation is a trusted,
  // low-concurrency curator action, not a public high-contention path.
  for (;;) {
    const [existing] = await tx.select({ id: candidates.id }).from(candidates).where(eq(candidates.slug, candidate));
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

/**
 * Clears ward `wardId`'s sign-off (PRD §9.1: "sign-off clears on
 * candidate-set change"; architecture §6) — sets `signedOffAt = null`,
 * `clearedAt = now`, upserting the `ward_readiness` row if the ward has
 * never had one. Always runs
 * inside the CALLER's transaction, atomically with the candidate-set change
 * that triggered it — a status flip or a new candidate must never land
 * without this clear landing too.
 *
 * Idempotent: re-clearing an already-cleared (or never-signed-off) ward is
 * harmless — `clearedAt` simply advances to `now` and `signedOffAt` stays
 * null, so `src/lib/curator.ts`'s dashboard `clearedByChange` check (which
 * requires `signedOffAt` to have been non-null) correctly does not treat a
 * ward that was never signed off as "held by a clear".
 */
async function clearWardSignOff(tx: Tx, wardId: number): Promise<void> {
  const now = new Date();

  await tx
    .insert(wardReadiness)
    .values({ wardId, signedOffAt: null, clearedAt: now })
    .onConflictDoUpdate({ target: wardReadiness.wardId, set: { signedOffAt: null, clearedAt: now } });

}

export type PublishCandidateCoreInput = {
  candidateId: number;
  nameEn?: string;
  nameKn?: string | null;
  partyEn?: string;
  partyKn?: string | null;
  photoMediaId?: number | null;
  status?: CandidateStatus;
};

/**
 * Updates a candidate's core (non-report-card) fields — name, party, photo,
 * lifecycle status in one transaction. Any field
 * left `undefined` is left unchanged; pass `null` for `nameKn`/`partyKn`/
 * `photoMediaId` to explicitly clear them.
 *
 * CANDIDATE-SET CHANGE: a STATUS transition (the new `status`, when given,
 * differs from the stored one) is exactly the "candidate-set change" this
 * function can produce (a new candidate is the other one — see
 * {@link createCandidate}), so it clears the ward's sign-off in the SAME
 * transaction as the status write (architecture §6, PRD §9.1). A core edit
 * that does NOT touch status (e.g. just correcting a spelling) is not a
 * candidate-set change and leaves sign-off untouched.
 */
export async function publishCandidateCore(_actor: Actor, input: PublishCandidateCoreInput): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(candidates).where(eq(candidates.id, input.candidateId));
    if (!existing) {
      throw new Error(`publishCandidateCore: no candidate with id ${input.candidateId}`);
    }

    const next = {
      nameEn: input.nameEn ?? existing.nameEn,
      nameKn: input.nameKn === undefined ? existing.nameKn : input.nameKn,
      partyEn: input.partyEn ?? existing.partyEn,
      partyKn: input.partyKn === undefined ? existing.partyKn : input.partyKn,
      photoMediaId: input.photoMediaId === undefined ? existing.photoMediaId : input.photoMediaId,
      status: input.status ?? existing.status,
      updatedAt: new Date(),
    };

    await tx.update(candidates).set(next).where(eq(candidates.id, input.candidateId));

    const statusChanged = input.status !== undefined && input.status !== existing.status;
    if (statusChanged) {
      await clearWardSignOff(tx, existing.wardId);
    }
  });
}

export type CreateCandidateInput = {
  wardId: number;
  nameEn: string;
  partyEn: string;
  nameKn?: string | null;
  partyKn?: string | null;
  photoMediaId?: number | null;
};

/**
 * Creates a brand-new candidate row — a new filing is itself a
 * "candidate-set change" (architecture §6, PRD §9.1), so this ALWAYS clears
 * the ward's sign-off, in the same transaction as the insert. Status is
 * always the schema default (`'filed'`) — lifecycle transitions happen
 * afterwards via {@link publishCandidateCore}. See {@link generateUniqueSlug}
 * for the slug scheme.
 */
export async function createCandidate(
  _actor: Actor,
  input: CreateCandidateInput,
): Promise<{ id: number; slug: string }> {
  return db.transaction(async (tx) => {
    const slug = await generateUniqueSlug(tx, input.wardId, input.nameEn);

    const [row] = await tx
      .insert(candidates)
      .values({
        slug,
        wardId: input.wardId,
        nameEn: input.nameEn,
        nameKn: input.nameKn ?? null,
        partyEn: input.partyEn,
        partyKn: input.partyKn ?? null,
        photoMediaId: input.photoMediaId ?? null,
      })
      .returning({ id: candidates.id });

    const id = row!.id;

    await clearWardSignOff(tx, input.wardId);

    return { id, slug };
  });
}

// ---------------------------------------------------------------------------
// Candidate stances on ward issues (IA §5.4) — per-issue candidate positions.
// ---------------------------------------------------------------------------

export type PublishStanceInput = {
  wardIssueId: number;
  candidateId: number;
  valueEn?: string | null;
  valueKn?: string | null;
  sourceUrl: string | null;
  sourceType: 'official' | 'curator';
  authoredLang: 'en' | 'kn';
};

/**
 * Upserts a candidate's stance on a ward issue atomically; kicks
 * off translation after commit — but only when {@link decideTranslationStatus}
 * (the same manual-override / source-change-regeneration rule
 * {@link publishCandidateField} uses) decides this publish is a `'pending'`
 * change, not a `'manual'` translation edit or a no-op re-publish (Task 40;
 * architecture §9).
 */
export async function publishStance(_actor: Actor, input: PublishStanceInput): Promise<void> {
  const { id: stanceId, translationStatus } = await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ wardId: candidates.wardId })
      .from(candidates)
      .where(eq(candidates.id, input.candidateId));
    if (!candidate) {
      throw new Error(`publishStance: no candidate with id ${input.candidateId}`);
    }

    const [existing] = await tx
      .select()
      .from(candidateStances)
      .where(and(eq(candidateStances.wardIssueId, input.wardIssueId), eq(candidateStances.candidateId, input.candidateId)));

    const translationStatus = decideTranslationStatus(existing, input);

    const newValue = {
      valueEn: input.valueEn ?? null,
      valueKn: input.valueKn ?? null,
      authoredLang: input.authoredLang,
      translationStatus,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
    };

    const [row] = await tx
      .insert(candidateStances)
      .values({
        wardIssueId: input.wardIssueId,
        candidateId: input.candidateId,
        ...newValue,
      })
      .onConflictDoUpdate({
        target: [candidateStances.wardIssueId, candidateStances.candidateId],
        set: newValue,
      })
      .returning({ id: candidateStances.id });

    return { id: row!.id, translationStatus };
  });

  if (translationStatus === 'pending') {
    translateFieldSoon({ table: 'candidate_stances', id: stanceId });
  }
}

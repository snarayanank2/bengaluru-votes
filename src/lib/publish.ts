import { eq } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { candidateFields, candidates, type candidateStatusEnum } from '../db/schema';
import { translateFieldSoon } from './translate-runtime';

export type Actor = {
  userId: number | null;
  role: 'curator' | 'admin' | 'system' | 'citizen' | 'transcriber';
};

export type CandidateStatus = (typeof candidateStatusEnum.enumValues)[number];

/**
 * MANUAL OVERRIDE + SOURCE-CHANGE REGENERATION (architecture §9) — the
 * publish-path half of the MT coordination (`src/lib/translate-runtime.ts`
 * owns the other half, the actual translate call). Every `candidate_fields`
 * row carries BOTH `valueEn` and `valueKn`; exactly
 * one language is "authored" (`authoredLang`) and the other is normally
 * machine-generated. A publish call always supplies both columns' next
 * value, so the RULE this
 * function implements is a pure value-diff against what's already stored:
 *
 *   - No existing row (a brand-new field): `'pending'` — a freshly
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
 * The caller (`publishAffidavitFields`) only fires
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

// ---------------------------------------------------------------------------
// Candidate core fields + lifecycle status (Task 36; architecture §6)
// — name/party/status.
// ---------------------------------------------------------------------------

/**
 * Strips diacritics and anything non-ASCII-alphanumeric from `name`,
 * lowercases it, and collapses the rest to single hyphens — the "name-slug"
 * half of a candidate slug. Never touches the ward-id prefix; the
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
 * Generates the candidate slug `{wardId}-{name-slug}` (slugs are
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

/** Lifecycle status is the only editable property outside report-card fields. */
export type PublishCandidateCoreInput = {
  candidateId: number;
  status: CandidateStatus;
};

export async function publishCandidateCore(_actor: Actor, input: PublishCandidateCoreInput): Promise<void> {
  const [row] = await db.update(candidates)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(candidates.id, input.candidateId))
    .returning({ id: candidates.id });
  if (!row) throw new Error(`publishCandidateCore: no candidate with id ${input.candidateId}`);
}

export type CreateCandidateInput = {
  wardId: number;
  nameEn: string;
  partyEn: string;
};

/**
 * Creates a brand-new candidate row. Status is
 * always the schema default (`'filed'`) — lifecycle transitions happen
 * afterwards via {@link publishCandidateCore}. See {@link generateUniqueSlug}
 * for the slug scheme.
 */
export async function createCandidate(
  _actor: Actor,
  input: CreateCandidateInput,
): Promise<{ id: number; slug: string }> {
  const result = await db.transaction((tx) => createCandidateTx(tx, input));
  const fields = await db.select({ id: candidateFields.id }).from(candidateFields)
    .where(eq(candidateFields.candidateId, result.id));
  for (const field of fields) translateFieldSoon({ table: 'candidate_fields', id: field.id });
  return result;
}

/** {@link createCandidate} inside the caller's transaction, for callers that create a candidate and publish onto it together. */
export async function createCandidateTx(tx: Tx, input: CreateCandidateInput): Promise<{ id: number; slug: string }> {
  const slug = await generateUniqueSlug(tx, input.wardId, input.nameEn);

  const [row] = await tx
    .insert(candidates)
    .values({
      slug,
      wardId: input.wardId,
      nameEn: input.nameEn,
      partyEn: input.partyEn,
    })
    .returning({ id: candidates.id });

  // Bootstrap the same report-card rows that extraction and human review update.
  // Creating a record is not an affidavit check: leave the check markers empty.
  await tx.insert(candidateFields).values([
    { candidateId: row!.id, fieldKey: 'full_name', valueEn: input.nameEn,
      valueData: { key: 'full_name', status: 'value', text: input.nameEn } },
    { candidateId: row!.id, fieldKey: 'party', valueEn: input.partyEn,
      valueData: { key: 'party', status: 'value', text: input.partyEn } },
  ]);
  return { id: row!.id, slug };
}

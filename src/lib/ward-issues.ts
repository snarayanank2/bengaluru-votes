/**
 * Curator ward-issues editor engine (Task 39; PRD §5.4/§5.5;
 * information-architecture.md §5.5-equivalent). A ward's issues are the
 * fixed candidate-stance topics AND the citizen "top 3" vote options
 * (`/ward/{id}/issues`) — the curator fully owns this list (add, retitle,
 * retire), in any ward.
 *
 * VOTE SEMANTICS — the two operations differ deliberately:
 *   - RENAME updates `title_en` on the EXISTING row (same `id`). Every
 *     `issue_vote_selections` row referencing that id (a citizen's cast
 *     vote) is untouched — a retitle never loses votes (PRD §5.5).
 *   - REMOVE deletes the `ward_issues` row outright. Its own
 *     `issue_vote_selections` rows FK-cascade away (schema.ts:
 *     `onDelete: 'cascade'`), but any OTHER selection in the same vote set
 *     (for an issue that was NOT removed) is a separate row and survives —
 *     "delete cascades selections, remaining selections stand" (PRD §5.5).
 *     `candidate_stances` for the removed issue cascade away the same way.
 *
 * TITLE INPUT: only `titleEn` is ever written here — a curator authors in
 * English; `titleKn`/`translationStatus` follow the same MT convention as
 * `candidate_fields` (src/lib/publish.ts): `translationStatus` is set to
 * 'pending' and `translateFieldSoon` is kicked off after commit. A RENAME
 * deliberately does NOT null the existing `titleKn` — it stays visible
 * (now stale) until MT (Task 40) overwrites it, rather than the ward's
 * Kannada issue list going blank for the gap between rename and retranslation.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { wardIssues } from '../db/schema';
import { translateFieldSoon } from './translate-runtime';

/** Curators and admins are both city-wide; requiring this actor type is what keeps these mutators off any citizen code path. */
export type CuratorActor = { userId: number; role: 'curator' | 'admin' };

export interface WardIssueRow {
  id: number;
  titleEn: string | null;
  titleKn: string | null;
  position: number;
}

/** The ward's issues, ordered for display (IA: position order) — used by both the curator editor and, indirectly, the public `/ward/{id}/issues` page's own query. */
export async function listWardIssues(wardId: number): Promise<WardIssueRow[]> {
  return db
    .select({ id: wardIssues.id, titleEn: wardIssues.titleEn, titleKn: wardIssues.titleKn, position: wardIssues.position })
    .from(wardIssues)
    .where(eq(wardIssues.wardId, wardId))
    .orderBy(wardIssues.position);
}

/**
 * Adds a new issue to `wardId`. `position` is
 * `max(existing positions) + 1` (0 for the ward's first issue) — new
 * issues land at the end of the list. `authoredLang` is always `'en'` (the
 * curator's own input language for this form); `translationStatus` starts
 * `'pending'`, and translation is kicked off (fire-and-forget) once the
 * insert has committed.
 */
export async function addWardIssue(_actor: CuratorActor, wardId: number, titleEn: string): Promise<{ id: number }> {
  const id = await db.transaction(async (tx) => {
    const [maxRow] = await tx
      .select({ max: sql<number>`coalesce(max(${wardIssues.position}), -1)` })
      .from(wardIssues)
      .where(eq(wardIssues.wardId, wardId));
    const position = Number(maxRow?.max ?? -1) + 1;

    const [row] = await tx
      .insert(wardIssues)
      .values({ wardId, titleEn, titleKn: null, authoredLang: 'en', translationStatus: 'pending', position })
      .returning({ id: wardIssues.id });

    return row!.id;
  });

  translateFieldSoon({ table: 'ward_issues', id });
  return { id };
}

/**
 * Renames issue `issueId` (see module docstring for the vote-preservation
 * rationale). Throws `Error('not_found')` for an unknown id.
 */
export async function renameWardIssue(_actor: CuratorActor, issueId: number, titleEn: string): Promise<void> {
  const [existing] = await db.select().from(wardIssues).where(eq(wardIssues.id, issueId));
  if (!existing) {
    throw new Error('not_found');
  }

  await db.transaction(async (tx) => {
    await tx.update(wardIssues).set({ titleEn, translationStatus: 'pending' }).where(eq(wardIssues.id, issueId));

  });

  translateFieldSoon({ table: 'ward_issues', id: issueId });
}

/**
 * Removes issue `issueId` outright (see module docstring for the cascade
 * behavior). Throws `Error('not_found')` for an unknown id.
 */
export async function removeWardIssue(_actor: CuratorActor, issueId: number): Promise<void> {
  const [existing] = await db.select().from(wardIssues).where(eq(wardIssues.id, issueId));
  if (!existing) {
    throw new Error('not_found');
  }

  await db.transaction(async (tx) => {
    await tx.delete(wardIssues).where(eq(wardIssues.id, issueId));

  });
}

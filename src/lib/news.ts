/**
 * Candidate news links (Task 38; PRD §5.2 "News & coverage"; architecture
 * §7) — curator-compiled news coverage for a candidate's report card.
 *
 * TWO ORIGINS, TWO LIFECYCLES (schema: `candidate_news_links.origin` /
 * `.status`):
 *   - `origin: 'curator'` — a curator pastes a url+title directly
 *     (`addNewsLink` below). Landing here IS the curator's deliberate,
 *     accountable act of adding the link, so it inserts already
 *     `status: 'approved'`, `approvedBy` set to the adding curator — there
 *     is no separate approval step for a curator's own addition.
 *   - `origin: 'auto'` — the platform's own news-query suggestion pipeline
 *     (Task 55 — NOT implemented here; this module only provides the
 *     add/approve/list surface it and the curator editor use) inserts rows
 *     `status: 'suggested'`. PRD §5.2 is explicit: "NOTHING publishes
 *     unapproved" — an auto-suggested link is visible ONLY on the curator
 *     editor (`/curator/candidate/{id}`) until a curator calls
 *     `approveNewsLink` on it.
 *
 * THE PUBLIC GUARD lives in `listNewsLinks`'s `approvedOnly` query filter,
 * not in caller discipline: `listNewsLinks(id, { approvedOnly: true })`
 * (what Task 42's public report card calls) structurally cannot return a
 * `suggested` row, no matter what origin it came from. See that function's
 * docstring.
 *
 * APPROVAL IS THE ACCOUNTABILITY POINT for an auto-suggested link (PRD
 * §5.2's "accountability stays with the curator"): `approveNewsLink` is a
 * curator approval — it flips `status` to `approved` and stamps `approvedBy`.
 *
 * WRITE-TIME http(s) VALIDATION (architecture §7/§13): `addNewsLink`
 * re-validates the URL itself rather than trusting its caller — the
 * curator editor's route handler (`src/lib/curator.ts`'s
 * `handleNewsLinkAdd`) pre-validates too, for a nicer inline error, but
 * this module's own check is what actually protects the row from ever
 * holding a `javascript:`/`data:`/etc. URL, including from any future
 * caller that forgets to check.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { candidateNewsLinks, candidates, type newsOriginEnum, type newsStatusEnum } from '../db/schema';
import { isUniqueViolation } from './db-errors';

export type NewsLinkOrigin = (typeof newsOriginEnum.enumValues)[number];
export type NewsLinkStatus = (typeof newsStatusEnum.enumValues)[number];

/** Same shape `src/lib/curator.ts`'s `CuratorActor` uses for every curator/admin write action. */
export type NewsLinkActor = { userId: number; role: 'curator' | 'admin' };

export interface NewsLink {
  id: number;
  candidateId: number;
  url: string;
  title: string;
  domain: string;
  origin: NewsLinkOrigin;
  status: NewsLinkStatus;
  approvedBy: number | null;
  createdAt: Date;
}

/**
 * Same http(s)-only rule as `src/lib/curator.ts`'s and
 * `src/pages/api/flags.ts`'s local `isHttpUrl` — kept as its own small copy
 * here (matching the existing per-module convention: neither of those two
 * exports theirs either) rather than introducing a shared export this task
 * wasn't asked to create.
 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Adds a news link for `candidateId`, curator-added (`origin: 'curator'`),
 * landing directly at `status: 'approved'` with `approvedBy` set to the
 * adding curator — see module docstring for why a curator-added link
 * skips the suggested state entirely.
 *
 * Throws (nothing is written in any of these cases):
 *   - `'invalid_url'` — `url` doesn't parse as an absolute `http:`/`https:`
 *     URL (write-time validation — architecture §7/§13).
 *   - `'title_required'` — `title` is empty/whitespace-only.
 *   - `'candidate_not_found'` — no such candidate.
 *   - `'duplicate_url'` — a `candidate_news_links` row already exists for
 *     `(candidateId, url)` (schema's `news_link_uq` unique index — e.g.
 *     this exact URL was already curator-added, or was auto-suggested and
 *     is sitting `suggested` or already `approved`). This function does
 *     NOT silently return the existing row, and does NOT auto-approve a
 *     matching suggestion — it throws, and the caller (the curator
 *     editor's add-link form, `handleNewsLinkAdd`) surfaces a
 *     "this link is already on this candidate" error. A matching
 *     `suggested` row is still reachable — and approvable — via this same
 *     page's suggested-links list (`listNewsLinks`'s default view).
 *
 * A curator-added link never passes through the separate approval step an
 * auto-suggestion does.
 */
export async function addNewsLink(
  actor: NewsLinkActor,
  candidateId: number,
  url: string,
  title: string,
): Promise<{ id: number }> {
  if (!isHttpUrl(url)) {
    throw new Error('invalid_url');
  }
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new Error('title_required');
  }

  const domain = new URL(url).hostname;

  return db.transaction(async (tx) => {
    const [candidate] = await tx.select({ wardId: candidates.wardId }).from(candidates).where(eq(candidates.id, candidateId));
    if (!candidate) {
      throw new Error('candidate_not_found');
    }

    let inserted: { id: number } | undefined;
    try {
      [inserted] = await tx
        .insert(candidateNewsLinks)
        .values({
          candidateId,
          url,
          title: trimmedTitle,
          domain,
          origin: 'curator',
          status: 'approved',
          approvedBy: actor.userId,
        })
        .returning({ id: candidateNewsLinks.id });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error('duplicate_url');
      }
      throw err;
    }

    return { id: inserted!.id };
  });
}

/**
 * Approves a `suggested` news link (normally auto-suggested by Task 55's
 * pipeline, but works on any suggested row regardless of origin) — flips
 * `status` to `'approved'` and sets `approvedBy` to the approving curator.
 * THIS is the accountability point PRD §5.2 means by "accountability
 * stays with the curator" for an auto-suggested link: a normal
 * curator approval, identical in spirit to any other curator edit.
 *
 * IDEMPOTENT on an already-approved link: re-approving is a silent no-op
 * (no write and no error) — unlike `flags.ts`'s `resolveFlag` (where
 * accept-vs-reject are mutually exclusive outcomes worth guarding a
 * double-resolve against), approving an already-approved link twice can't
 * produce a conflicting result, so there is nothing to protect against by
 * throwing here. Throws `'news_link_not_found'` if `linkId` doesn't exist.
 *
 * SCOPE: does NOT itself check curator ward-scope — it trusts the caller
 * to have already done so (same convention as `flags.ts`'s `resolveFlag`,
 * `publish.ts`'s `publishCandidateFieldTx`, etc. — see their docstrings).
 * The curator editor route enforces this two ways: (1) the whole
 * `/curator/candidate/{id}` page 403s upfront if the signed-in curator
 * isn't scoped to the CANDIDATE'S ward, and (2)
 * `src/lib/curator.ts`'s `handleNewsLinkApprove` re-checks that the
 * posted `linkId` actually belongs to the candidate on that page before
 * calling this — otherwise a curator could scope-hop by posting an
 * out-of-scope candidate's `linkId` alongside an in-scope candidate's URL.
 */
export async function approveNewsLink(actor: NewsLinkActor, linkId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(candidateNewsLinks).where(eq(candidateNewsLinks.id, linkId)).for('update');
    if (!existing) {
      throw new Error('news_link_not_found');
    }
    if (existing.status === 'approved') {
      return; // idempotent no-op — see docstring
    }

    await tx
      .update(candidateNewsLinks)
      .set({ status: 'approved', approvedBy: actor.userId })
      .where(eq(candidateNewsLinks.id, linkId));

  });
}

/**
 * Lists a candidate's news links.
 *
 * `opts.approvedOnly: true` — `status = 'approved'` ONLY. THIS IS THE
 * PUBLIC GUARD (Task 42's public report card calls this): a `suggested`
 * row (whatever its origin) structurally cannot be returned here, so no
 * public page can surface an unapproved suggestion even if it forgot to
 * filter itself — the filtering lives in the query, not in caller
 * discipline.
 *
 * Default (no `opts`, or `approvedOnly` falsy) — EVERY link, suggested
 * and approved alike. This is the curator-editor view
 * (`/curator/candidate/{id}`): a curator needs to see suggested links in
 * order to decide whether to approve them.
 *
 * Newest first (`createdAt` desc) — same convention as
 * `src/lib/curator.ts`'s `loadCandidateForEdit` affidavit list.
 */
export async function listNewsLinks(candidateId: number, opts?: { approvedOnly?: boolean }): Promise<NewsLink[]> {
  const approvedOnly = opts?.approvedOnly === true;
  const whereClause = approvedOnly
    ? and(eq(candidateNewsLinks.candidateId, candidateId), eq(candidateNewsLinks.status, 'approved'))
    : eq(candidateNewsLinks.candidateId, candidateId);

  return db.select().from(candidateNewsLinks).where(whereClause).orderBy(desc(candidateNewsLinks.createdAt));
}

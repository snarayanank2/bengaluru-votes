/**
 * Business logic behind `/admin/users` (Task 45, information-architecture.md
 * §6.3; PRD §5.16, §4/§7) — moderation (ban/reactivate) and the DPDP
 * data-principal ERASURE routine (architecture.md §7 "Erasure (DPDP
 * data-principal rights)").
 *
 * ============================================================================
 * ERASURE SEVERS IDENTITY, AGGREGATES SURVIVE — read before changing eraseUser
 * ============================================================================
 * Architecture §7: an admin-triggered deletion request removes OTP,
 * session, contact, and consent data, then leaves the `users` row as an
 * opaque tombstone so issue-vote aggregates and flag submissions retain
 * referential integrity without a path back to the person.
 *
 * DELETED (this user's rows only, in the SAME transaction as everything
 * else below): `otp_codes` — both by `userId` (the `add_contact` purpose,
 * which stores it) AND by `destination` matching this user's CURRENT
 * email/phone (the `auth` purpose has no `userId` column at all — it's
 * looked up by contact address, src/lib/otp.ts) — captured BEFORE the
 * `users` row is nulled below, or there would be nothing left to match on;
 * `sessions` — every row for this `userId`.
 *
 * NULLED on the `users` row itself (contact + consent + attribution —
 * exactly what architecture §7 calls "contact data and consent records",
 * nothing more): `email`, `phone`, `srcAttribution`, `consentAt`,
 * `consentVersion`, `futureToolsOptIn` (reset to `false`, its default — a
 * preference tied to the now-deleted consent event, not an independent
 * fact worth keeping). `status` becomes `'erased'`. `emailEnabled`/
 * `whatsappEnabled` are left untouched — inert once both contacts are
 * null, not worth a special-case write.
 *
 * KEPT, deliberately: `homeWardId` — NOT contact data (architecture §7's
 * list is OTP/session/contact/consent, and a ward id names a place, not a
 * person), and keeping it is what makes the retired `issue_vote_sets` row
 * still mean something as a WARD-level aggregate after erasure. `role` —
 * an admin/curator target's role field itself is untouched by erasure
 * (see the LAST-ADMIN GUARD below for why erasing an active admin is
 * still guarded the same as banning one). `issue_vote_sets`/
 * `issue_vote_selections` and `flag_submissions` are never touched here;
 * their `userId` still points at the now-opaque row id, which is the point
 * of a tombstone rather than a hard delete.
 *
 * IDEMPOTENT BY CONSTRUCTION, not by a special-cased early return: every
 * write above (null a column that's already null, delete rows that are
 * already gone, set `status` to the value it already has) is naturally a
 * no-op the second time, so calling `eraseUser` again on an already-erased
 * row does not throw or corrupt anything.
 *
 * LAST-ADMIN / SELF GUARDS (mirrors src/lib/admin.ts's
 * `assertNotSelfOrLastAdmin`, distinct error codes per this task's brief):
 * an admin can never ban or erase THEIR OWN id (`cannot_ban_self` /
 * `cannot_erase_self`, checked unconditionally, first), and can never ban
 * or erase the last remaining ACTIVE admin (`cannot_ban_last_admin` /
 * `cannot_erase_last_admin`, checked only when the target IS an active
 * admin — see `assertNotLastActiveAdmin`). Reactivate never demotes
 * anyone, so it carries no such guard.
 *
 * BAN vs ERASE, ordering: erasure is the terminal state — `banUser`
 * explicitly REJECTS (`cannot_ban_erased`) rather than flipping an opaque
 * tombstone's `status` back to `'banned'`, which would be a step backward
 * (a banned account is still a real, nameable person; an erased one no
 * longer is). `reactivateUser` similarly rejects `'erased'`
 * (`cannot_reactivate_erased`) — only a banned account can be restored.
 *
 * SESSIONS ARE DELETED, NOT JUST STATUS-GATED: `readSession`
 * (src/lib/session.ts) already returns `null` for any non-`'active'` user,
 * so a banned/erased user's OLD session cookie stops working on its own.
 * Both `banUser` and `eraseUser` still hard-delete the `sessions` rows —
 * belt and braces, and it closes a real gap: `resolveOrRegister`
 * (src/lib/auth-flow.ts) resolves a KNOWN contact to a session WITHOUT
 * checking `status` (see that module — out of scope for this task to
 * change, flagged in the Task 45 report), so a banned user's contact could
 * still mint a FRESH session row via OTP verify after being banned. That
 * new session is still useless (`readSession` blocks it regardless of
 * when it was created), but deleting on every ban call, not just once, is
 * what actually removes the row rather than leaving a dead one behind.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { flagSubmissions, otpCodes, sessions, users, wards } from '../db/schema';

/** Same actor shape src/lib/admin.ts's `AdminActor` uses — every mutator below re-asserts `role === 'admin'` itself (defense in depth, see that module's docstring for the full rationale). */
export type AdminActor = { userId: number; role: 'admin' };

function assertAdmin(actor: { role: string }): void {
  if (actor.role !== 'admin') {
    throw new Error('admin_only');
  }
}

type ExistingUser = { role: string; status: string; email: string | null; phone: string | null };

/** Unconditional — an admin must never ban/erase their OWN id, regardless of role/status of anyone involved. */
function assertNotSelf(actor: AdminActor, targetUserId: number, actionVerb: 'ban' | 'erase'): void {
  if (targetUserId === actor.userId) {
    throw new Error(`cannot_${actionVerb}_self`);
  }
}

/**
 * Mirrors src/lib/admin.ts's `assertNotSelfOrLastAdmin` last-admin count
 * (same query, same transaction-scoped read), split out here so it can be
 * called with this module's own `ban`/`erase` error codes instead of that
 * module's `revoke` codes. Only fires when `existing` (the target's
 * CURRENT row, read in the SAME transaction as the caller's subsequent
 * write) is an active admin — a banned/erased/citizen/curator target never
 * trips this.
 */
async function assertNotLastActiveAdmin(tx: Tx, existing: ExistingUser, actionVerb: 'ban' | 'erase'): Promise<void> {
  if (existing.role === 'admin' && existing.status === 'active') {
    const [activeAdmins] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
    if (Number(activeAdmins?.count ?? 0) <= 1) {
      throw new Error(`cannot_${actionVerb}_last_admin`);
    }
  }
}

/**
 * DPDP erasure (architecture.md §7, PRD §5.16). See module docstring for
 * exactly what's deleted, nulled, and kept, plus the idempotency argument.
 * Throws `'user_not_found'`, `'cannot_erase_self'`, or
 * `'cannot_erase_last_admin'` before writing anything.
 */
export async function eraseUser(actor: AdminActor, targetUserId: number): Promise<void> {
  assertAdmin(actor);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ role: users.role, status: users.status, email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.id, targetUserId));
    if (!existing) {
      throw new Error('user_not_found');
    }

    assertNotSelf(actor, targetUserId, 'erase');
    await assertNotLastActiveAdmin(tx, existing, 'erase');

    // Captured BEFORE the users row is nulled below — the 'auth' purpose
    // otp_codes row has no userId at all (src/lib/otp.ts), only a
    // destination, so this is the only way to find it once email/phone go
    // null. 'add_contact' purpose rows DO carry userId, covered separately.
    const destinations = [existing.email, existing.phone].filter((d): d is string => d !== null);
    if (destinations.length > 0) {
      await tx.delete(otpCodes).where(inArray(otpCodes.destination, destinations));
    }
    await tx.delete(otpCodes).where(eq(otpCodes.userId, targetUserId));
    await tx.delete(sessions).where(eq(sessions.userId, targetUserId));

    await tx
      .update(users)
      .set({
        email: null,
        phone: null,
        srcAttribution: null,
        consentAt: null,
        consentVersion: null,
        futureToolsOptIn: false,
        status: 'erased',
      })
      .where(eq(users.id, targetUserId));

  });
}

/**
 * Deactivates/bans a citizen (PRD §4/§7 "admin can deactivate/ban abusive
 * users"). Kills every active session for the user immediately (see module
 * docstring's SESSIONS ARE DELETED note) and rejects an already-erased
 * target (`'cannot_ban_erased'` — erasure is terminal, never re-bannable).
 * `reason`, if given, is accepted for caller compatibility but is not stored.
 */
export async function banUser(actor: AdminActor, targetUserId: number, _reason?: string): Promise<void> {
  assertAdmin(actor);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ role: users.role, status: users.status, email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.id, targetUserId));
    if (!existing) {
      throw new Error('user_not_found');
    }

    assertNotSelf(actor, targetUserId, 'ban');
    if (existing.status === 'erased') {
      throw new Error('cannot_ban_erased');
    }
    await assertNotLastActiveAdmin(tx, existing, 'ban');

    await tx.update(users).set({ status: 'banned' }).where(eq(users.id, targetUserId));
    await tx.delete(sessions).where(eq(sessions.userId, targetUserId));

  });
}

/**
 * Restores a banned account to `'active'`. Rejects `'cannot_reactivate_
 * erased'` for an erased target — an opaque tombstone can never be
 * un-erased (module docstring's BAN vs ERASE note); no self/last-admin
 * guard needed since reactivation only ever restores, never removes,
 * access.
 */
export async function reactivateUser(actor: AdminActor, targetUserId: number): Promise<void> {
  assertAdmin(actor);

  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ status: users.status }).from(users).where(eq(users.id, targetUserId));
    if (!existing) {
      throw new Error('user_not_found');
    }
    if (existing.status === 'erased') {
      throw new Error('cannot_reactivate_erased');
    }

    await tx.update(users).set({ status: 'active' }).where(eq(users.id, targetUserId));

  });
}

export interface UserSearchRow {
  id: number;
  email: string | null;
  phone: string | null;
  status: string;
  role: string;
  homeWardId: number | null;
  homeWardNameEn: string | null;
  flagSubmissionCount: number;
}

/**
 * The `/admin/users` search box (IA §6.3 "search users"): matches ANY of —
 * `id` exactly (only tried when `query` is a bare integer; a numeric
 * STRING can just as easily be a phone-number substring, e.g. "99887", so
 * this is unioned with the substring checks below rather than exclusively
 * branching on "looks numeric" — an admin typing digits gets every row
 * that could plausibly mean, not a silently-chosen interpretation), OR a
 * case-insensitive substring of `email`, OR a case-insensitive substring
 * of `phone`. An empty/whitespace-only query returns `[]` rather than
 * dumping every user — the admin must type something (same non-disclosure
 * -by-omission spirit as `findUserIdByLookup` in src/lib/admin.ts, though
 * this returns rows, not a single id). Each row includes its
 * `flag_submissions` count (IA §6.3 "view submission history") — a count
 * only; the full list lives via the flags tooling, not duplicated
 * here.
 */
export async function searchUsers(queryRaw: string): Promise<UserSearchRow[]> {
  const query = queryRaw.trim();
  if (!query) return [];

  // Escape ilike wildcards: backslash must be escaped first, then % and _
  const escapedQuery = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const pattern = `%${escapedQuery}%`;

  const conditions = [
    sql`${users.email} ILIKE ${pattern} ESCAPE '\\'`,
    sql`${users.phone} ILIKE ${pattern} ESCAPE '\\'`,
  ];
  if (/^\d+$/.test(query)) {
    conditions.push(eq(users.id, Number(query)));
  }

  const matchRows = await db
    .select({
      id: users.id,
      email: users.email,
      phone: users.phone,
      status: users.status,
      role: users.role,
      homeWardId: users.homeWardId,
      homeWardNameEn: wards.nameEn,
    })
    .from(users)
    .leftJoin(wards, eq(wards.id, users.homeWardId))
    .where(or(...conditions))
    .orderBy(users.id)
    .limit(50);

  if (matchRows.length === 0) return [];

  const ids = matchRows.map((r) => r.id);
  const flagCounts = await db
    .select({ userId: flagSubmissions.userId, count: sql<number>`count(*)::int` })
    .from(flagSubmissions)
    .where(inArray(flagSubmissions.userId, ids))
    .groupBy(flagSubmissions.userId);
  const countByUser = new Map(flagCounts.map((f) => [f.userId, Number(f.count)]));

  return matchRows.map((row) => ({ ...row, flagSubmissionCount: countByUser.get(row.id) ?? 0 }));
}

/**
 * Business logic behind `/admin/users` (Task 45) — moderation (ban/reactivate) and the DPDP
 * data-principal ERASURE routine (architecture.md §7 "Erasure (DPDP
 * data-principal rights)").
 *
 * ============================================================================
 * ERASURE SEVERS IDENTITY, AGGREGATES SURVIVE — read before changing eraseUser
 * ============================================================================
 * Architecture §7: an admin-triggered deletion request removes session and
 * contact data, then leaves the `users` row as an opaque tombstone so the
 * staff work it is credited with (transcription assignments, curator
 * resolutions, checked-by stamps) keeps pointing at a real row, without a
 * path back to the person.
 *
 * DELETED (this user's rows only, in the SAME transaction as the update
 * below): `sessions` — every row for this `userId`.
 *
 * NULLED on the `users` row itself: `email`.
 * `status` becomes `'erased'`.
 *
 * KEPT, deliberately: `role` — an admin/curator target's role field itself
 * is untouched by erasure (see the LAST-ADMIN GUARD below for why erasing
 * an active admin is still guarded the same as banning one).
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
 * belt and braces, so no dead row is left behind.
 */
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { sessions, users } from '../db/schema';

/** Same actor shape src/lib/admin.ts's `AdminActor` uses — every mutator below re-asserts `role === 'admin'` itself (defense in depth, see that module's docstring for the full rationale). */
export type AdminActor = { userId: number; role: 'admin' };

function assertAdmin(actor: { role: string }): void {
  if (actor.role !== 'admin') {
    throw new Error('admin_only');
  }
}

type ExistingUser = { role: string; status: string; email: string | null };

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
 * DPDP erasure (architecture.md §7). See module docstring for
 * exactly what's deleted, nulled, and kept, plus the idempotency argument.
 * Throws `'user_not_found'`, `'cannot_erase_self'`, or
 * `'cannot_erase_last_admin'` before writing anything.
 */
export async function eraseUser(actor: AdminActor, targetUserId: number): Promise<void> {
  assertAdmin(actor);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ role: users.role, status: users.status, email: users.email })
      .from(users)
      .where(eq(users.id, targetUserId));
    if (!existing) {
      throw new Error('user_not_found');
    }

    assertNotSelf(actor, targetUserId, 'erase');
    await assertNotLastActiveAdmin(tx, existing, 'erase');

    await tx.delete(sessions).where(eq(sessions.userId, targetUserId));

    await tx
      .update(users)
      .set({
        email: null,
        passwordHash: null,
        status: 'erased',
      })
      .where(eq(users.id, targetUserId));

  });
}

/**
 * Deactivates/bans a staff account. Kills every active session for the user immediately (see module
 * docstring's SESSIONS ARE DELETED note) and rejects an already-erased
 * target (`'cannot_ban_erased'` — erasure is terminal, never re-bannable).
 * `reason`, if given, is accepted for caller compatibility but is not stored.
 */
export async function banUser(actor: AdminActor, targetUserId: number, _reason?: string): Promise<void> {
  assertAdmin(actor);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ role: users.role, status: users.status, email: users.email })
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
  status: string;
  role: string;
  /** Whether a sign-in secret is set; the hash itself never leaves the database. */
  hasSecret: boolean;
  createdAt: Date;
}

/** `'staff'` is every role at once. */
export type UserRoleFilter = 'staff' | 'admin' | 'curator' | 'transcriber';
export type UserStatusFilter = 'any' | 'active' | 'banned' | 'erased';

export const USER_ROLE_FILTERS: readonly UserRoleFilter[] = ['staff', 'admin', 'curator', 'transcriber'];
export const USER_STATUS_FILTERS: readonly UserStatusFilter[] = ['any', 'active', 'banned', 'erased'];

export interface UserListOptions {
  query?: string;
  /** Defaults to `'staff'` (every account). */
  role?: UserRoleFilter;
  status?: UserStatusFilter;
}

export interface UserList {
  rows: UserSearchRow[];
}

/**
 * The `/admin/users` list ("search users"). Every account is staff, so the
 * list is never capped. A query matches ANY of — `id` exactly (only tried
 * when `query` is a bare integer, unioned with the email check rather than
 * exclusively branching on "looks numeric"), OR a case-insensitive
 * substring of `email` — and is narrowed by `role`/`status` when given.
 *
 * Rows sort admin, curator, transcriber, then by email.
 */
export async function listUsers(options: UserListOptions): Promise<UserList> {
  const query = (options.query ?? '').trim();
  const role = options.role ?? 'staff';
  const status = options.status ?? 'any';

  const conditions: SQL[] = [];
  if (role !== 'staff') {
    conditions.push(eq(users.role, role));
  }
  if (status !== 'any') {
    conditions.push(eq(users.status, status));
  }

  if (query) {
    // Escape ilike wildcards: backslash must be escaped first, then % and _
    const escapedQuery = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${escapedQuery}%`;

    const matches = [sql`${users.email} ILIKE ${pattern} ESCAPE '\\'`];
    if (/^\d+$/.test(query)) {
      matches.push(eq(users.id, Number(query)));
    }
    conditions.push(or(...matches)!);
  }

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      status: users.status,
      role: users.role,
      hasSecret: sql<boolean>`${users.passwordHash} IS NOT NULL`,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(...conditions))
    .orderBy(
      sql`CASE ${users.role} WHEN 'admin' THEN 0 WHEN 'curator' THEN 1 ELSE 2 END`,
      users.email,
      users.id,
    );

  return { rows };
}

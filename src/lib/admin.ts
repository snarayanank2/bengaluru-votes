/**
 * Business logic behind the admin console's role management
 * (Task 44).
 * Admins govern who is a curator or an admin — this module IS the root of
 * the authorization chain the rest of the app reads (`users.role`, checked
 * by `src/middleware.ts`). Curators and admins are both city-wide (decided
 * 2026-08-15): there is no ward scope to assign. Every mutation here is
 * admin-only (docs/architecture.md §7): `src/middleware.ts` already
 * 403s any non-admin session on the `/admin/*` route class, and each
 * mutator below re-asserts `actor.role === 'admin'` anyway — defense in
 * depth against a future non-route caller.
 *
 * LOCKOUT PREVENTION (Task 44 review): because this module is the root of
 * the authorization chain and `readSession` re-reads `users.role` on every
 * request, a self-demote or revoking the last admin would lock every admin
 * out of `/admin/*` on the next request, recoverable only server-side via
 * `scripts/seed-admin.ts`. `revokeRole` and `grantRole`'s one demote-an-
 * admin path both run through `assertNotSelfOrLastAdmin` before writing —
 * see that function's docstring for exactly what's guarded and the one
 * accepted residual race (concurrent double-revoke).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { sessions, transcriptionAssignments, users } from '../db/schema';
import { isUniqueViolation } from './db-errors';
import { isValidEmail } from './email';
import { hashPassword, passwordProblem } from './password';

/** The actor shape every mutator below requires — same session shape `src/middleware.ts` puts on `locals.session`, narrowed to admin. */
export type AdminActor = { userId: number; role: 'admin' };

/** Every role. Only staff have accounts; they are email-only (docs/architecture.md §7). */
export type StaffRole = 'transcriber' | 'curator' | 'admin';

export const STAFF_ROLES: readonly StaffRole[] = ['transcriber', 'curator', 'admin'];

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/** RFC 5321's practical ceiling on a whole address. */
const MAX_EMAIL_LENGTH = 254;

/**
 * Re-asserts admin, throwing `'admin_only'` otherwise. Every exported
 * mutator calls this first, even though its TypeScript parameter type
 * already says `role: 'admin'` — that type only binds a well-typed
 * caller; a route or test could still construct/pass an object with a
 * different runtime value. See module docstring.
 */
function assertAdmin(actor: { role: string }): void {
  if (actor.role !== 'admin') {
    throw new Error('admin_only');
  }
}

/**
 * LOCKOUT-PREVENTION GUARD (Task 44 review — protects the root of the
 * authorization chain). `readSession` (src/lib/session.ts) re-reads
 * `users.role` on every request, so a self-demote or revoking the last
 * admin locks EVERY admin out of `/admin/*` on the very next request, with
 * recovery only possible server-side via `scripts/seed-admin.ts`. Called by
 * both `revokeRole` and `grantRole` (the latter only on its one demote-an-
 * admin path — see that function's docstring) before either applies its
 * write, inside the same transaction as that write.
 *
 * Throws `'cannot_revoke_self'` if `targetUserId` is the calling admin's own
 * id — an admin must never demote themselves in one action; another admin
 * can still do it. Checked unconditionally (before even looking at
 * `existing`), since a self-demote is never a legitimate action regardless
 * of how many other admins exist.
 *
 * Throws `'cannot_revoke_last_admin'` if `existing` (the target's CURRENT
 * row) is an active admin and removing them would leave the active-admin
 * pool at zero — `count(*) from users where role='admin' and
 * status='active'`, computed in the SAME transaction as the caller's
 * subsequent write. A target whose own `status` isn't `'active'` (already
 * banned/erased) never trips this: they aren't part of the pool being
 * protected, so demoting them can't zero it out.
 *
 * RESIDUAL RISK (accepted, not fixed here): two concurrent transactions
 * each revoking a DIFFERENT one of the last two admins can each read
 * count=2 before either commits, so both could pass this check and the pair
 * could still commit to zero admins. Admin churn is rare and a
 * table-wide lock to close this completely was judged not worth the added
 * contention on every grant/revoke was judged not worth it;
 * `scripts/seed-admin.ts` is the recovery path for this low-probability race.
 */
async function assertNotSelfOrLastAdmin(
  tx: Tx,
  actor: AdminActor,
  targetUserId: number,
  existing: { role: string; status: string },
): Promise<void> {
  if (targetUserId === actor.userId) {
    throw new Error('cannot_revoke_self');
  }

  if (existing.role === 'admin' && existing.status === 'active') {
    const [activeAdmins] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
    if (Number(activeAdmins?.count ?? 0) <= 1) {
      throw new Error('cannot_revoke_last_admin');
    }
  }
}

/**
 * Creates a NEW staff account by email. Throws `'invalid_email'`, or
 * `'user_exists'` when the address already has an account — it never
 * changes an existing account's role; that stays the explicit change-role
 * action on the same page (`grantRole`).
 */
export async function addUser(actor: AdminActor, emailRaw: string, role: StaffRole, initial?: string): Promise<number> {
  assertAdmin(actor);

  const email = emailRaw.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !isValidEmail(email)) {
    throw new Error('invalid_email');
  }

  // Optional: an account added without one cannot sign in until an admin sets it.
  let credential: { passwordHash: string; passwordChangedAt: Date } | undefined;
  if (initial !== undefined) {
    const problem = passwordProblem(initial);
    if (problem) throw new Error(problem);
    credential = { passwordHash: await hashPassword(initial), passwordChangedAt: new Date() };
  }

  try {
    const [row] = await db.insert(users).values({ email, role, ...credential }).returning({ id: users.id });
    return row!.id;
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error('user_exists');
    throw err;
  }
}

/**
 * Sets (or replaces) a staff member's sign-in password. Admin-only; an admin
 * sets their own through the same call. Every live session of the target is
 * deleted, so a changed password also signs the person out everywhere.
 *
 * Throws 'password_too_short' / 'password_too_long' (src/lib/password.ts),
 * 'user_not_found', or 'user_not_active' for a banned or erased account.
 */
export async function setStaffPassword(actor: AdminActor, targetUserId: number, next: string): Promise<void> {
  assertAdmin(actor);
  const problem = passwordProblem(next);
  if (problem) throw new Error(problem);
  const passwordHash = await hashPassword(next);

  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ status: users.status }).from(users).where(eq(users.id, targetUserId));
    if (!existing) throw new Error('user_not_found');
    if (existing.status !== 'active') throw new Error('user_not_active');
    await tx.update(users).set({ passwordHash, passwordChangedAt: new Date() }).where(eq(users.id, targetUserId));
    await tx.delete(sessions).where(eq(sessions.userId, targetUserId));
  });
}

/**
 * Moves `targetUserId` between staff roles. Curator and admin are
 * city-wide the moment they are granted.
 *
 * DEMOTE-AN-ADMIN GUARD (Task 44 review): a staff `role` means
 * this function's only possible DEMOTION is an existing admin set to a
 * non-admin staff role — every other combination (an elevation, a lateral
 * move among non-admins, or a same-role no-op) elevates or holds steady and is never a lockout
 * risk. That one demote path runs through the exact same
 * `assertNotSelfOrLastAdmin` guard `revokeRole` uses, so a self-demote or a
 * last-admin demotion via `grantRole` is rejected exactly like it would be
 * via `revokeRole` — there is no separate "demote via grant" bypass.
 *
 * Throws `'user_not_found'` for a `targetUserId` with no `users` row.
 * Throws `'cannot_revoke_self'` / `'cannot_revoke_last_admin'` for the
 * demote-an-admin case described above — see `assertNotSelfOrLastAdmin`.
 */
export async function grantRole(actor: AdminActor, targetUserId: number, role: StaffRole): Promise<void> {
  assertAdmin(actor);

  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, targetUserId));
    if (!existing) {
      throw new Error('user_not_found');
    }

    if (existing.role === 'admin' && role !== 'admin') {
      await assertNotSelfOrLastAdmin(tx, actor, targetUserId, existing);
    }

    await tx.update(users).set({ role }).where(eq(users.id, targetUserId));
  });
}

/**
 * Removes `targetUserId`'s staff access by removing the account: its
 * sessions are deleted, then the `users` row. An account a transcription
 * assignment still points at cannot be deleted without losing that
 * history, so it is erased instead (email nulled, status `'erased'`, the
 * same tombstone as src/lib/erasure.ts's `eraseUser`).
 *
 * LOCKOUT-PREVENTION GUARD (Task 44 review): before applying the change,
 * rejects with `'cannot_revoke_self'` (the caller revoking their own id) or
 * `'cannot_revoke_last_admin'` (the target is the last active admin) — see
 * `assertNotSelfOrLastAdmin`'s docstring for exactly what's checked and the
 * one documented residual race.
 *
 * Throws `'user_not_found'` for a `targetUserId` with no `users` row.
 */
export async function revokeRole(actor: AdminActor, targetUserId: number): Promise<void> {
  assertAdmin(actor);

  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, targetUserId));
    if (!existing) {
      throw new Error('user_not_found');
    }

    await assertNotSelfOrLastAdmin(tx, actor, targetUserId, existing);

    await tx.delete(sessions).where(eq(sessions.userId, targetUserId));
    const [assignment] = await tx
      .select({ id: transcriptionAssignments.id })
      .from(transcriptionAssignments)
      .where(eq(transcriptionAssignments.transcriberId, targetUserId))
      .limit(1);
    if (assignment) {
      await tx.update(users).set({ email: null, status: 'erased' }).where(eq(users.id, targetUserId));
    } else {
      await tx.delete(users).where(eq(users.id, targetUserId));
    }
  });
}

export interface ConsoleStats {
  transcriberCount: number;
  curatorCount: number;
  adminCount: number;
}

/** The `/admin` console home's small overview line — deliberately just a few counts; the console is mostly navigation, not a dashboard. */
export async function loadConsoleStats(): Promise<ConsoleStats> {
  const roleCounts = await db
    .select({ role: users.role, count: sql<number>`count(*)::int` })
    .from(users)
    .where(inArray(users.role, [...STAFF_ROLES]))
    .groupBy(users.role);

  const countFor = (role: StaffRole): number => Number(roleCounts.find((r) => r.role === role)?.count ?? 0);

  return {
    transcriberCount: countFor('transcriber'),
    curatorCount: countFor('curator'),
    adminCount: countFor('admin'),
  };
}

export interface UserSummary {
  id: number;
  email: string | null;
  role: string;
}

/** One account by id, or `null`. Feeds `/admin/users`'s post-action confirmation banner. */
export async function findUserById(userId: number): Promise<UserSummary | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

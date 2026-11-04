/**
 * Shared driver-error classification helpers.
 *
 * drizzle-orm (0.45+) wraps every driver error thrown from a query in a
 * `DrizzleQueryError`, which does NOT copy the underlying driver error's
 * `.code` onto itself — the original `postgres` package error (with its
 * `.code`) is only reachable via `.cause`. Any catch site that needs to
 * distinguish a specific Postgres error code must therefore check both
 * shapes, or it will silently miss the wrapped case (Task 29 review: this
 * exact gap left src/lib/auth-flow.ts's registration race undetected).
 */

/** Postgres SQLSTATE for a unique-index violation (e.g. users.email/users.phone — one account per contact). */
export const PG_UNIQUE_VIOLATION = '23505';

/** True if `err` is a (possibly Drizzle-wrapped) Postgres unique-violation error. */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (code === PG_UNIQUE_VIOLATION) return true;
  const causeCode = (err as { cause?: { code?: string } })?.cause?.code;
  return causeCode === PG_UNIQUE_VIOLATION;
}

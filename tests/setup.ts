/**
 * Closes the app's shared Postgres pool at the end of every test file.
 *
 * THE BUG THIS FIXES: `src/db/client.ts` opens a `max: 10` postgres.js pool
 * at module load and never closes it. That is correct for a long-lived
 * server process and wrong under vitest, which — with the default
 * `isolate: true` — gives every test file a fresh module registry and
 * therefore a BRAND NEW pool. Test files dutifully close their own client in
 * `afterAll` (all 58 of them do); nothing closed the one they never opened
 * directly.
 *
 * Because vitest.config.ts pins the whole suite to a single fork, those
 * orphaned pools all outlive their file and sit idle for the rest of the
 * run, so connections accumulate monotonically. Measured before this fix:
 * ~1-2 per file, climbing to 98 by roughly the 80th file, against
 * `max_connections = 100` (97 usable — 3 are superuser-reserved). Every file
 * after that died with `PostgresError: sorry, too many clients already`, and
 * the failures looked like scattered broken tests rather than one exhausted
 * resource: 14-17 files failing at `migrate()` or a plain insert, while
 * ~1100 assertions still passed.
 *
 * WHY THE DYNAMIC IMPORT: a static import here would make every test file
 * construct this pool, including pure unit tests that never touch Postgres.
 * Importing inside the hook keeps that cost on the files that already loaded
 * the module. The `DATABASE_URL` guard keeps a DB-free test file DB-free.
 *
 * `db.$client` is drizzle's handle on the underlying postgres.js instance,
 * which is what lets this close the pool without adding an export to
 * production code purely for tests.
 */
import { afterAll } from 'vitest';

type ClosablePool = { end: (options?: { timeout?: number }) => Promise<void> };

afterAll(async () => {
  if (!process.env.DATABASE_URL) return;

  const { db } = await import('../src/db/client');
  // `timeout` bounds the wait for in-flight queries so a leaked handle in one
  // file can't hang the whole run; postgres.js then closes the sockets anyway.
  await (db.$client as unknown as ClosablePool).end({ timeout: 5 });
});

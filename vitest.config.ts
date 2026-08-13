import { getViteConfig } from 'astro/config';

// Uses Astro's `getViteConfig` (rather than plain vitest `defineConfig`) so
// that `.astro` files can be imported directly in tests — needed for
// tests/routes/layout.test.ts, which renders Base.astro/AppBar.astro/etc.
// via Astro's experimental container API. This still produces a normal
// Vite/vitest config for every other (plain .ts) test file.
export default getViteConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    // All DB-backed tests share ONE Postgres database; running test files in
    // parallel worker processes causes cross-file races (a temporary DDL rule
    // in audit.test.ts breaks other files' INSERT...RETURNING with 0A000;
    // fixture-id collisions; concurrent migrate()). Serialize test files.
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
    // Closes the app's shared Postgres pool after each file. Required, not
    // hygiene: `singleFork` above means every file's pool outlives it, and
    // without this teardown the run exhausts `max_connections` around the
    // 80th file. See tests/setup.ts for the full mechanism.
    setupFiles: ['tests/setup.ts'],
  },
});

/**
 * Playwright smoke suite over the four critical user paths (Task 64,
 * .superpowers/sdd/task-64-brief.md; architecture.md §12). A real Chromium
 * browser drives the real Astro SSR app (the same `astro build` output that
 * ships), against a seeded Postgres database, exercising the identical
 * server code paths production traffic hits.
 *
 * HARNESS CHOICE (documented per the task brief): the brief describes
 * running "against the Compose stack". This config instead uses
 * Playwright's own `webServer` to start `node dist/server/entry.mjs`
 * directly — no Docker Compose, no nginx micro-cache, no cron container.
 * That's deliberately lighter than the full stack while still exercising
 * the SAME production build artifact and the SAME SSR code paths (the
 * nginx layer in front of it is a cache/TLS/rate-limit concern, not
 * something these four user-journey specs need to drive through — Task 64
 * is a smoke suite over app behavior, not an nginx integration test).
 * `reuseExistingServer` is on outside CI, so a developer can leave
 * `node dist/server/entry.mjs` running locally and iterate on specs without
 * paying the ~1s startup cost every run.
 *
 * DATABASE: a DEDICATED Postgres database (`bv_e2e`, same Postgres
 * container/port the unit/route vitest suite's `bv_test` already runs on —
 * see docker-compose/task-64-report.md) rather than reusing `bv_test`
 * itself. The vitest suite's route/unit tests insert and don't always clean
 * up small-id fixture rows (a stray `wards.id = 1`, etc.) directly into
 * `bv_test`; seed-dev.ts picks its 3 demo wards via `ORDER BY id ASC LIMIT
 * 3`, so running e2e against the SAME database as vitest would make which
 * wards get seeded depend on what other tests happened to leave behind —
 * exactly the nondeterminism this suite needs to avoid. `bv_e2e` starts
 * from a bare `CREATE DATABASE` and is only ever touched by
 * `npm run seed:e2e` (which runs migrations itself, idempotently) and this
 * suite's own app server.
 *
 * RUN SEQUENCE (see task-64-report.md for the full writeup):
 *   1. `npm run build:e2e` — NOT plain `npm run build`. `astro.config.mjs`'s
 *      `security.allowedDomains` (and `site`) are resolved once at BUILD
 *      time, not read per-request; without `E2E_ALLOWED_HOST=127.0.0.1
 *      E2E_ALLOWED_PORT=4321` set for THIS build, the Node standalone
 *      adapter refuses to trust the direct `Host: 127.0.0.1:4321` header
 *      (it only trusts the two real prod/staging hostnames), falls back to
 *      computing its own request origin as `http://localhost`, and every
 *      form-urlencoded POST (curator accept/reject, the no-JS ward-lookup
 *      fallback) then fails Astro's OWN built-in same-origin check with
 *      "Cross-site POST form submissions are forbidden" — found by
 *      flag.spec.ts. `E2E_ALLOWED_HOST`/`_PORT` must NEVER be set for a real
 *      prod/staging build (see astro.config.mjs's own comment).
 *   2. `DATABASE_URL=.../bv_e2e npm run seed:e2e`  (migrate + seed + writes
 *      tests/e2e/.fixtures.json)
 *   3. `npx playwright test`                (this config)
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;
const HOST = '127.0.0.1';

// Defaulted here (not just documented) so `npx playwright test` and any
// spec file that imports tests/e2e/support/db.ts see the SAME DATABASE_URL
// even if the invoking shell didn't export one — this is the one place
// that default is allowed to live for the e2e run.
process.env.DATABASE_URL ??= 'postgres://gba:gba_local_dev@localhost:5433/bv_e2e';

const SESSION_SECRET = process.env.E2E_SESSION_SECRET ?? 'e2e-test-only-session-secret-never-use-in-prod';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // one seeded DB, shared across specs — avoid cross-spec races (same rationale as vitest.config.ts's fileParallelism:false)
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Mobile-ish viewport — the app is mobile-first (CLAUDE.md, design-system.md).
    viewport: { width: 390, height: 844 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],

  webServer: {
    command: `node ./dist/server/entry.mjs`,
    url: `http://${HOST}:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      HOST,
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL,
      // The enabler (Task 64 brief): requestOtp additionally writes the
      // plaintext code to otp_test_codes (src/lib/otp.ts) ONLY when this is
      // exactly 'true'. Never set in any committed prod/staging env.
      OTP_TEST_SINK: 'true',
      SESSION_SECRET,
      // Belt-and-braces: guards src/lib/send/send.ts's campaign-send path
      // (unused by these specs, but harmless to also disable). The OTP
      // path itself (src/lib/send/sendgrid.ts, twilio.ts) already no-ops
      // with no vendor keys set below — that's the real reason no OTP
      // email/WhatsApp is ever actually sent in this run.
      SENDS_DISABLED: 'true',
      NODE_ENV: 'test',
    },
  },
});

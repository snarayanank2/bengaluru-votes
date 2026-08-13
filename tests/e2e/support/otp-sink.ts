/**
 * Reads OTP codes back out of `otp_test_codes` (src/db/schema.ts) — the
 * TEST-ONLY table `src/lib/otp.ts#requestOtp` writes to when
 * `OTP_TEST_SINK=true` (see that function's module-level comment). This is
 * the enabler for every OTP-gated e2e flow (vote.spec.ts, flag.spec.ts):
 * Playwright drives a real browser talking to the app over HTTP, in a
 * SEPARATE process from the test runner, so there is no in-process way to
 * intercept the code `requestOtp` generated — the app must persist it
 * somewhere the test can read, and this table is that somewhere.
 *
 * `normalizeDestination` is imported from the app's own `src/lib/otp.ts`
 * rather than re-implemented, so a test destination like `Foo@Example.com`
 * looks itself up exactly the way the app normalized it before writing the
 * row (lowercased email, trimmed phone) — see that module for the rule.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from './db';
import { otpTestCodes } from '../../../src/db/schema';
import { normalizeDestination } from '../../../src/lib/otp';

const POLL_INTERVAL_MS = 200;

/**
 * Polls `otp_test_codes` for the most recent code sent to `destination`
 * since `sinceMs` (default: 30s ago, generous enough for a slow machine),
 * up to `timeoutMs` (default 10s). Throws if no row appears in time — a
 * calling spec should never silently proceed without a real code.
 */
export async function readLatestOtpCode(
  destination: string,
  opts?: { timeoutMs?: number; sinceMs?: number },
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const since = new Date(Date.now() - (opts?.sinceMs ?? 30_000));
  const normalized = normalizeDestination(destination);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const [row] = await db
      .select({ code: otpTestCodes.code, createdAt: otpTestCodes.createdAt })
      .from(otpTestCodes)
      .where(eq(otpTestCodes.destination, normalized))
      .orderBy(desc(otpTestCodes.createdAt))
      .limit(1);

    if (row && row.createdAt.getTime() >= since.getTime()) {
      return row.code;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `readLatestOtpCode: no otp_test_codes row for ${JSON.stringify(normalized)} appeared within ${timeoutMs}ms ` +
      `(OTP_TEST_SINK must be 'true' on the app server for this to ever populate).`,
  );
}

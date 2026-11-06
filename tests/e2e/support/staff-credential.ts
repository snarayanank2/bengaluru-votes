/**
 * The sign-in password of the e2e database's seeded curator
 * (scripts/seed-e2e.ts sets it; the specs sign in with it). Test-only, for
 * the throwaway `bv_e2e` database; at least 16 characters, as
 * src/lib/password.ts requires.
 */
export const E2E_STAFF_PASSWORD = 'e2e-test-only-staff-credential';

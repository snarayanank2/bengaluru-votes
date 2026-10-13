/**
 * Shape check for an email address typed by an admin or passed to
 * `npm run seed:admin`. Deliberately loose (something@something.tld, no
 * whitespace) — delivery is the real test. Kept free of imports so
 * scripts/seed-admin.ts can use it without opening the app's database
 * pool (src/lib/admin.ts imports src/db/client.ts).
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

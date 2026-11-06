#!/usr/bin/env tsx
/**
 * Set a staff member's sign-in password from the server side — the way the
 * FIRST admin gets one (nobody can sign in to /admin/users without one), and
 * the recovery path if every admin is locked out. Later passwords are set by
 * an admin at /admin/users.
 *
 * Usage: npm run set-password -- <email>
 *
 * The password comes from the STAFF_PASSWORD environment variable when set
 * (so the operator chooses it and it never appears in shell history as an
 * argument); otherwise a random one is generated and printed once. At least
 * 16 characters. Every live session of that account is deleted.
 *
 * Only an existing, active account is touched — this never creates a user
 * (use `npm run seed:admin` or /admin/users for that).
 */
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import type { Db } from '../src/db/client';
import { generatePassword, hashPassword, passwordProblem } from '../src/lib/password';

/** Sets `secret` for the active account with this email. Throws 'user_not_found' / 'user_not_active' / a password problem code. */
export async function setPasswordByEmail(db: Db, emailRaw: string, secret: string): Promise<number> {
  const email = emailRaw.trim().toLowerCase();
  const problem = passwordProblem(secret);
  if (problem) throw new Error(problem);
  const passwordHash = await hashPassword(secret);

  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: schema.users.id, status: schema.users.status }).from(schema.users).where(eq(schema.users.email, email));
    if (!user) throw new Error('user_not_found');
    if (user.status !== 'active') throw new Error('user_not_active');
    await tx.update(schema.users).set({ passwordHash, passwordChangedAt: new Date() }).where(eq(schema.users.id, user.id));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    return user.id;
  });
}

/**
 * Gives the account a generated password only if it has none yet, and returns
 * it (to be printed once); `null` when it already had one. Used by the seeds.
 */
export async function ensurePassword(db: Db, emailRaw: string): Promise<string | null> {
  const email = emailRaw.trim().toLowerCase();
  const [user] = await db.select({ hash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.email, email));
  if (!user || user.hash) return null;
  const generated = generatePassword();
  await setPasswordByEmail(db, email, generated);
  return generated;
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run set-password -- <email>   (optionally STAFF_PASSWORD=<16+ chars>)');
    process.exit(1);
  }
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const supplied = process.env.STAFF_PASSWORD ?? '';
  const secret = supplied !== '' ? supplied : generatePassword();

  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    const id = await setPasswordByEmail(db, email, secret);
    console.log(`set-password: updated user id ${id} (${email.trim().toLowerCase()}); their sessions were ended`);
    if (supplied === '') {
      console.log(`set-password: generated password (shown once): ${secret}`);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

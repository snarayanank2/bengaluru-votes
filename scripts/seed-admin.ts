#!/usr/bin/env tsx
/**
 * Upsert an admin user by email — the root of the authorization chain
 * (architecture §14.6). Role is never inferred from the address anywhere
 * else in the app; this script is the only place a user becomes 'admin'.
 *
 * Usage: npm run seed:admin -- <email>
 * Running twice with the same email updates the same row (unique on email)
 * and leaves role='admin' — idempotent.
 */
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import type { Db } from '../src/db/client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** Upsert a users row with role='admin' for the given email. Returns the user id. */
export async function seedAdmin(db: Db, email: string): Promise<number> {
  const trimmed = email.trim().toLowerCase();
  if (!isValidEmail(trimmed)) {
    throw new Error(`seed-admin: invalid email ${JSON.stringify(email)}`);
  }

  const [row] = await db
    .insert(schema.users)
    .values({ email: trimmed, role: 'admin' })
    .onConflictDoUpdate({
      target: schema.users.email,
      set: { role: 'admin' },
    })
    .returning({ id: schema.users.id });

  return row.id;
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run seed:admin -- <email>');
    process.exit(1);
  }

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error(
      'DATABASE_URL is not set. Set it before running, e.g. against the\n' +
        'local stack (deploy/compose.local.yml):\n' +
        'export DATABASE_URL=postgres://gba:gba_local_dev@localhost:5433/gba',
    );
    process.exit(1);
  }

  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client, { schema });
  try {
    const id = await seedAdmin(db, email);
    console.log(`seed-admin: user id ${id} is now admin (${email.trim().toLowerCase()})`);
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

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { isSuppressed, addSuppression } from '../../src/lib/suppressions';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// Task-52-specific contacts so this suite never collides with another test
// file's fixtures in the shared test DB.
const D = {
  seededEmail: 'suppressions-unit-seeded@example.com',
  cleanEmail: 'suppressions-unit-clean@example.com',
  upsertEmail: 'suppressions-unit-upsert@example.com',
  crossChannelPhone: '+919000000052',
};

async function resetFixtures(): Promise<void> {
  await db.delete(schema.suppressions).where(eq(schema.suppressions.contact, D.seededEmail));
  await db.delete(schema.suppressions).where(eq(schema.suppressions.contact, D.cleanEmail));
  await db.delete(schema.suppressions).where(eq(schema.suppressions.contact, D.upsertEmail));
  await db.delete(schema.suppressions).where(eq(schema.suppressions.contact, D.crossChannelPhone));
}

describe('src/lib/suppressions.ts', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => {
    await resetFixtures();
    await client.end();
  });

  beforeEach(async () => {
    await resetFixtures();
  });

  describe('isSuppressed', () => {
    it('a seeded suppressions row for (contact, channel) -> true', async () => {
      await db.insert(schema.suppressions).values({ contact: D.seededEmail, channel: 'email', reason: 'bounce' });
      await expect(isSuppressed(D.seededEmail, 'email')).resolves.toBe(true);
    });

    it('no row for (contact, channel) -> false', async () => {
      await expect(isSuppressed(D.cleanEmail, 'email')).resolves.toBe(false);
    });

    it('a suppression on one channel does not suppress the same contact on the other channel', async () => {
      await db.insert(schema.suppressions).values({ contact: D.crossChannelPhone, channel: 'whatsapp', reason: 'stop' });
      await expect(isSuppressed(D.crossChannelPhone, 'whatsapp')).resolves.toBe(true);
      await expect(isSuppressed(D.crossChannelPhone, 'email')).resolves.toBe(false);
    });
  });

  describe('addSuppression', () => {
    it('inserts a new suppressions row', async () => {
      await addSuppression(D.upsertEmail, 'email', 'complaint');
      const rows = await db
        .select()
        .from(schema.suppressions)
        .where(and(eq(schema.suppressions.contact, D.upsertEmail), eq(schema.suppressions.channel, 'email')));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.reason).toBe('complaint');
    });

    it('is idempotent on the (contact, channel) unique index: calling it twice never throws and leaves exactly one row', async () => {
      await addSuppression(D.upsertEmail, 'email', 'bounce');
      await addSuppression(D.upsertEmail, 'email', 'bounce');

      const rows = await db
        .select()
        .from(schema.suppressions)
        .where(and(eq(schema.suppressions.contact, D.upsertEmail), eq(schema.suppressions.channel, 'email')));
      expect(rows).toHaveLength(1);
    });

    it('a second call with a different reason updates the reason on the same row rather than erroring', async () => {
      await addSuppression(D.upsertEmail, 'email', 'bounce');
      await addSuppression(D.upsertEmail, 'email', 'complaint');

      const rows = await db
        .select()
        .from(schema.suppressions)
        .where(and(eq(schema.suppressions.contact, D.upsertEmail), eq(schema.suppressions.channel, 'email')));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.reason).toBe('complaint');
    });
  });
});

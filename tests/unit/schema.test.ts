import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

describe('db schema — wards round-trip', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => {
    await client.end();
  });

  it('inserts and selects a wards row', async () => {
    const [inserted] = await db
      .insert(schema.wards)
      .values({
        id: 1,
        nameEn: 'Test Ward',
        nameKn: 'ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
        corporation: 'south',
        zone: 'Zone 1',
        boundaryRef: 'ward-1',
      })
      .onConflictDoNothing()
      .returning();

    const [selected] = await db
      .select()
      .from(schema.wards)
      .where(eq(schema.wards.id, 1));

    expect(selected).toBeDefined();
    expect(selected.nameEn).toBe(inserted?.nameEn ?? 'Test Ward');
    expect(selected.corporation).toBe('south');
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see AGENTS.md ("Tests need a database") for how to get one.',
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

  it('migration 0017 leaves no dormant tables, enums or columns behind', async () => {
    for (const table of ['partners', 'partner_wards', 'eoi_submissions', 'booths', 'candidate_stances']) {
      const [row] = await client`select to_regclass(${'public.' + table}) as oid`;
      expect(row!.oid, table).toBeNull();
    }
    const enums = await client`select typname from pg_type where typname in ('eoi_path', 'eoi_status')`;
    expect(enums).toHaveLength(0);
    const columns = await client`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'candidates' and column_name in ('name_kn', 'party_kn', 'photo_media_id'))
          or (table_name = 'candidate_affidavits' and column_name = 'origin_url'))`;
    expect(columns).toHaveLength(0);
  });
});

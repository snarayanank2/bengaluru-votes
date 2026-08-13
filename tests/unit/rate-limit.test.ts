import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { checkAccountLimit, checkDefaultLimit, DEFAULT_LIMITS } from '../../src/lib/rate-limit';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ids (task-30 brief) so this suite never collides with
// another test file's fixtures in the shared test DB.
const WARD_ID = 94030;
const USER_ID_BASE = 940300;

const WARD = {
  id: WARD_ID,
  nameEn: 'Rate Limit Test Ward',
  nameKn: 'ದರ ಮಿತಿ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone V',
  boundaryRef: 'rate-limit-test-ward',
};

let flagItemId: number;

async function makeUser(id: number): Promise<number> {
  const [user] = await db
    .insert(schema.users)
    .values({ id, email: `rate-limit-fixture-${id}@example.com`, homeWardId: WARD_ID })
    .onConflictDoUpdate({ target: schema.users.id, set: { homeWardId: WARD_ID } })
    .returning({ id: schema.users.id });
  return user!.id;
}

async function seedFlags(userId: number, n: number, createdAt: Date): Promise<void> {
  for (let i = 0; i < n; i++) {
    await db.insert(schema.flagSubmissions).values({
      flagItemId,
      userId,
      detail: 'test detail',
      createdAt,
    });
  }
}

async function seedVoteSets(userId: number, n: number, createdAt: Date): Promise<void> {
  for (let i = 0; i < n; i++) {
    await db.insert(schema.issueVoteSets).values({
      userId,
      wardId: WARD_ID,
      active: false, // avoid the active-set-per-user unique index
      createdAt,
    });
  }
}

async function seedMedia(createdBy: number, n: number, createdAt: Date): Promise<void> {
  for (let i = 0; i < n; i++) {
    await db.insert(schema.media).values({
      bytes: Buffer.from('x'),
      contentType: 'image/png',
      sha256: `sha-${createdBy}-${i}-${createdAt.getTime()}`,
      size: 1,
      createdBy,
      createdAt,
    });
  }
}

async function resetFixtures(): Promise<void> {
  for (let id = USER_ID_BASE; id < USER_ID_BASE + 20; id++) {
    await db.delete(schema.media).where(eq(schema.media.createdBy, id));
    await db.delete(schema.issueVoteSets).where(eq(schema.issueVoteSets.userId, id));
    await db.delete(schema.flagSubmissions).where(eq(schema.flagSubmissions.userId, id));
  }
}

describe('rate-limit (src/lib/rate-limit.ts) — PRD §6.3, §12; architecture §3', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });

    const targetRef = `ward:${WARD_ID}:name`;
    const [existing] = await db
      .select({ id: schema.flagItems.id })
      .from(schema.flagItems)
      .where(eq(schema.flagItems.targetRef, targetRef));
    if (existing) {
      flagItemId = existing.id;
    } else {
      const [flagItem] = await db
        .insert(schema.flagItems)
        .values({
          wardId: WARD_ID,
          targetType: 'ward_field',
          targetRef,
          status: 'pending',
        })
        .returning({ id: schema.flagItems.id });
      flagItemId = flagItem!.id;
    }
  });

  afterAll(async () => {
    await resetFixtures();
    await client.end();
  });

  afterEach(async () => {
    await resetFixtures();
  });

  it('under limit: 3 flags in the last hour, limit {count:10, perHours:24} → true', async () => {
    const userId = await makeUser(USER_ID_BASE + 1);
    await seedFlags(userId, 3, new Date());

    expect(await checkAccountLimit(userId, 'flag', { count: 10, perHours: 24 })).toBe(true);
  });

  it('at limit: exactly `count` rows in the window → false (count < limit.count rule)', async () => {
    const userId = await makeUser(USER_ID_BASE + 2);
    await seedFlags(userId, 10, new Date());

    expect(await checkAccountLimit(userId, 'flag', { count: 10, perHours: 24 })).toBe(false);
  });

  it('window: rows older than perHours do not count', async () => {
    const userId = await makeUser(USER_ID_BASE + 3);
    const longAgo = new Date(Date.now() - 30 * 3600_000); // 30h ago, window is 24h
    await seedFlags(userId, 15, longAgo); // would be over limit if counted

    expect(await checkAccountLimit(userId, 'flag', { count: 10, perHours: 24 })).toBe(true);
  });

  it("'vote' counts issue_vote_sets, not flag_submissions", async () => {
    const userId = await makeUser(USER_ID_BASE + 4);
    await seedFlags(userId, 20, new Date()); // unrelated table, should not affect vote limit
    await seedVoteSets(userId, 5, new Date());

    expect(await checkAccountLimit(userId, 'vote', { count: 20, perHours: 24 })).toBe(true);

    await seedVoteSets(userId, 15, new Date()); // total 20 vote sets now
    expect(await checkAccountLimit(userId, 'vote', { count: 20, perHours: 24 })).toBe(false);
  });

  it("'upload' counts media by createdBy", async () => {
    const userId = await makeUser(USER_ID_BASE + 5);
    await seedFlags(userId, 20, new Date()); // unrelated table
    await seedMedia(userId, 29, new Date());

    expect(await checkAccountLimit(userId, 'upload', { count: 30, perHours: 24 })).toBe(true);

    await seedMedia(userId, 1, new Date()); // total 30 now
    expect(await checkAccountLimit(userId, 'upload', { count: 30, perHours: 24 })).toBe(false);
  });

  it("'eoi' throws — eoi_submissions is anonymous, not per-account rate-limited", async () => {
    const userId = await makeUser(USER_ID_BASE + 6);
    await expect(
      checkAccountLimit(userId, 'eoi', { count: 5, perHours: 24 }),
    ).rejects.toThrow(/eoi/i);
  });

  it('checkDefaultLimit: flags default is 10/day — 9 rows → true, 10 rows → false', async () => {
    const userId = await makeUser(USER_ID_BASE + 7);
    await seedFlags(userId, 9, new Date());
    expect(await checkDefaultLimit(userId, 'flag')).toBe(true);

    await seedFlags(userId, 1, new Date()); // total 10
    expect(await checkDefaultLimit(userId, 'flag')).toBe(false);
  });

  it('DEFAULT_LIMITS matches the plan: flags 10/day, votes 20/day, uploads 30/day', () => {
    expect(DEFAULT_LIMITS).toEqual({
      flag: { count: 10, perHours: 24 },
      vote: { count: 20, perHours: 24 },
      upload: { count: 30, perHours: 24 },
    });
  });
});

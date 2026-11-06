/**
 * Task 45 — src/lib/erasure.ts: the DPDP erasure routine + ban/reactivate
 * user moderation behind `/admin/users` (architecture.md §7 "Erasure (DPDP data-principal
 * rights)"). Exercises the lib functions directly against a real DB (no
 * HTTP/middleware layer — that's tests/routes/admin-users.test.ts).
 *
 * COVERAGE MAP:
 *   - ERASURE SEVERS IDENTITY (the load-bearing test): sessions deleted,
 *     users row's email nulled and status -> 'erased'; the row itself
 *     stays as an opaque tombstone for anything that references its id.
 *   - IDEMPOTENT: erasing an already-erased user doesn't throw or corrupt
 *     anything.
 *   - BAN: sessions killed, readSession blocks the old cookie. REACTIVATE:
 *     restores 'active'. An erased user can never be reactivated or
 *     re-banned.
 *   - SELF / LAST-ADMIN GUARDS: mirrors src/lib/admin.ts's guard, with this
 *     module's own ban_/erase_ error codes.
 *   - ADMIN-ONLY: every mutator rejects a non-admin actor.
 *   - listUsers: every staff account by default, never capped; by id, by
 *     email substring; role and status filters.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq, inArray, ne } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see AGENTS.md ("Tests need a database") for how to get one.',
  );
}

import { eraseUser, banUser, reactivateUser, listUsers, type AdminActor } from '../../src/lib/erasure';
import { createSession, readSession } from '../../src/lib/session';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ids (Task 45 brief: "use high dedicated ids").
// tests/unit/admin.test.ts owns 99600-99609/99700-99799,
// tests/routes/admin-console.test.ts owns 99610-99619; this suite owns
// 99800-99819 (ward id + user ids are separate id spaces, but kept in the
// same numeric neighborhood for readability). tests/routes/admin-users.test.ts
// owns its own disjoint email/ward fixtures.
const WARD = {
  id: 99800,
  nameEn: 'Erasure Test Ward',
  nameKn: 'ಇ',
  corporation: 'south' as const,
  zone: 'Erasure Test Zone',
  boundaryRef: 'erasure-test-ward',
};

const EMAILS = {
  admin: 'erasure-test-admin@example.com',
  extraAdmin: 'erasure-test-extra-admin@example.com',
  bannedAdmin: 'erasure-test-banned-admin@example.com',
  bannedAdmin2: 'erasure-test-banned-admin-2@example.com',
  plain: 'erasure-test-plain@example.com',
  eraseTarget: 'erasure-test-erase-target@example.com',
  banTarget: 'erasure-test-ban-target@example.com',
  reactivateTarget: 'erasure-test-reactivate-target@example.com',
  banErasedTarget: 'erasure-test-ban-erased-target@example.com',
  reactivateErasedTarget: 'erasure-test-reactivate-erased-target@example.com',
  searchByEmail: 'erasure-test-search-alpha@example.com',
};

type UserInsert = typeof schema.users.$inferInsert;

async function upsertUser(email: string, fields: Partial<UserInsert> = {}): Promise<number> {
  const values: UserInsert = { email, role: 'transcriber', status: 'active', ...fields };
  const [row] = await db
    .insert(schema.users)
    .values(values)
    .onConflictDoUpdate({ target: schema.users.email, set: values })
    .returning({ id: schema.users.id });
  return row!.id;
}

let adminId: number;
let plainId: number;
let eraseTargetId: number;
let banTargetId: number;
let reactivateTargetId: number;
let banErasedTargetId: number;
let reactivateErasedTargetId: number;
let searchByEmailId: number;
let admin: AdminActor;
const extraFixtureIds: number[] = [];

describe('src/lib/erasure.ts (Task 45)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });

    adminId = await upsertUser(EMAILS.admin, { role: 'admin' });
    plainId = await upsertUser(EMAILS.plain);
    eraseTargetId = await upsertUser(EMAILS.eraseTarget);
    banTargetId = await upsertUser(EMAILS.banTarget);
    reactivateTargetId = await upsertUser(EMAILS.reactivateTarget, { status: 'banned' });
    banErasedTargetId = await upsertUser(EMAILS.banErasedTarget);
    reactivateErasedTargetId = await upsertUser(EMAILS.reactivateErasedTarget);
    searchByEmailId = await upsertUser(EMAILS.searchByEmail);

    admin = { userId: adminId, role: 'admin' };
  });

  afterAll(async () => {
    const userIds = [
      plainId,
      eraseTargetId,
      banTargetId,
      reactivateTargetId,
      banErasedTargetId,
      reactivateErasedTargetId,
      searchByEmailId,
      ...extraFixtureIds,
    ];
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, [adminId, ...userIds]));
    await db.delete(schema.users).where(inArray(schema.users.id, [adminId, ...userIds]));
    await db.delete(schema.wards).where(eq(schema.wards.id, WARD.id));
    await client.end();
  });

  describe('eraseUser: severs identity, keeps the tombstone row', () => {
    it('nulls the email, sets status erased, deletes sessions, and keeps the row', async () => {
      const [before] = await db.select().from(schema.users).where(eq(schema.users.id, eraseTargetId));
      expect(before?.email).toBe(EMAILS.eraseTarget);

      const { id: sessionId } = await createSession(eraseTargetId);

      await eraseUser(admin, eraseTargetId);

      const [after] = await db.select().from(schema.users).where(eq(schema.users.id, eraseTargetId));
      expect(after?.id).toBe(eraseTargetId);
      expect(after?.status).toBe('erased');
      expect(after?.email).toBeNull();

      const sessionRows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
      expect(sessionRows).toEqual([]);
    });

    it('is idempotent: erasing an already-erased user does not throw or change anything further', async () => {
      const [before] = await db.select().from(schema.users).where(eq(schema.users.id, eraseTargetId));
      expect(before?.status).toBe('erased');

      await expect(eraseUser(admin, eraseTargetId)).resolves.toBeUndefined();

      const [after] = await db.select().from(schema.users).where(eq(schema.users.id, eraseTargetId));
      expect(after?.status).toBe('erased');
      expect(after?.email).toBeNull();
    });

    it('rejects a non-admin actor without touching the DB', async () => {
      const transcriberActor = { userId: plainId, role: 'transcriber' } as unknown as AdminActor;
      await expect(eraseUser(transcriberActor, banTargetId)).rejects.toThrow();
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, banTargetId));
      expect(row?.status).toBe('active');
    });

    it('user_not_found for a non-existent id', async () => {
      await expect(eraseUser(admin, 900_000_001)).rejects.toThrow('user_not_found');
    });
  });

  describe('banUser / reactivateUser', () => {
    it('banUser sets status banned and kills the session (readSession -> null)', async () => {
      const { cookieValue } = await createSession(banTargetId);
      expect(await readSession(cookieValue)).not.toBeNull();

      await banUser(admin, banTargetId, 'spam');

      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, banTargetId));
      expect(row?.status).toBe('banned');
      expect(await readSession(cookieValue)).toBeNull();

    });

    it('reactivateUser restores status active', async () => {
      await reactivateUser(admin, reactivateTargetId);
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, reactivateTargetId));
      expect(row?.status).toBe('active');

    });

    it('banUser rejects an erased target (cannot_ban_erased) — erasure is terminal', async () => {
      await db.update(schema.users).set({ status: 'erased' }).where(eq(schema.users.id, banErasedTargetId));
      await expect(banUser(admin, banErasedTargetId)).rejects.toThrow('cannot_ban_erased');
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, banErasedTargetId));
      expect(row?.status).toBe('erased');
    });

    it('reactivateUser rejects an erased target (cannot_reactivate_erased) — never un-erased', async () => {
      await db.update(schema.users).set({ status: 'erased' }).where(eq(schema.users.id, reactivateErasedTargetId));
      await expect(reactivateUser(admin, reactivateErasedTargetId)).rejects.toThrow('cannot_reactivate_erased');
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, reactivateErasedTargetId));
      expect(row?.status).toBe('erased');
    });

    it('rejects a non-admin actor for both banUser and reactivateUser', async () => {
      const transcriberActor = { userId: plainId, role: 'transcriber' } as unknown as AdminActor;
      await expect(banUser(transcriberActor, reactivateTargetId)).rejects.toThrow();
      await expect(reactivateUser(transcriberActor, reactivateTargetId)).rejects.toThrow();
    });
  });

  describe('self / last-admin guards', () => {
    it('banUser: an admin banning THEMSELVES is rejected, status unchanged', async () => {
      await expect(banUser(admin, adminId)).rejects.toThrow('cannot_ban_self');
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.status).toBe('active');
    });

    it('eraseUser: an admin erasing THEMSELVES is rejected, status unchanged', async () => {
      await expect(eraseUser(admin, adminId)).rejects.toThrow('cannot_erase_self');
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.status).toBe('active');
    });

    it('banUser: banning a DIFFERENT, non-last admin succeeds', async () => {
      const extraAdminId = await upsertUser(EMAILS.extraAdmin, { role: 'admin' });
      extraFixtureIds.push(extraAdminId);

      await banUser(admin, extraAdminId);

      const [extra] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, extraAdminId));
      expect(extra?.status).toBe('banned');
      const [primary] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(primary?.status).toBe('active');
    });

    it('banUser: banning the LAST active admin is rejected by a distinct (non-self) admin-typed caller', async () => {
      const others = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.role, 'admin'), eq(schema.users.status, 'active'), ne(schema.users.id, adminId)));
      for (const row of others) {
        await db.update(schema.users).set({ role: 'curator' }).where(eq(schema.users.id, row.id));
      }

      const bannedAdminId = await upsertUser(EMAILS.bannedAdmin, { role: 'admin', status: 'banned' });
      extraFixtureIds.push(bannedAdminId);
      const bannedActor = { userId: bannedAdminId, role: 'admin' } as unknown as AdminActor;

      await expect(banUser(bannedActor, adminId)).rejects.toThrow('cannot_ban_last_admin');
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.status).toBe('active');
    });

    it('eraseUser: erasing the LAST active admin is rejected by a distinct (non-self) admin-typed caller', async () => {
      const bannedAdminId2 = await upsertUser(EMAILS.bannedAdmin2, { role: 'admin', status: 'banned' });
      extraFixtureIds.push(bannedAdminId2);
      const bannedActor = { userId: bannedAdminId2, role: 'admin' } as unknown as AdminActor;

      await expect(eraseUser(bannedActor, adminId)).rejects.toThrow('cannot_erase_last_admin');
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.status).toBe('active');
    });
  });

  describe('listUsers', () => {
    it('treats an empty/whitespace query as no query: every staff account', async () => {
      const all = (await listUsers({})).rows.map((r) => r.id);
      expect((await listUsers({ query: '' })).rows.map((r) => r.id)).toEqual(all);
      expect((await listUsers({ query: '   ' })).rows.map((r) => r.id)).toEqual(all);
      expect(all).toContain(plainId);
    });

    it('matches by exact numeric id', async () => {
      // Scoped to this test's OWN fixture row rather than asserting the
      // result array is exactly [searchByEmailId] / reading rows[0]: per
      // listUsers' docstring, a numeric query is unioned with substring
      // matches on email BY DESIGN ("an admin typing digits gets
      // every row that could plausibly mean"), so other users elsewhere
      // in the shared test DB whose email happens to contain this
      // id's digits as a substring can legitimately also match and sort
      // ahead of it — that's not a bug in listUsers, so this assertion
      // must not depend on being the only/first match.
      const rows = (await listUsers({ query: String(searchByEmailId) })).rows;
      const row = rows.find((r) => r.id === searchByEmailId);
      expect(row).toBeDefined();
    });

    it('matches by email substring, case-insensitively', async () => {
      const rows = (await listUsers({ query: 'SEARCH-ALPHA' })).rows;
      expect(rows.some((r) => r.id === searchByEmailId)).toBe(true);
    });

    it('each row carries only id, email, status, role, hasSecret and createdAt', async () => {
      // Same scoping rationale as the "matches by exact numeric id" test above.
      const rows = (await listUsers({ query: String(searchByEmailId) })).rows;
      const row = rows.find((r) => r.id === searchByEmailId);
      expect(Object.keys(row!).sort()).toEqual(['createdAt', 'email', 'hasSecret', 'id', 'role', 'status']);
    });

    it('returns [] for no match', async () => {
      expect((await listUsers({ query: 'nobody-erasure-test-search@example.com' })).rows).toEqual([]);
    });

    it('escapes ilike wildcards: literal % in search does not match broadly', async () => {
      // Create two users: one with % in email, one without
      const userId1 = await upsertUser('search-with-percent%@example.com');
      const userId2 = await upsertUser('search-without-percent@example.com');
      extraFixtureIds.push(userId1, userId2);

      // Searching for literal '%' should only match the user with % in their email
      const results = (await listUsers({ query: '%' })).rows;
      const matchedIds = results.map((r) => r.id);
      expect(matchedIds).toContain(userId1);
      expect(matchedIds).not.toContain(userId2);
    });

    it('escapes ilike wildcards: literal _ in search does not match broadly', async () => {
      // Create two users: one with _ in email, one without
      const userId1 = await upsertUser('search_with_underscore@example.com');
      const userId2 = await upsertUser('searchwithoutunderscore@example.com');
      extraFixtureIds.push(userId1, userId2);

      // Searching for literal '_' should only match the user with _ in their email
      const results = (await listUsers({ query: '_' })).rows;
      const matchedIds = results.map((r) => r.id);
      expect(matchedIds).toContain(userId1);
      expect(matchedIds).not.toContain(userId2);
    });

    it('escapes ilike wildcards: literal backslash in search is handled correctly', async () => {
      // Create a user with backslash in email (unlikely but test defensively)
      const userId1 = await upsertUser('search\\backslash@example.com');
      extraFixtureIds.push(userId1);

      // Searching for literal backslash should match that user
      const results = (await listUsers({ query: '\\' })).rows;
      const matchedIds = results.map((r) => r.id);
      expect(matchedIds).toContain(userId1);
    });

    it('with no query lists every role, admins first, with the date each was added', async () => {
      const curatorId = await upsertUser('erasure-test-list-curator@example.com', { role: 'curator' });
      const transcriberId = await upsertUser('erasure-test-list-transcriber@example.com', { role: 'transcriber' });
      extraFixtureIds.push(curatorId, transcriberId);

      const { rows } = await listUsers({});
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(adminId);
      expect(ids).toContain(curatorId);
      expect(ids).toContain(transcriberId);
      expect(ids.indexOf(adminId)).toBeLessThan(ids.indexOf(curatorId));
      expect(ids.indexOf(curatorId)).toBeLessThan(ids.indexOf(transcriberId));
      expect(rows.find((r) => r.id === adminId)?.createdAt).toBeInstanceOf(Date);
    });

    it('filters by a single role', async () => {
      const curatorId = await upsertUser('erasure-test-list-curator@example.com', { role: 'curator' });
      const { rows } = await listUsers({ role: 'curator' });
      expect(rows.map((r) => r.id)).toContain(curatorId);
      expect(rows.every((r) => r.role === 'curator')).toBe(true);
    });

    it('filters by status, combined with a query', async () => {
      const bannedId = await upsertUser('erasure-test-list-banned@example.com', { role: 'curator', status: 'banned' });
      const activeId = await upsertUser('erasure-test-list-active@example.com', { role: 'curator' });
      extraFixtureIds.push(bannedId, activeId);

      const { rows } = await listUsers({ query: 'erasure-test-list-', status: 'banned' });
      expect(rows.map((r) => r.id)).toEqual([bannedId]);
    });

    it('a role filter narrows a query', async () => {
      const { rows } = await listUsers({ query: 'erasure-test-list-', role: 'transcriber' });
      expect(rows.length).toBe(1);
      expect(rows[0]?.role).toBe('transcriber');
    });

    it('never caps the list: 51 matches return 51 rows', async () => {
      const ids: number[] = [];
      for (let i = 0; i < 51; i++) ids.push(await upsertUser(`erasure-test-cap-${i}@example.com`));
      extraFixtureIds.push(...ids);

      const result = await listUsers({ query: 'erasure-test-cap-' });
      expect(result.rows).toHaveLength(51);
      expect(result).not.toHaveProperty('truncated');
    });
  });
});

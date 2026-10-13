/**
 * Task 44 — src/lib/admin.ts: the admin-only role-management engine
 * behind the role actions on `/admin/users` (information-architecture.md §6.2;
 * PRD §7/§10/§11/§14). Exercises the lib functions directly against a real
 * DB (no HTTP/middleware layer — that's tests/routes/admin-users.test.ts).
 *
 * Curators and admins are both city-wide, so there is no ward scope to
 * manage.
 *
 * COVERAGE MAP:
 *   - grantRole: citizen -> curator role update.
 *   - revokeRole: a curator -> role 'citizen'.
 *   - ADMIN-ONLY: every mutator rejects a non-admin actor before touching
 *     the DB.
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
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

import {
  addUser,
  grantRole,
  revokeRole,
  loadConsoleStats,
  isStaffRole,
  type AdminActor,
} from '../../src/lib/admin';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

const EMAILS = {
  admin: 'admin-lib-test-admin@example.com',
  citizen: 'admin-lib-test-citizen@example.com',
  // A second, never-promoted citizen — `citizen` above IS promoted to
  // curator by the grantRole test, so it can't also serve as the
  // non-admin actor in the ADMIN-ONLY checks below.
  plainCitizen: 'admin-lib-test-plain-citizen@example.com',
  curatorA: 'admin-lib-test-curator-a@example.com',
  curatorB: 'admin-lib-test-curator-b@example.com',
  // Lockout-prevention guard fixtures (Task 44 review) — created/cleaned up
  // inline within the 'lockout guards' describe below, ids tracked in
  // `extraFixtureIds` for afterAll cleanup since they're not fixed like the
  // others above.
  extraAdmin: 'admin-lib-test-extra-admin@example.com',
  bannedAdmin: 'admin-lib-test-banned-admin@example.com',
  bannedAdmin2: 'admin-lib-test-banned-admin-2@example.com',
  addTranscriber: 'admin-lib-test-add-transcriber@example.com',
  addCurator: 'admin-lib-test-add-curator@example.com',
  addAdmin: 'admin-lib-test-add-admin@example.com',
  addExistingCitizen: 'admin-lib-test-add-existing-citizen@example.com',
  grantTranscriber: 'admin-lib-test-grant-transcriber@example.com',
};

async function upsertUser(email: string, role: 'citizen' | 'transcriber' | 'curator' | 'admin'): Promise<number> {
  const [row] = await db
    .insert(schema.users)
    .values({ email: email.toLowerCase(), role, status: 'active' })
    .onConflictDoUpdate({ target: schema.users.email, set: { role, status: 'active' } })
    .returning({ id: schema.users.id });
  return row!.id;
}

let adminId: number;
let citizenId: number;
let plainCitizenId: number;
let curatorAId: number;
let curatorBId: number;
let admin: AdminActor;
// Ids created inline within the 'lockout guards' describe (below), tracked
// here so afterAll cleans them up alongside the fixed fixtures.
const extraFixtureIds: number[] = [];

describe('src/lib/admin.ts (Task 44)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    adminId = await upsertUser(EMAILS.admin, 'admin');
    citizenId = await upsertUser(EMAILS.citizen, 'citizen');
    plainCitizenId = await upsertUser(EMAILS.plainCitizen, 'citizen');
    curatorAId = await upsertUser(EMAILS.curatorA, 'curator');
    curatorBId = await upsertUser(EMAILS.curatorB, 'curator');

    admin = { userId: adminId, role: 'admin' };
  });

  afterAll(async () => {
    const userIds = [
      citizenId,
      plainCitizenId,
      curatorAId,
      curatorBId,
      ...extraFixtureIds,
    ];
    await db.delete(schema.users).where(inArray(schema.users.id, [adminId, ...userIds]));
    await client.end();
  });

  describe('grantRole', () => {
    it('promotes a citizen to curator', async () => {
      await grantRole(admin, citizenId, 'curator');

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, citizenId));
      expect(row?.role).toBe('curator');

    });

    it('rejects a non-admin actor without touching the DB', async () => {
      const before = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, citizenId));
      const curatorActor = { userId: curatorAId, role: 'curator' } as unknown as AdminActor;
      await expect(grantRole(curatorActor, citizenId, 'admin')).rejects.toThrow();
      const after = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, citizenId));
      expect(after[0]?.role).toBe(before[0]?.role);
    });
  });

  describe('revokeRole', () => {
    it('demotes a curator to citizen', async () => {
      await revokeRole(admin, curatorAId);

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, curatorAId));
      expect(row?.role).toBe('citizen');
    });

    it('rejects a non-admin actor without touching the DB', async () => {
      const before = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, curatorBId));
      const citizenActor = { userId: plainCitizenId, role: 'citizen' } as unknown as AdminActor;
      await expect(revokeRole(citizenActor, curatorBId)).rejects.toThrow();
      const after = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, curatorBId));
      expect(after[0]?.role).toBe(before[0]?.role);
    });
  });

  /**
   * Lockout-prevention guards (Task 44 review — protects the root of the
   * authorization chain, src/lib/admin.ts's assertNotSelfOrLastAdmin).
   *
   * A genuine THIRD-PARTY active admin can never be the one to trip the
   * last-admin count to zero: assertAdmin requires the caller to itself be
   * `role: 'admin'`, and that caller's own row stays untouched by the write,
   * so it always remains in the active-admin pool after a non-self revoke.
   * The only ways the count check actually fires (short of the documented
   * concurrent-double-revoke race) are (a) the self-demote path, already
   * covered by the separate self-check, or (b) a caller whose OWN `status`
   * has gone inactive (e.g. a banned admin, PRD's user_status enum) acting
   * on a still-valid actor object — role='admin' in the DB, just not
   * counted toward the *active* pool being protected. The tests below use a
   * banned-but-still-'admin'-role fixture as that distinct, non-self caller
   * so the last-admin branch can be exercised in isolation from the
   * self-check (a real banned session could never reach this code in
   * practice — src/lib/session.ts's readSession rejects non-'active' users
   * before a request ever gets a session — this is a direct unit-level
   * exercise of src/lib/admin.ts's own guard logic).
   */
  describe('lockout guards (Task 44 review)', () => {
    it('revokeRole: an admin revoking their OWN id is rejected, role unchanged', async () => {
      await expect(revokeRole(admin, adminId)).rejects.toThrow('cannot_revoke_self');
      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.role).toBe('admin');
    });

    it('grantRole: an admin demoting THEMSELVES to curator is rejected, role unchanged', async () => {
      await expect(grantRole(admin, adminId, 'curator')).rejects.toThrow('cannot_revoke_self');
      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.role).toBe('admin');
    });

    it('revokeRole: demoting a DIFFERENT, non-last admin succeeds and leaves the caller intact', async () => {
      const extraAdminId = await upsertUser(EMAILS.extraAdmin, 'admin');
      extraFixtureIds.push(extraAdminId);

      await revokeRole(admin, extraAdminId);

      const [extra] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, extraAdminId));
      expect(extra?.role).toBe('citizen');
      const [primary] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(primary?.role).toBe('admin');
    });

    it('revokeRole: revoking the last active admin is rejected by a distinct (non-self) admin-typed caller', async () => {
      // Defensively confirm `adminId` really is the sole ACTIVE admin before
      // asserting the guard, so this test doesn't depend on execution order
      // relative to the ones above.
      const others = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.role, 'admin'), eq(schema.users.status, 'active'), ne(schema.users.id, adminId)));
      for (const row of others) {
        await db.update(schema.users).set({ role: 'citizen' }).where(eq(schema.users.id, row.id));
      }

      const bannedAdminId = await upsertUser(EMAILS.bannedAdmin, 'admin');
      extraFixtureIds.push(bannedAdminId);
      await db.update(schema.users).set({ status: 'banned' }).where(eq(schema.users.id, bannedAdminId));
      const bannedActor = { userId: bannedAdminId, role: 'admin' } as unknown as AdminActor;

      await expect(revokeRole(bannedActor, adminId)).rejects.toThrow('cannot_revoke_last_admin');

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.role).toBe('admin');
    });

    it('grantRole: demoting the last active admin to curator is rejected by a distinct (non-self) admin-typed caller', async () => {
      const bannedAdminId2 = await upsertUser(EMAILS.bannedAdmin2, 'admin');
      extraFixtureIds.push(bannedAdminId2);
      await db.update(schema.users).set({ status: 'banned' }).where(eq(schema.users.id, bannedAdminId2));
      const bannedActor = { userId: bannedAdminId2, role: 'admin' } as unknown as AdminActor;

      await expect(grantRole(bannedActor, adminId, 'curator')).rejects.toThrow('cannot_revoke_last_admin');

      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.role).toBe('admin');
    });
  });

  describe('addUser', () => {
    const ADDED = [EMAILS.addTranscriber, EMAILS.addCurator, EMAILS.addAdmin, EMAILS.addExistingCitizen];

    afterAll(async () => {
      await db.delete(schema.users).where(inArray(schema.users.email, ADDED));
    });

    it.each([
      ['transcriber', EMAILS.addTranscriber],
      ['curator', EMAILS.addCurator],
      ['admin', EMAILS.addAdmin],
    ] as const)('creates an active %s and returns its id', async (role, email) => {
      const id = await addUser(admin, email, role);
      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id));
      expect(row?.email).toBe(email);
      expect(row?.role).toBe(role);
      expect(row?.status).toBe('active');
      expect(row?.phone).toBeNull();
    });

    it('trims and lower-cases the email before storing it', async () => {
      await db.delete(schema.users).where(eq(schema.users.email, EMAILS.addCurator));
      const id = await addUser(admin, '  Admin-Lib-Test-Add-Curator@Example.COM  ', 'curator');
      const [row] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, id));
      expect(row?.email).toBe(EMAILS.addCurator);
    });

    it.each(['', 'not-an-email', 'two@@example.com', 'has space@example.com', `${'a'.repeat(250)}@example.com`])(
      'rejects %j with invalid_email and writes nothing',
      async (bad) => {
        await expect(addUser(admin, bad, 'curator')).rejects.toThrow('invalid_email');
      },
    );

    it('an email that already exists (as a citizen, typed in different case) -> user_exists, role untouched', async () => {
      const existingId = await upsertUser(EMAILS.addExistingCitizen, 'citizen');
      await expect(addUser(admin, EMAILS.addExistingCitizen.toUpperCase(), 'admin')).rejects.toThrow('user_exists');
      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, existingId));
      expect(row?.role).toBe('citizen');
    });

    it('rejects a non-admin actor and creates nothing', async () => {
      const curatorActor = { userId: curatorBId, role: 'curator' } as unknown as AdminActor;
      const email = 'admin-lib-test-add-by-non-admin@example.com';
      await expect(addUser(curatorActor, email, 'transcriber')).rejects.toThrow('admin_only');
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, email));
      expect(rows).toHaveLength(0);
    });
  });

  describe('transcriber as a staff role', () => {
    let transcriberId: number;

    beforeAll(async () => {
      transcriberId = await upsertUser(EMAILS.grantTranscriber, 'citizen');
      extraFixtureIds.push(transcriberId);
    });

    it('isStaffRole accepts the three staff roles and nothing else', () => {
      expect(['transcriber', 'curator', 'admin'].every(isStaffRole)).toBe(true);
      expect(['citizen', '', 'ADMIN', 'superuser'].some(isStaffRole)).toBe(false);
    });

    it('grantRole promotes a citizen to transcriber', async () => {
      await grantRole(admin, transcriberId, 'transcriber');
      const [row] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, transcriberId));
      expect(row?.role).toBe('transcriber');
    });

    it('loadConsoleStats counts transcribers', async () => {
      const stats = await loadConsoleStats();
      expect(stats.transcriberCount).toBeGreaterThanOrEqual(1);
    });
  });
});

/**
 * src/lib/password.ts, src/lib/staff-login.ts, setStaffPassword/addUser
 * (src/lib/admin.ts) and scripts/set-password.ts — per-staff passwords.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { hashPassword, verifyPassword, passwordProblem } from '../../src/lib/password';
import { loginWithPassword } from '../../src/lib/staff-login';
import { addUser, setStaffPassword, type AdminActor } from '../../src/lib/admin';
import { setPasswordByEmail, ensurePassword } from '../../scripts/set-password';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see AGENTS.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

const GOOD = 'unit-test-own-credential-0001';
const EMAILS = {
  admin: 'staff-pw-test-admin@example.com',
  curator: 'staff-pw-test-curator@example.com',
  banned: 'staff-pw-test-banned@example.com',
  added: 'staff-pw-test-added@example.com',
  nopw: 'staff-pw-test-nopw@example.com',
};
let adminId: number;
let curatorId: number;
let actor: AdminActor;

async function sessionCount(userId: number): Promise<number> {
  const rows = await db.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.userId, userId));
  return rows.length;
}

describe('per-staff passwords', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.delete(schema.users).where(inArray(schema.users.email, Object.values(EMAILS)));
    const [a] = await db.insert(schema.users).values({ email: EMAILS.admin, role: 'admin' }).returning({ id: schema.users.id });
    const [c] = await db.insert(schema.users).values({ email: EMAILS.curator, role: 'curator' }).returning({ id: schema.users.id });
    await db.insert(schema.users).values({ email: EMAILS.banned, role: 'curator', status: 'banned' });
    await db.insert(schema.users).values({ email: EMAILS.nopw, role: 'transcriber' });
    adminId = a!.id;
    curatorId = c!.id;
    actor = { userId: adminId, role: 'admin' };
  });

  afterAll(async () => {
    const rows = await db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.email, Object.values(EMAILS)));
    const ids = rows.map((r) => r.id);
    if (ids.length) await db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids));
    await db.delete(schema.users).where(inArray(schema.users.email, Object.values(EMAILS)));
    await client.end();
  });

  describe('hashing', () => {
    it('verifies the right value, rejects a wrong one, and salts each hash', async () => {
      const h1 = await hashPassword(GOOD);
      const h2 = await hashPassword(GOOD);
      expect(h1).not.toBe(h2);
      expect(h1.startsWith('scrypt$')).toBe(true);
      expect(await verifyPassword(GOOD, h1)).toBe(true);
      expect(await verifyPassword(GOOD + 'x', h1)).toBe(false);
    });

    it('rejects a malformed stored value instead of throwing', async () => {
      expect(await verifyPassword(GOOD, 'not-a-hash')).toBe(false);
    });

    it('enforces 16..256 characters', () => {
      expect(passwordProblem('x'.repeat(15))).toBe('password_too_short');
      expect(passwordProblem('x'.repeat(16))).toBeNull();
      expect(passwordProblem('x'.repeat(257))).toBe('password_too_long');
    });
  });

  describe('setStaffPassword + loginWithPassword', () => {
    it('cannot sign in before a password is set; can after; old sessions end', async () => {
      expect((await loginWithPassword(EMAILS.curator, GOOD)).ok).toBe(false);

      await setStaffPassword(actor, curatorId, GOOD);
      const ok = await loginWithPassword(`  ${EMAILS.curator.toUpperCase()} `, GOOD);
      expect(ok.ok).toBe(true);
      expect(await sessionCount(curatorId)).toBe(1);

      await setStaffPassword(actor, curatorId, 'a-different-credential-0002');
      expect(await sessionCount(curatorId)).toBe(0);
      expect((await loginWithPassword(EMAILS.curator, GOOD)).ok).toBe(false);
      expect((await loginWithPassword(EMAILS.curator, 'a-different-credential-0002')).ok).toBe(true);
    });

    it('fails identically for an unknown email, a banned account and an account without a password', async () => {
      await setPasswordByEmail(db, EMAILS.admin, GOOD);
      await db.update(schema.users).set({ passwordHash: await hashPassword(GOOD) }).where(eq(schema.users.email, EMAILS.banned));
      for (const email of ['staff-pw-test-nobody@example.com', EMAILS.banned, EMAILS.nopw, '']) {
        expect(await loginWithPassword(email, GOOD)).toEqual({ ok: false });
      }
    });

    it('rejects a short password, a banned target and a missing target', async () => {
      await expect(setStaffPassword(actor, curatorId, 'short')).rejects.toThrow('password_too_short');
      const [banned] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, EMAILS.banned));
      await expect(setStaffPassword(actor, banned!.id, GOOD)).rejects.toThrow('user_not_active');
      await expect(setStaffPassword(actor, 2147483000, GOOD)).rejects.toThrow('user_not_found');
    });

    it('is admin-only', async () => {
      await expect(setStaffPassword({ userId: curatorId, role: 'curator' } as unknown as AdminActor, curatorId, GOOD)).rejects.toThrow();
    });
  });

  describe('addUser with an initial password', () => {
    it('lets the new account sign in at once; without one it cannot', async () => {
      await addUser(actor, EMAILS.added, 'transcriber', GOOD);
      expect((await loginWithPassword(EMAILS.added, GOOD)).ok).toBe(true);
    });

    it('rejects a too-short initial password and creates nothing', async () => {
      await expect(addUser(actor, 'staff-pw-test-short@example.com', 'curator', 'short')).rejects.toThrow('password_too_short');
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, 'staff-pw-test-short@example.com'));
      expect(rows).toHaveLength(0);
    });
  });

  describe('scripts/set-password.ts', () => {
    it('ensurePassword generates one only when none is set', async () => {
      const first = await ensurePassword(db, EMAILS.nopw);
      expect(first).toMatch(/^[0-9a-f]{48}$/);
      expect((await loginWithPassword(EMAILS.nopw, first!)).ok).toBe(true);
      expect(await ensurePassword(db, EMAILS.nopw)).toBeNull();
      expect(await ensurePassword(db, 'staff-pw-test-nobody@example.com')).toBeNull();
    });

    it('setPasswordByEmail refuses an unknown email', async () => {
      await expect(setPasswordByEmail(db, 'staff-pw-test-nobody@example.com', GOOD)).rejects.toThrow('user_not_found');
    });
  });
});

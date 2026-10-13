/**
 * src/lib/master-login.ts — the TEMPORARY master-password login, in place
 * only until email works for OTP. Real Postgres, no mocks: the module's
 * whole job is "right password + existing active user -> a real session".
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE } from '../../src/lib/session';
import { masterLoginEnabled, loginWithMasterPassword } from '../../src/lib/master-login';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

const PASSWORD = 'unit-test-master-password-0001';
const EMAILS = {
  admin: 'master-login-test-admin@example.com',
  banned: 'master-login-test-banned@example.com',
};
const CITIZEN_PHONE = '+919900055501';
// An erased account normally has a null contact; this fixture keeps one so the
// lookup FINDS the row and the status check is what rejects it.
const ERASED_PHONE = '+919900055502';

let adminId: number;
let bannedId: number;
let phoneCitizenId: number;
let erasedId: number;

async function sessionCount(userId: number): Promise<number> {
  const rows = await db.select({ id: schema.sessions.id }).from(schema.sessions).where(inArray(schema.sessions.userId, [userId]));
  return rows.length;
}

describe('src/lib/master-login.ts (temporary)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    const upsert = async (values: typeof schema.users.$inferInsert, target: 'email' | 'phone') => {
      const [row] = await db
        .insert(schema.users)
        .values(values)
        .onConflictDoUpdate({ target: schema.users[target], set: values })
        .returning({ id: schema.users.id });
      return row!.id;
    };
    adminId = await upsert({ email: EMAILS.admin, role: 'admin', status: 'active' }, 'email');
    bannedId = await upsert({ email: EMAILS.banned, role: 'curator', status: 'banned' }, 'email');
    phoneCitizenId = await upsert({ phone: CITIZEN_PHONE, role: 'citizen', status: 'active' }, 'phone');
    erasedId = await upsert({ phone: ERASED_PHONE, role: 'citizen', status: 'erased' }, 'phone');
  });

  afterEach(async () => {
    delete process.env.MASTER_PASSWORD;
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, [adminId, bannedId, phoneCitizenId, erasedId]));
  });

  afterAll(async () => {
    await db.delete(schema.users).where(inArray(schema.users.id, [adminId, bannedId, phoneCitizenId, erasedId]));
    await client.end();
  });

  describe('masterLoginEnabled', () => {
    it('is false when MASTER_PASSWORD is unset', () => {
      expect(masterLoginEnabled()).toBe(false);
    });

    it('is false when MASTER_PASSWORD is empty', () => {
      process.env.MASTER_PASSWORD = '';
      expect(masterLoginEnabled()).toBe(false);
    });

    it('is true for a password of 16 or more characters', () => {
      process.env.MASTER_PASSWORD = 'x'.repeat(16);
      expect(masterLoginEnabled()).toBe(true);
    });

    it('throws for a password shorter than 16 characters', () => {
      process.env.MASTER_PASSWORD = 'x'.repeat(15);
      expect(() => masterLoginEnabled()).toThrow('MASTER_PASSWORD must be at least 16 characters');
    });
  });

  describe('loginWithMasterPassword', () => {
    it('returns ok:false when password mode is off, even with a matching string', async () => {
      const result = await loginWithMasterPassword(EMAILS.admin, PASSWORD);
      expect(result.ok).toBe(false);
      expect(await sessionCount(adminId)).toBe(0);
    });

    it('right password + active user -> a session cookie and a sessions row', async () => {
      process.env.MASTER_PASSWORD = PASSWORD;
      const result = await loginWithMasterPassword(EMAILS.admin, PASSWORD);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.setCookie).toContain(`${SESSION_COOKIE}=`);
      expect(await sessionCount(adminId)).toBe(1);
    });

    it('normalizes the contact: mixed case and surrounding spaces still match', async () => {
      process.env.MASTER_PASSWORD = PASSWORD;
      const result = await loginWithMasterPassword('  Master-Login-Test-Admin@Example.COM ', PASSWORD);
      expect(result.ok).toBe(true);
    });

    it('signs in a citizen by phone number', async () => {
      process.env.MASTER_PASSWORD = PASSWORD;
      const result = await loginWithMasterPassword(` ${CITIZEN_PHONE} `, PASSWORD);
      expect(result.ok).toBe(true);
      expect(await sessionCount(phoneCitizenId)).toBe(1);
    });

    it.each([
      ['a wrong password', EMAILS.admin, 'not-the-master-password-0001'],
      ['the right password plus a trailing space', EMAILS.admin, `${PASSWORD} `],
      ['an empty password', EMAILS.admin, ''],
      ['an unknown contact', 'master-login-test-nobody@example.com', PASSWORD],
      ['an empty contact', '', PASSWORD],
      ['a banned account', EMAILS.banned, PASSWORD],
      ['an erased account', ERASED_PHONE, PASSWORD],
    ])('%s -> ok:false and no session', async (_label, destination, password) => {
      process.env.MASTER_PASSWORD = PASSWORD;
      const result = await loginWithMasterPassword(destination, password);
      expect(result).toEqual({ ok: false });
      expect(await sessionCount(adminId)).toBe(0);
      expect(await sessionCount(bannedId)).toBe(0);
      expect(await sessionCount(erasedId)).toBe(0);
    });
  });
});

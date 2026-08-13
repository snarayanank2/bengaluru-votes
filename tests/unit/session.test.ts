import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { createSession, readSession, destroySession, SESSION_COOKIE } from '../../src/lib/session';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// A distinctive fixture email (not a hardcoded numeric id, since `users.id`
// is a serial — see votes.test.ts for the same convention) so this suite
// never collides with another test file's user fixtures in the shared test DB.
const EMAIL = 'session-lib-fixture@example.com';
let userId: number;

async function resetUser(): Promise<void> {
  await db
    .update(schema.users)
    .set({ status: 'active', role: 'citizen' })
    .where(eq(schema.users.id, userId));
}

describe('signed sliding sessions (src/lib/session.ts)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    const [user] = await db
      .insert(schema.users)
      .values({ email: EMAIL, role: 'citizen', status: 'active' })
      .onConflictDoUpdate({
        target: schema.users.email,
        set: { role: 'citizen', status: 'active' },
      })
      .returning({ id: schema.users.id });
    userId = user!.id;
  });

  afterAll(async () => {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.end();
  });

  beforeEach(async () => {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await resetUser();
  });

  it('exposes the fixed cookie name', () => {
    expect(SESSION_COOKIE).toBe('bv_session');
  });

  it('createSession inserts a row and returns a well-formed cookie value', async () => {
    const { id, cookieValue, setCookie } = await createSession(userId);

    expect(cookieValue).toBe(`${id}.${cookieValue.split('.')[1]}`);
    expect(cookieValue.split('.')).toHaveLength(2);
    expect(id).toMatch(/^[0-9a-f]{64}$/);

    const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
    expect(row).toBeDefined();
    expect(row!.userId).toBe(userId);

    const deltaMs = row!.expiresAt.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(59 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);

    expect(setCookie).toContain(`${SESSION_COOKIE}=${cookieValue}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=3600');
  });

  it('round trip: create -> read -> correct user/role', async () => {
    const { cookieValue } = await createSession(userId);
    const result = await readSession(cookieValue);
    expect(result).toEqual({ userId, role: 'citizen' });
  });

  it('round trip reflects the user\'s current role', async () => {
    await db.update(schema.users).set({ role: 'curator' }).where(eq(schema.users.id, userId));
    const { cookieValue } = await createSession(userId);
    const result = await readSession(cookieValue);
    expect(result).toEqual({ userId, role: 'curator' });
  });

  it('tampered HMAC -> null', async () => {
    const { cookieValue } = await createSession(userId);
    const [id, hmac] = cookieValue.split('.');
    const flipped = hmac![0] === 'a' ? 'b' : 'a';
    const tampered = `${id}.${flipped}${hmac!.slice(1)}`;

    expect(await readSession(tampered)).toBeNull();
  });

  it('tampered id -> null (no matching row, or hmac no longer verifies)', async () => {
    const { cookieValue } = await createSession(userId);
    const [id, hmac] = cookieValue.split('.');
    const flipped = id![0] === 'a' ? 'b' : 'a';
    const tamperedId = `${flipped}${id!.slice(1)}`;

    expect(await readSession(`${tamperedId}.${hmac}`)).toBeNull();
  });

  it.each([
    ['no dot', 'abcdef1234567890'],
    ['empty string', ''],
    ['too many segments', 'aa.bb.cc'],
    ['empty id segment', '.abcd'],
    ['empty hmac segment', 'abcd.'],
  ])('malformed cookie (%s) -> null, no throw', async (_label, value) => {
    await expect(readSession(value)).resolves.toBeNull();
  });

  it('non-hex hmac (decodes to wrong byte length) -> null, no throw (length-guard path)', async () => {
    const { id } = await createSession(userId);
    await expect(readSession(`${id}.zz`)).resolves.toBeNull();
  });

  it('hmac of correct-looking-but-wrong length -> null, no throw (timing-safe length guard)', async () => {
    const { id } = await createSession(userId);
    // 'abcd' is valid hex but decodes to 2 bytes, not the 32 expected --
    // exercises the length check that runs before timingSafeEqual.
    await expect(readSession(`${id}.abcd`)).resolves.toBeNull();
  });

  it('expired session -> null', async () => {
    const { id, cookieValue } = await createSession(userId);
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessions.id, id));

    expect(await readSession(cookieValue)).toBeNull();
  });

  it('banned user -> null even with a valid session row', async () => {
    const { cookieValue } = await createSession(userId);
    await db.update(schema.users).set({ status: 'banned' }).where(eq(schema.users.id, userId));

    expect(await readSession(cookieValue)).toBeNull();
  });

  it('erased user -> null even with a valid session row', async () => {
    const { cookieValue } = await createSession(userId);
    await db.update(schema.users).set({ status: 'erased' }).where(eq(schema.users.id, userId));

    expect(await readSession(cookieValue)).toBeNull();
  });

  it('sliding: a read well within the 1h window does NOT change expiresAt (write-behind)', async () => {
    const { id, cookieValue } = await createSession(userId);
    const [before] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));

    await readSession(cookieValue);

    const [after] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
    expect(after!.expiresAt.getTime()).toBe(before!.expiresAt.getTime());
  });

  it('sliding: a read past the refresh threshold pushes expiresAt back out to ~now+1h', async () => {
    const { id, cookieValue } = await createSession(userId);
    // Simulate ~52 minutes elapsed: only 8 minutes remain, well under the
    // 55-minute-remaining refresh threshold.
    const agedExpiry = new Date(Date.now() + 8 * 60 * 1000);
    await db.update(schema.sessions).set({ expiresAt: agedExpiry }).where(eq(schema.sessions.id, id));

    const result = await readSession(cookieValue);
    expect(result).toEqual({ userId, role: 'citizen' });

    const [after] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
    const deltaMs = after!.expiresAt.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(55 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
  });

  it('destroySession removes the row -> subsequent readSession is null', async () => {
    const { id, cookieValue } = await createSession(userId);
    await destroySession(cookieValue);

    const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
    expect(row).toBeUndefined();
    expect(await readSession(cookieValue)).toBeNull();
  });

  it('destroySession on an already-gone / malformed cookie is a silent no-op', async () => {
    const { cookieValue } = await createSession(userId);
    await destroySession(cookieValue);
    await expect(destroySession(cookieValue)).resolves.toBeUndefined();
    await expect(destroySession('not-a-valid-cookie')).resolves.toBeUndefined();
  });
});

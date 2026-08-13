import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { GET as meGET } from '../../src/pages/api/me';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward ids (task-28 brief) — other route suites own
// 94xxx-98xxx/99001; this suite owns 99101/99102.
const HOME_WARD = {
  id: 99101,
  nameEn: 'Me Route Test Home Ward',
  nameKn: 'ನನ್ನ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ಮನೆ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'me-route-test-home-ward',
};
const OTHER_WARD = {
  id: 99102,
  nameEn: 'Me Route Test Other Ward',
  nameKn: 'ನನ್ನ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ಇತರ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'me-route-test-other-ward',
};

const NO_VOTE_EMAIL = 'me-route-no-vote@example.com';
const ACTIVE_VOTE_EMAIL = 'me-route-active-vote@example.com';
const PHONE = '+919000099101';

const FIXTURE_EMAILS = [NO_VOTE_EMAIL, ACTIVE_VOTE_EMAIL];

async function resetFixtures(): Promise<void> {
  const fixtureUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, NO_VOTE_EMAIL));
  const activeVoteUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, ACTIVE_VOTE_EMAIL));
  const ids = [...fixtureUsers, ...activeVoteUsers].map((u) => u.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await db.delete(schema.issueVoteSets).where(eq(schema.issueVoteSets.userId, id));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    }
  }
  for (const email of FIXTURE_EMAILS) {
    await db.delete(schema.users).where(eq(schema.users.email, email));
  }
}

describe('GET /api/me (Task 28, architecture.md §5 cache invariant)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(HOME_WARD).onConflictDoUpdate({ target: schema.wards.id, set: HOME_WARD });
    await db.insert(schema.wards).values(OTHER_WARD).onConflictDoUpdate({ target: schema.wards.id, set: OTHER_WARD });
    await resetFixtures();
  });

  afterAll(async () => {
    await resetFixtures();
    await client.end();
  });

  it('anonymous (no session): {anonymous:true}, no-store, no set-cookie', async () => {
    const res = await meGET({ locals: { session: null } } as any);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.json()).toEqual({ anonymous: true });
  });

  describe('authed', () => {
    it('no active issue_vote_sets row -> full shape with alreadyVotedWardId: null, no PII', async () => {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: NO_VOTE_EMAIL,
          phone: PHONE,
          homeWardId: HOME_WARD.id,
          language: 'kn',
          role: 'citizen',
          status: 'active',
        })
        .returning();

      const res = await meGET({ locals: { session: { userId: user!.id, role: 'citizen' } } } as any);

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.json();
      expect(body).toEqual({
        anonymous: false,
        userId: user!.id,
        role: 'citizen',
        homeWardId: HOME_WARD.id,
        language: 'kn',
        alreadyVotedWardId: null,
      });

      const raw = JSON.stringify(body);
      expect(raw).not.toContain(NO_VOTE_EMAIL);
      expect(raw).not.toContain(PHONE);
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('phone');
    });

    it('an active issue_vote_sets row -> alreadyVotedWardId matches its wardId', async () => {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: ACTIVE_VOTE_EMAIL,
          homeWardId: HOME_WARD.id,
          language: 'en',
          role: 'citizen',
          status: 'active',
        })
        .returning();

      // A retired (inactive) set for a DIFFERENT ward, to prove only the
      // active row is consulted.
      await db.insert(schema.issueVoteSets).values({ userId: user!.id, wardId: OTHER_WARD.id, active: false });
      await db.insert(schema.issueVoteSets).values({ userId: user!.id, wardId: OTHER_WARD.id, active: true });

      const res = await meGET({ locals: { session: { userId: user!.id, role: 'citizen' } } } as any);
      const body = await res.json();

      expect(body.anonymous).toBe(false);
      expect(body.alreadyVotedWardId).toBe(OTHER_WARD.id);
    });
  });
});

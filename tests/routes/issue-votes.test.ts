import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';
import { randomUUID } from 'node:crypto';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 5 });
const db = drizzle(client, { schema });

// High, task-specific ward ids (Task 33 brief) — this suite owns
// 99331 (home ward) / 99332 (a different ward, for the wrong_ward case).
const HOME_WARD_ID = 99331;
const OTHER_WARD_ID = 99332;

let userId: number;
let issueA: number;
let issueB: number;
let issueC: number;
let issueD: number;

function putReq(body: unknown): Request {
  return new Request('http://localhost/api/issue-votes', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getUrl(wardId: number | string): URL {
  return new URL(`http://localhost/api/issue-votes?wardId=${wardId}`);
}

vi.mock('../../src/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/rate-limit')>();
  return { ...actual, checkDefaultLimit: vi.fn() };
});

import { checkDefaultLimit } from '../../src/lib/rate-limit';
import { PUT as issueVotesPUT, GET as issueVotesGET } from '../../src/pages/api/issue-votes';

describe('PUT/GET /api/issue-votes (Task 33, PRD §5.5)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    for (const ward of [
      {
        id: HOME_WARD_ID,
        nameEn: 'Issue Votes Route Test Home Ward',
        nameKn: 'ಮತ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ಮನೆ ವಾರ್ಡ್',
        corporation: 'south' as const,
        zone: 'Zone V',
        boundaryRef: 'issue-votes-route-test-home-ward',
      },
      {
        id: OTHER_WARD_ID,
        nameEn: 'Issue Votes Route Test Other Ward',
        nameKn: 'ಮತ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ಇತರ ವಾರ್ಡ್',
        corporation: 'south' as const,
        zone: 'Zone V',
        boundaryRef: 'issue-votes-route-test-other-ward',
      },
    ]) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }

    const [user] = await db
      .insert(schema.users)
      .values({
        email: `issue-votes-route-test-user-${randomUUID()}@example.com`,
        homeWardId: HOME_WARD_ID,
        role: 'citizen',
        status: 'active',
      })
      .returning();
    userId = user!.id;

    const issues = await db
      .insert(schema.wardIssues)
      .values([
        { wardId: HOME_WARD_ID, titleEn: 'Roads', titleKn: 'Roads (kn)', position: 0 },
        { wardId: HOME_WARD_ID, titleEn: 'Water', titleKn: 'Water (kn)', position: 1 },
        { wardId: HOME_WARD_ID, titleEn: 'Waste', titleKn: 'Waste (kn)', position: 2 },
        { wardId: HOME_WARD_ID, titleEn: 'Lighting', titleKn: 'Lighting (kn)', position: 3 },
      ])
      .returning({ id: schema.wardIssues.id });
    [issueA, issueB, issueC, issueD] = issues.map((i) => i.id);
  });

  afterAll(async () => {
    await client.end();
  });

  describe('PUT', () => {
    it('anonymous (no session) -> 401, no-store', async () => {
      vi.mocked(checkDefaultLimit).mockResolvedValue(true);

      const res = await issueVotesPUT({
        request: putReq({ wardId: HOME_WARD_ID, issueIds: [issueA] }),
        locals: { session: null },
      } as any);

      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('wrong ward (not the citizen\'s home ward) -> 403 {error: "wrong_ward"}', async () => {
      vi.mocked(checkDefaultLimit).mockResolvedValue(true);

      const res = await issueVotesPUT({
        request: putReq({ wardId: OTHER_WARD_ID, issueIds: [issueA] }),
        locals: { session: { userId, role: 'citizen' } },
      } as any);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'wrong_ward' });
    });

    it('0 selections -> 400', async () => {
      vi.mocked(checkDefaultLimit).mockResolvedValue(true);

      const res = await issueVotesPUT({
        request: putReq({ wardId: HOME_WARD_ID, issueIds: [] }),
        locals: { session: { userId, role: 'citizen' } },
      } as any);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_selection_count' });
    });

    it('4 selections -> 400', async () => {
      vi.mocked(checkDefaultLimit).mockResolvedValue(true);

      const res = await issueVotesPUT({
        request: putReq({ wardId: HOME_WARD_ID, issueIds: [issueA, issueB, issueC, issueD] }),
        locals: { session: { userId, role: 'citizen' } },
      } as any);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_selection_count' });
    });

    it('over rate limit -> 429', async () => {
      vi.mocked(checkDefaultLimit).mockResolvedValue(false);

      const res = await issueVotesPUT({
        request: putReq({ wardId: HOME_WARD_ID, issueIds: [issueA] }),
        locals: { session: { userId, role: 'citizen' } },
      } as any);

      expect(res.status).toBe(429);
    });

    it('valid -> 200 {ok:true, results}, no-store, and issueIds are never present in logged output', async () => {
      vi.mocked(checkDefaultLimit).mockResolvedValue(true);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const res = await issueVotesPUT({
        request: putReq({ wardId: HOME_WARD_ID, issueIds: [issueA, issueB] }),
        locals: { session: { userId, role: 'citizen' } },
      } as any);

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.results)).toBe(true);
      const byId = new Map(body.results.map((r: { issueId: number; sharePct: number }) => [r.issueId, r.sharePct]));
      expect(byId.get(issueA)).toBeGreaterThan(0);
      expect(byId.get(issueB)).toBeGreaterThan(0);

      // PRIVACY: the specific issueIds chosen never appear in any logged line
      // (only the opaque wardId/userId identifiers may).
      const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).not.toContain(`issueIds`);
      expect(logged).not.toContain(String(issueA));
      expect(logged).not.toContain(String(issueB));
      logSpy.mockRestore();
    });
  });

  describe('GET', () => {
    it('anonymous (no session) -> 401', async () => {
      const res = await issueVotesGET({ url: getUrl(HOME_WARD_ID), locals: { session: null } } as any);
      expect(res.status).toBe(401);
    });

    it("authed, no active set in this ward -> {issueIds: []}", async () => {
      // A brand-new user with no vote-sets at all.
      const [freshUser] = await db
        .insert(schema.users)
        .values({
          email: `issue-votes-route-test-fresh-${randomUUID()}@example.com`,
          homeWardId: HOME_WARD_ID,
          role: 'citizen',
          status: 'active',
        })
        .returning();

      const res = await issueVotesGET({
        url: getUrl(HOME_WARD_ID),
        locals: { session: { userId: freshUser!.id, role: 'citizen' } },
      } as any);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ issueIds: [] });
    });

    it('authed, has an active set in this ward -> its selected issueIds', async () => {
      vi.mocked(checkDefaultLimit).mockResolvedValue(true);
      // Cast via the PUT path itself so this exercises the real read-after-write.
      await issueVotesPUT({
        request: putReq({ wardId: HOME_WARD_ID, issueIds: [issueA, issueC] }),
        locals: { session: { userId, role: 'citizen' } },
      } as any);

      const res = await issueVotesGET({
        url: getUrl(HOME_WARD_ID),
        locals: { session: { userId, role: 'citizen' } },
      } as any);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.issueIds.sort((a: number, b: number) => a - b)).toEqual([issueA, issueC].sort((a, b) => a - b));
    });

    it('invalid wardId query param -> 400', async () => {
      const res = await issueVotesGET({
        url: getUrl('not-a-number'),
        locals: { session: { userId, role: 'citizen' } },
      } as any);
      expect(res.status).toBe(400);
    });
  });
});

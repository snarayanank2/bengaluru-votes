import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
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

// High, task-specific ward id (Task 31 brief) — this suite owns 99311
// (tests/unit/flags.test.ts owns 99310).
const WARD_ID = 99311;

let candidateId: number;
let userId: number;

function req(body: unknown): Request {
  return new Request('http://localhost/api/flags', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function targetRefFor(fieldKey: string): string {
  return `candidate:${candidateId}:${fieldKey}`;
}

vi.mock('../../src/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/rate-limit')>();
  return { ...actual, checkDefaultLimit: vi.fn() };
});

import { checkDefaultLimit } from '../../src/lib/rate-limit';
import { POST as flagsPOST } from '../../src/pages/api/flags';

describe('POST /api/flags (Task 31)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    await db
      .insert(schema.wards)
      .values({
        id: WARD_ID,
        nameEn: 'Flags Route Test Ward',
        nameKn: 'ಫ್ಲ್ಯಾಗ್ ಮಾರ್ಗ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
        corporation: 'south',
        zone: 'Zone F',
        boundaryRef: 'flags-route-test-ward',
      })
      .onConflictDoUpdate({ target: schema.wards.id, set: { nameEn: 'Flags Route Test Ward' } });

    const [candidate] = await db
      .insert(schema.candidates)
      .values({
        slug: `flags-route-test-candidate-${randomUUID()}`,
        wardId: WARD_ID,
        nameEn: 'Flags Route Test Candidate',
        partyEn: 'Independent',
      })
      .returning();
    candidateId = candidate!.id;

    const [user] = await db
      .insert(schema.users)
      .values({ email: `flags-route-test-user-${randomUUID()}@example.com`, homeWardId: WARD_ID, role: 'citizen', status: 'active' })
      .returning();
    userId = user!.id;
  });

  afterAll(async () => {
    await client.end();
  });

  it('anonymous (no session) -> 401, no-store', async () => {
    vi.mocked(checkDefaultLimit).mockResolvedValue(true);

    const res = await flagsPOST({
      request: req({
        wardId: WARD_ID,
        targetType: 'candidate_field',
        targetRef: targetRefFor('anon_check'),
        detail: 'Should never reach the DB.',
      }),
      locals: { session: null },
    } as any);

    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('non-http sourceUrl (javascript:) -> 400', async () => {
    vi.mocked(checkDefaultLimit).mockResolvedValue(true);

    const res = await flagsPOST({
      request: req({
        wardId: WARD_ID,
        targetType: 'candidate_field',
        targetRef: targetRefFor('js_url_check'),
        detail: 'Malicious source link.',
        sourceUrl: 'javascript:alert(1)',
      }),
      locals: { session: { userId, role: 'citizen' } },
    } as any);

    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const items = await db
      .select()
      .from(schema.flagItems)
      .where(eq(schema.flagItems.targetRef, targetRefFor('js_url_check')));
    expect(items).toHaveLength(0);
  });

  it('over rate limit -> 429', async () => {
    vi.mocked(checkDefaultLimit).mockResolvedValue(false);

    const res = await flagsPOST({
      request: req({
        wardId: WARD_ID,
        targetType: 'candidate_field',
        targetRef: targetRefFor('rate_limited_check'),
        detail: 'Should be blocked by rate limit.',
      }),
      locals: { session: { userId, role: 'citizen' } },
    } as any);

    expect(res.status).toBe(429);

    const items = await db
      .select()
      .from(schema.flagItems)
      .where(eq(schema.flagItems.targetRef, targetRefFor('rate_limited_check')));
    expect(items).toHaveLength(0);
  });

  it('valid submission -> 200 {ok:true, flagItemId}, no-store', async () => {
    vi.mocked(checkDefaultLimit).mockResolvedValue(true);
    const targetRef = targetRefFor('valid_check');

    const res = await flagsPOST({
      request: req({
        wardId: WARD_ID,
        targetType: 'candidate_field',
        targetRef,
        detail: 'Track record looks stale.',
        sourceUrl: 'https://example.org/evidence',
      }),
      locals: { session: { userId, role: 'citizen' } },
    } as any);

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.flagItemId).toBe('number');

    const items = await db.select().from(schema.flagItems).where(eq(schema.flagItems.targetRef, targetRef));
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(body.flagItemId);
  });

  it('accepts a plain http:// sourceUrl too (not just https)', async () => {
    vi.mocked(checkDefaultLimit).mockResolvedValue(true);
    const targetRef = targetRefFor('http_ok_check');

    const res = await flagsPOST({
      request: req({
        wardId: WARD_ID,
        targetType: 'candidate_field',
        targetRef,
        detail: 'Old but plain http source.',
        sourceUrl: 'http://example.org/old-source',
      }),
      locals: { session: { userId, role: 'citizen' } },
    } as any);

    expect(res.status).toBe(200);
  });

  describe('privacy: detail/sourceUrl content is never logged', () => {
    it('does not appear in any console.log call', async () => {
      vi.mocked(checkDefaultLimit).mockResolvedValue(true);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const secretDetail = 'my-secret-medical-record-detail-xyz';
      const secretSourceUrl = 'https://example.org/secret-personal-path-xyz';

      await flagsPOST({
        request: req({
          wardId: WARD_ID,
          targetType: 'candidate_field',
          targetRef: targetRefFor('privacy_check'),
          detail: secretDetail,
          sourceUrl: secretSourceUrl,
        }),
        locals: { session: { userId, role: 'citizen' } },
      } as any);

      const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).not.toContain(secretDetail);
      expect(logged).not.toContain(secretSourceUrl);
      logSpy.mockRestore();
    });
  });
});

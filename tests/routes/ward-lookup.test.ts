import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';

vi.mock('../../src/lib/geocode', () => ({ lookupWardByAddress: vi.fn() }));

import { lookupWardByAddress } from '../../src/lib/geocode';
import { POST } from '../../src/pages/api/ward-lookup';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ids so this suite never collides with another test
// file's ward fixtures in the shared (not reset-between-files) test DB.
const WARD_A = {
  id: 97001,
  nameEn: 'Test Ward A',
  nameKn: 'ಟೆಸ್ಟ್ ವಾರ್ಡ್ ಎ',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'ward-lookup-test-a',
};
const WARD_B = {
  id: 97002,
  nameEn: 'Test Ward B',
  nameKn: 'ಟೆಸ್ಟ್ ವಾರ್ಡ್ ಬಿ',
  corporation: 'north' as const,
  zone: 'Zone T',
  boundaryRef: 'ward-lookup-test-b',
};

function wardPayload(w: { id: number; nameEn: string; nameKn: string; corporation: string }) {
  return { id: w.id, nameEn: w.nameEn, nameKn: w.nameKn, corporation: w.corporation };
}

function req(body: unknown): Request {
  return new Request('http://localhost/api/ward-lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ward-lookup', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    // Upsert (not onConflictDoNothing) so a stale row from a prior local
    // test run under the same id can't leave mismatched fixture data behind.
    for (const w of [WARD_A, WARD_B]) {
      await db
        .insert(schema.wards)
        .values(w)
        .onConflictDoUpdate({ target: schema.wards.id, set: w });
    }
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(() => {
    vi.mocked(lookupWardByAddress).mockReset();
  });

  describe('address branch', () => {
    it('a resolved ward returns the ward payload, no-store, no cookie', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'ward', wardId: WARD_A.id });

      const res = await POST({ request: req({ address: '1 MG Road' }) } as any);

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(await res.json()).toEqual({ result: 'ward', ward: wardPayload(WARD_A) });
    });

    it('out_of_coverage passes straight through', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'out_of_coverage' });
      const res = await POST({ request: req({ address: 'Nowhere at all' }) } as any);
      expect(await res.json()).toEqual({ result: 'out_of_coverage' });
    });

    // The one failure the citizen can act on: a more specific address helps.
    it('ambiguous is its own answer, not an outage', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'ambiguous' });
      const res = await POST({ request: req({ address: 'Main Road' }) } as any);
      expect(await res.json()).toEqual({ result: 'ambiguous' });
    });

    // These three are OUR outage. Pincode lookup used to absorb them; it was
    // removed 2026-08-14, so they now surface as `unavailable` and the copy
    // must never blame the citizen's address (see the endpoint's header).
    it('budget_exhausted is unavailable/budget', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'budget_exhausted' });
      const res = await POST({ request: req({ address: 'Main Road' }) } as any);
      expect(await res.json()).toEqual({ result: 'unavailable', reason: 'budget' });
    });

    it('failed is unavailable/failed', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'failed' });
      const res = await POST({ request: req({ address: 'Main Road' }) } as any);
      expect(await res.json()).toEqual({ result: 'unavailable', reason: 'failed' });
    });

    it('a ward id not present in the DB is unavailable/failed, never a 500', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'ward', wardId: 999999 });
      const res = await POST({ request: req({ address: 'Ghost Ward Address' }) } as any);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result: 'unavailable', reason: 'failed' });
    });

    // Regression guard for the removal: a pincode is now just an address
    // like any other. It must reach the geocoder rather than being routed
    // down a branch that no longer exists.
    it('a bare 6-digit query is treated as an address, not a pincode', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'out_of_coverage' });
      const res = await POST({ request: req({ address: '560001' }) } as any);
      expect(lookupWardByAddress).toHaveBeenCalledWith('560001');
      expect(await res.json()).toEqual({ result: 'out_of_coverage' });
    });
  });

  describe('validation', () => {
    const badBodies: unknown[] = [
      {},
      { address: '' },
      { address: '   ' },
      { address: 123 },
      // `pincode` is no longer an input mode — a body carrying only one is
      // missing the required `address` and must be rejected, not routed.
      { pincode: '560001' },
    ];

    for (const body of badBodies) {
      it(`rejects ${JSON.stringify(body)} with 400`, async () => {
        const res = await POST({ request: req(body) } as any);
        expect(res.status).toBe(400);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const json = (await res.json()) as Record<string, unknown>;
        expect(json).toHaveProperty('error');
      });
    }

    it('rejects an unparsable JSON body with 400', async () => {
      const brokenReq = new Request('http://localhost/api/ward-lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      });
      const res = await POST({ request: brokenReq } as any);
      expect(res.status).toBe(400);
    });
  });

  describe('privacy: the raw address is never logged', () => {
    it('does not appear in any console.log call across every address-branch result kind', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const secretAddress = 'Totally Secret 42 Whitefield Road Apartment 7B';

      const kinds = [
        { kind: 'ward', wardId: WARD_A.id },
        { kind: 'out_of_coverage' },
        { kind: 'ambiguous' },
        { kind: 'budget_exhausted' },
        { kind: 'failed' },
      ] as const;

      for (const kind of kinds) {
        vi.mocked(lookupWardByAddress).mockResolvedValueOnce(kind as any);
        await POST({ request: req({ address: secretAddress }) } as any);
      }

      const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).not.toContain(secretAddress);
      logSpy.mockRestore();
    });
  });
});

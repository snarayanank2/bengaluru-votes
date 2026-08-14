import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';

vi.mock('../../src/lib/geocode', () => ({
  lookupWardByAddress: vi.fn(),
  lookupWardByPoint: vi.fn(),
}));

import { lookupWardByAddress, lookupWardByPoint } from '../../src/lib/geocode';
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
    vi.mocked(lookupWardByPoint).mockReset();
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

  // The second input mode, added for "use my current location": the browser
  // already has the position, so this branch resolves it by point-in-polygon
  // and never reaches Google. See src/lib/geocode.ts's lookupWardByPoint.
  describe('coordinate branch', () => {
    const POINT = { lat: 12.963397819598583, lng: 77.51397756422665 };

    it('a resolved ward returns the ward payload, no-store, no cookie', async () => {
      vi.mocked(lookupWardByPoint).mockResolvedValueOnce({ kind: 'ward', wardId: WARD_B.id });

      const res = await POST({ request: req(POINT) } as any);

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(await res.json()).toEqual({ result: 'ward', ward: wardPayload(WARD_B) });
    });

    it('passes the position straight through to lookupWardByPoint', async () => {
      vi.mocked(lookupWardByPoint).mockResolvedValueOnce({ kind: 'out_of_coverage' });

      await POST({ request: req(POINT) } as any);

      expect(lookupWardByPoint).toHaveBeenCalledWith(POINT.lat, POINT.lng);
    });

    it('out_of_coverage passes straight through', async () => {
      vi.mocked(lookupWardByPoint).mockResolvedValueOnce({ kind: 'out_of_coverage' });
      const res = await POST({ request: req({ lat: 0, lng: 0 }) } as any);
      expect(await res.json()).toEqual({ result: 'out_of_coverage' });
    });

    // The whole point of this branch: it costs nothing and depends on
    // nothing external, so it must never be routed through the geocoder.
    it('never calls the address geocoder', async () => {
      vi.mocked(lookupWardByPoint).mockResolvedValueOnce({ kind: 'ward', wardId: WARD_B.id });
      await POST({ request: req(POINT) } as any);
      expect(lookupWardByAddress).not.toHaveBeenCalled();
    });

    it('a ward id not present in the DB is unavailable/failed, never a 500', async () => {
      vi.mocked(lookupWardByPoint).mockResolvedValueOnce({ kind: 'ward', wardId: 999999 });
      const res = await POST({ request: req(POINT) } as any);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ result: 'unavailable', reason: 'failed' });
    });

    // A body carrying both is not something any client sends; pinning the
    // precedence keeps it from being an accident if one ever does.
    it('a body carrying both an address and a position takes the address branch', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'out_of_coverage' });

      await POST({ request: req({ address: 'MG Road', ...POINT }) } as any);

      expect(lookupWardByAddress).toHaveBeenCalledWith('MG Road');
      expect(lookupWardByPoint).not.toHaveBeenCalled();
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
      // Half a position is not a position.
      { lat: 12.97 },
      { lng: 77.59 },
      // Not numbers.
      { lat: '12.97', lng: '77.59' },
      { lat: null, lng: null },
      // Off the globe. A merely distant point is a normal out_of_coverage
      // answer; an impossible one is a bad request.
      { lat: 91, lng: 77.59 },
      { lat: -91, lng: 77.59 },
      { lat: 12.97, lng: 181 },
      { lat: 12.97, lng: -181 },
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

  // A position is more sensitive than an address, not less: it is where the
  // citizen physically is. It is used to pick a ward and then dropped —
  // never logged, and (see tests/unit/geocode-point.test.ts) never stored.
  describe('privacy: the citizen’s position is never logged', () => {
    it('neither coordinate appears in any console.log call, for either result kind', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const lat = 12.963397819598583;
      const lng = 77.51397756422665;

      for (const kind of [{ kind: 'ward', wardId: WARD_A.id }, { kind: 'out_of_coverage' }] as const) {
        vi.mocked(lookupWardByPoint).mockResolvedValueOnce(kind as any);
        await POST({ request: req({ lat, lng }) } as any);
      }

      const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).not.toContain(String(lat));
      expect(logged).not.toContain(String(lng));
      expect(logged).not.toContain('12.96');
      expect(logged).not.toContain('77.51');
      logSpy.mockRestore();
    });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';

vi.mock('../../src/lib/geocode', () => ({ lookupWardByAddress: vi.fn() }));

import { lookupWardByAddress } from '../../src/lib/geocode';
import { POST } from '../../src/pages/api/booth-lookup';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// A high, task-specific id so this suite never collides with another test
// file's ward fixtures in the shared (not reset-between-files) test DB.
const WARD = {
  id: 97101,
  nameEn: 'Booth Test Ward',
  nameKn: 'ಬೂತ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'east' as const,
  zone: 'Zone T',
  boundaryRef: 'booth-lookup-test-ward',
};

const BOOTH = {
  wardId: WARD.id,
  nameEn: 'Test Government School',
  nameKn: 'ಪರೀಕ್ಷಾ ಸರ್ಕಾರಿ ಶಾಲೆ',
  address: '12 Test Street',
  lat: '12.9716',
  lng: '77.5946',
};

function req(body: unknown): Request {
  return new Request('http://localhost/api/booth-lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/booth-lookup', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    // Upsert (not onConflictDoNothing) so a stale row from a prior local
    // test run under the same id can't leave mismatched fixture data behind.
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(() => {
    vi.mocked(lookupWardByAddress).mockReset();
  });

  describe('no booth data loaded yet', () => {
    beforeEach(async () => {
      await db.delete(schema.booths);
    });

    it('returns no_booth_data and never calls lookupWardByAddress', async () => {
      const res = await POST({ request: req({ address: 'Anything' }) } as any);

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(await res.json()).toEqual({ result: 'no_booth_data' });
      expect(lookupWardByAddress).not.toHaveBeenCalled();
    });
  });

  describe('booth data present', () => {
    beforeEach(async () => {
      await db.delete(schema.booths);
      await db.insert(schema.booths).values(BOOTH);
    });

    it('a resolved ward returns the booth(s) for that ward', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'ward', wardId: WARD.id });

      const res = await POST({ request: req({ address: '12 Test Street' }) } as any);

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('set-cookie')).toBeNull();
      const body = (await res.json()) as { result: string; booths: unknown[] };
      expect(body.result).toBe('booth');
      expect(body.booths).toHaveLength(1);
      expect(body.booths[0]).toMatchObject({
        nameEn: BOOTH.nameEn,
        nameKn: BOOTH.nameKn,
        address: BOOTH.address,
        lat: BOOTH.lat,
        lng: BOOTH.lng,
        wardId: WARD.id,
      });
    });

    it('a ward with no booths of its own returns no_booth_data', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'ward', wardId: 999999 });
      const res = await POST({ request: req({ address: 'Some other ward' }) } as any);
      expect(await res.json()).toEqual({ result: 'no_booth_data' });
    });

    it('out_of_coverage passes straight through', async () => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce({ kind: 'out_of_coverage' });
      const res = await POST({ request: req({ address: 'Nowhere at all' }) } as any);
      expect(await res.json()).toEqual({ result: 'out_of_coverage' });
    });

    it.each([
      [{ kind: 'ambiguous' }, 'ambiguous'],
      [{ kind: 'budget_exhausted' }, 'budget'],
      [{ kind: 'failed' }, 'failed'],
    ] as const)('%o degrades to unavailable/%s (no pincode fallback for booths)', async (kind, reason) => {
      vi.mocked(lookupWardByAddress).mockResolvedValueOnce(kind as any);
      const res = await POST({ request: req({ address: 'Main Road' }) } as any);
      expect(await res.json()).toEqual({ result: 'unavailable', reason });
    });
  });

  describe('validation', () => {
    beforeEach(async () => {
      await db.delete(schema.booths);
      await db.insert(schema.booths).values(BOOTH);
    });

    for (const body of [{}, { address: '' }, { address: '   ' }, { address: 123 }]) {
      it(`rejects ${JSON.stringify(body)} with 400`, async () => {
        const res = await POST({ request: req(body) } as any);
        expect(res.status).toBe(400);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const json = (await res.json()) as Record<string, unknown>;
        expect(json).toHaveProperty('error');
        expect(lookupWardByAddress).not.toHaveBeenCalled();
      });
    }
  });

  describe('privacy: the raw address is never logged', () => {
    beforeEach(async () => {
      await db.delete(schema.booths);
      await db.insert(schema.booths).values(BOOTH);
    });

    it('does not appear in any console.log call across every result kind', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const secretAddress = 'Totally Secret 99 Booth Finder Lane';

      const kinds = [
        { kind: 'ward', wardId: WARD.id },
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

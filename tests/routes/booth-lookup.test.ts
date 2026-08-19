/**
 * POST /api/booth-lookup — booth lookup by EPIC (voter ID) number.
 *
 * The upstream client is mocked throughout: this suite never calls the BBMP
 * electoral API, and must not start to. `lookupWardByPoint` is mocked too,
 * so the coordinate fallback can be exercised without loading the 3.5MB
 * GeoJSON.
 *
 * Fixture wards use ward number 900, which no real ward uses (the largest
 * real ward number is 112, in West), so nothing here can collide with a
 * seeded ward in the shared test database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';

vi.mock('../../src/lib/electoral-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/electoral-api')>();
  return { ...actual, searchByEpic: vi.fn() };
});
vi.mock('../../src/lib/geocode', () => ({ lookupWardByPoint: vi.fn() }));
vi.mock('../../src/lib/log', () => ({ logEvent: vi.fn() }));

import { searchByEpic } from '../../src/lib/electoral-api';
import { lookupWardByPoint } from '../../src/lib/geocode';
import { logEvent } from '../../src/lib/log';
import { EPIC_DAILY_BUDGET } from '../../src/lib/booth-lookup';
import { POST } from '../../src/pages/api/booth-lookup';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

/** East 900 -> id 3900. Note the corporation id: OURS is 3 for East, not upstream's 4. */
const WARD = {
  id: 3900,
  nameEn: 'Booth Test Ward',
  nameKn: 'ಬೂತ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'east' as const,
  zone: 'Zone T',
  boundaryRef: 'booth-lookup-test-ward',
};

/** The ward the coordinate fallback resolves to, when the name mapping misses. */
const FALLBACK_WARD = {
  id: 4900,
  nameEn: 'Fallback Test Ward',
  nameKn: 'ಪರ್ಯಾಯ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'booth-lookup-fallback-ward',
};

const EPIC = 'ZZZ0000001';
const VOTER_NAME = 'Demo Voter (FICTIONAL)';

/** As `searchByEpic` returns it. Upstream calls the ward '900 - Their Name For It'. */
const RECORD = {
  epic: EPIC,
  nameEn: VOTER_NAME,
  nameKn: 'ಡೆಮೊ ಮತದಾರ (ಕಾಲ್ಪನಿಕ)',
  corporationName: 'East',
  wardName: '900 - Their Name For It',
  psSerialNo: 1242,
  psNameEn: 'Nammura Govt Higher Primary School Room No 2',
  psNameKn: 'ನಮ್ಮೂರ ಸರಕಾರಿ ಹಿರಿಯ ಪ್ರಾಥಮಿಕ ಶಾಲೆ',
  psLat: 12.923654,
  psLng: 77.69122,
};

function req(body: unknown): Request {
  return new Request('http://localhost/api/booth-lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown) {
  const res = await POST({ request: req(body) } as any);
  return { res, body: await res.json() };
}

describe('POST /api/booth-lookup (by EPIC)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    for (const ward of [WARD, FALLBACK_WARD]) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }
  });

  afterAll(async () => {
    await db.delete(schema.budgetCounters).where(eq(schema.budgetCounters.kind, 'epic_lookup'));
    await client.end();
  });

  beforeEach(async () => {
    vi.mocked(searchByEpic).mockReset();
    vi.mocked(lookupWardByPoint).mockReset();
    vi.mocked(logEvent).mockReset();
    // A fresh budget for every case — one test deliberately exhausts it.
    await db.delete(schema.budgetCounters).where(eq(schema.budgetCounters.kind, 'epic_lookup'));
  });

  describe('a voter who is on the roll', () => {
    it('returns the booth, the voter, and OUR name for the ward', async () => {
      vi.mocked(searchByEpic).mockResolvedValueOnce({ kind: 'found', record: RECORD });

      const { res, body } = await post({ epic: EPIC });

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(body).toEqual({
        result: 'booth',
        voter: { epic: EPIC, nameEn: VOTER_NAME, nameKn: RECORD.nameKn },
        ward: {
          id: WARD.id,
          nameEn: WARD.nameEn,
          nameKn: WARD.nameKn,
          corporation: 'east',
        },
        booth: {
          nameEn: RECORD.psNameEn,
          nameKn: RECORD.psNameKn,
          serialNo: 1242,
          lat: RECORD.psLat,
          lng: RECORD.psLng,
        },
      });
      // The name mapping hit, so the coordinate fallback is never reached.
      expect(lookupWardByPoint).not.toHaveBeenCalled();
    });

    it('passes the epic through to the client as given, normalization and all', async () => {
      vi.mocked(searchByEpic).mockResolvedValueOnce({ kind: 'found', record: RECORD });
      await post({ epic: '  zzz 000 0001  ' });
      // The route trims; normalizing case/spaces is the client's job, so what
      // arrives here is the trimmed string, not an uppercased one.
      expect(searchByEpic).toHaveBeenCalledWith('zzz 000 0001');
    });
  });

  describe('when the ward mapping misses', () => {
    it("falls back to the polling station's coordinates", async () => {
      vi.mocked(searchByEpic).mockResolvedValueOnce({
        kind: 'found',
        record: { ...RECORD, corporationName: 'Yelahanka Corporation' },
      });
      vi.mocked(lookupWardByPoint).mockResolvedValueOnce({ kind: 'ward', wardId: FALLBACK_WARD.id });

      const { body } = await post({ epic: EPIC });

      expect(lookupWardByPoint).toHaveBeenCalledWith(RECORD.psLat, RECORD.psLng);
      expect(body.ward).toMatchObject({ id: FALLBACK_WARD.id, nameEn: FALLBACK_WARD.nameEn });
    });

    it('falls back when the mapped ward is not one of ours', async () => {
      // East 899 -> 3899, which no ward row exists for.
      vi.mocked(searchByEpic).mockResolvedValueOnce({
        kind: 'found',
        record: { ...RECORD, wardName: '899 - A Ward We Do Not Have' },
      });
      vi.mocked(lookupWardByPoint).mockResolvedValueOnce({ kind: 'ward', wardId: FALLBACK_WARD.id });

      const { body } = await post({ epic: EPIC });

      expect(body.ward).toMatchObject({ id: FALLBACK_WARD.id });
    });

    it('still returns the booth when no ward can be resolved at all', async () => {
      vi.mocked(searchByEpic).mockResolvedValueOnce({
        kind: 'found',
        record: { ...RECORD, corporationName: 'Nowhere' },
      });
      vi.mocked(lookupWardByPoint).mockResolvedValueOnce({ kind: 'out_of_coverage' });

      const { res, body } = await post({ epic: EPIC });

      expect(res.status).toBe(200);
      expect(body.result).toBe('booth');
      expect(body.ward).toBeNull();
      expect(body.booth).toMatchObject({ serialNo: 1242 });
    });
  });

  describe('upstream outcomes that are not a booth', () => {
    it('passes not_found straight through', async () => {
      vi.mocked(searchByEpic).mockResolvedValueOnce({ kind: 'not_found' });
      const { res, body } = await post({ epic: EPIC });
      expect(res.status).toBe(200);
      expect(body).toEqual({ result: 'not_found' });
    });

    it.each(['timeout', 'failed', 'malformed'] as const)('passes unavailable/%s through', async (reason) => {
      vi.mocked(searchByEpic).mockResolvedValueOnce({ kind: 'unavailable', reason });
      const { res, body } = await post({ epic: EPIC });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(body).toEqual({ result: 'unavailable', reason });
    });
  });

  describe('the daily politeness cap', () => {
    it('refuses to call upstream once the budget is spent', async () => {
      const day = new Date().toISOString().slice(0, 10);
      await db
        .insert(schema.budgetCounters)
        .values({ day, kind: 'epic_lookup', count: EPIC_DAILY_BUDGET })
        .onConflictDoUpdate({
          target: [schema.budgetCounters.day, schema.budgetCounters.kind],
          set: { count: EPIC_DAILY_BUDGET },
        });

      const { body } = await post({ epic: EPIC });

      expect(body).toEqual({ result: 'unavailable', reason: 'budget' });
      expect(searchByEpic).not.toHaveBeenCalled();
    });

    it('spends exactly one unit per lookup', async () => {
      vi.mocked(searchByEpic).mockResolvedValue({ kind: 'not_found' });
      await post({ epic: EPIC });
      await post({ epic: EPIC });

      const day = new Date().toISOString().slice(0, 10);
      const [row] = await db
        .select()
        .from(schema.budgetCounters)
        .where(and(eq(schema.budgetCounters.day, day), eq(schema.budgetCounters.kind, 'epic_lookup')));
      expect(row?.count).toBe(2);
    });
  });

  describe('validation', () => {
    for (const body of [{}, { epic: '' }, { epic: '   ' }, { epic: 'abc' }, { epic: 123 }, { epic: 'x'.repeat(33) }, { epic: "'; drop table wards;--" }]) {
      it(`rejects ${JSON.stringify(body)} with 400`, async () => {
        const { res, body: json } = await post(body);
        expect(res.status).toBe(400);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(json).toHaveProperty('error');
        expect(searchByEpic).not.toHaveBeenCalled();
      });
    }

    it('rejects a body that is not JSON at all', async () => {
      const res = await POST({
        request: new Request('http://localhost/api/booth-lookup', { method: 'POST', body: 'not json' }),
      } as any);
      expect(res.status).toBe(400);
      expect(searchByEpic).not.toHaveBeenCalled();
    });
  });

  describe('privacy: nothing personal is ever logged', () => {
    it('logs the result kind and ward id only — never the epic or the name', async () => {
      const cases = [
        { kind: 'found', record: RECORD },
        { kind: 'not_found' },
        { kind: 'unavailable', reason: 'failed' },
      ] as const;

      for (const outcome of cases) {
        vi.mocked(searchByEpic).mockResolvedValueOnce(outcome as any);
        await post({ epic: EPIC });
      }

      expect(vi.mocked(logEvent)).toHaveBeenCalledTimes(3);
      const logged = JSON.stringify(vi.mocked(logEvent).mock.calls);
      expect(logged).not.toContain(EPIC);
      expect(logged).not.toContain(VOTER_NAME);
      expect(logged).not.toContain(RECORD.nameKn);
      expect(logged).not.toContain(RECORD.psNameEn);
      expect(vi.mocked(logEvent).mock.calls[0]).toEqual([
        'booth_lookup',
        { result: 'booth', wardId: WARD.id },
      ]);
    });
  });
});

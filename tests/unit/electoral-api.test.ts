/**
 * The BBMP electoral API client (src/lib/electoral-api.ts).
 *
 * The transport (src/lib/electoral-transport.ts) is mocked throughout — this
 * suite never touches the network, and must not start to. The response bodies
 * below are the real shapes observed against the live endpoint on 2026-08-19,
 * with a FICTIONAL voter substituted: the upstream payload carries a real
 * person's name, and no such record belongs in this repo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/lib/electoral-transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/electoral-transport')>();
  // TransportTimeoutError stays real: the client distinguishes a timeout from
  // any other failure by that class, so mocking it away would hide the wiring.
  return { ...actual, postJson: vi.fn() };
});

import { postJson, TransportTimeoutError } from '../../src/lib/electoral-transport';
import { searchByEpic, normalizeEpic } from '../../src/lib/electoral-api';

/** The live response shape, with a fictional voter. */
const UPSTREAM_ROW = {
  voter_epic: 'ZZZ0000001',
  name_en: 'Demo Voter (FICTIONAL)',
  name_kn: 'ಡೆಮೊ ಮತದಾರ (ಕಾಲ್ಪನಿಕ)',
  corporation_name: 'East',
  corporation_name_l1: 'ಪೂರ್ವ',
  ward_name: '49 - Doddakannelli Ward',
  ward_name_l1: 'ದೊಡ್ಡಕನ್ನೆಲ್ಲಿ ವಾರ್ಡ್‌',
  ps_id: 2,
  ps_serial_no: 1242,
  ps_name: 'Nammura Govt Higher Primary School Devarabeesanahalli Room No 2',
  ps_name_l1: 'ನಮ್ಮೂರ ಸರಕಾರಿ ಹಿರಿಯ ಪ್ರಾಥಮಿಕ ಶಾಲೆ',
  ps_long: 77.69122,
  ps_lat: 12.923654,
};

/** As the transport hands it back: a status and the raw body text. */
function jsonResponse(body: unknown, status = 200) {
  return { status, body: JSON.stringify(body) };
}

const postMock = vi.mocked(postJson);

beforeEach(() => {
  postMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('normalizeEpic', () => {
  // Upstream is case- and whitespace-sensitive: it answers `[]` to
  // "svf9148909" and to a trailing space. Normalizing here is the difference
  // between "not on the roll" and "you typed it in lowercase".
  it('uppercases and strips all whitespace', () => {
    expect(normalizeEpic(' zzz 000 0001 ')).toBe('ZZZ0000001');
    expect(normalizeEpic('zzz0000001')).toBe('ZZZ0000001');
    expect(normalizeEpic('ZZZ0000001')).toBe('ZZZ0000001');
  });
});

describe('searchByEpic', () => {
  it('returns the parsed record for a match', async () => {
    postMock.mockResolvedValueOnce(jsonResponse([UPSTREAM_ROW]));

    const result = await searchByEpic('zzz0000001');

    expect(result).toEqual({
      kind: 'found',
      record: {
        epic: 'ZZZ0000001',
        nameEn: 'Demo Voter (FICTIONAL)',
        nameKn: 'ಡೆಮೊ ಮತದಾರ (ಕಾಲ್ಪನಿಕ)',
        corporationName: 'East',
        wardName: '49 - Doddakannelli Ward',
        psSerialNo: 1242,
        psNameEn: 'Nammura Govt Higher Primary School Devarabeesanahalli Room No 2',
        psNameKn: 'ನಮ್ಮೂರ ಸರಕಾರಿ ಹಿರಿಯ ಪ್ರಾಥಮಿಕ ಶಾಲೆ',
        psLat: 12.923654,
        psLng: 77.69122,
      },
    });
  });

  it('posts the NORMALIZED epic to searchby-epic', async () => {
    postMock.mockResolvedValueOnce(jsonResponse([UPSTREAM_ROW]));

    await searchByEpic('  zzz0000001 ');

    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, payload, timeout] = postMock.mock.calls[0];
    expect(url).toBe('https://electoralapi.bbmpgov.in/searchby-epic');
    expect(payload).toEqual({ epic_no: 'ZZZ0000001' });
    expect(timeout).toBe(5000);
  });

  it('honours ELECTORAL_API_TIMEOUT_MS', async () => {
    vi.stubEnv('ELECTORAL_API_TIMEOUT_MS', '1500');
    postMock.mockResolvedValueOnce(jsonResponse([]));
    await searchByEpic('ZZZ0000001');
    expect(postMock.mock.calls[0][2]).toBe(1500);
  });

  // Every "no such voter" case upstream — unknown number, empty string,
  // wrong case, stray space — comes back as a 200 with an empty array.
  it('treats an empty array as not_found', async () => {
    postMock.mockResolvedValueOnce(jsonResponse([]));
    expect(await searchByEpic('ZZZ0000002')).toEqual({ kind: 'not_found' });
  });

  it('never calls upstream for an empty epic', async () => {
    expect(await searchByEpic('   ')).toEqual({ kind: 'not_found' });
    expect(postMock).not.toHaveBeenCalled();
  });

  it('takes the first record when upstream returns several', async () => {
    postMock.mockResolvedValueOnce(
      jsonResponse([UPSTREAM_ROW, { ...UPSTREAM_ROW, ps_serial_no: 99 }]),
    );
    const result = await searchByEpic('ZZZ0000001');
    expect(result.kind).toBe('found');
    expect(result.kind === 'found' && result.record.psSerialNo).toBe(1242);
  });

  it.each([400, 422, 500, 502, 503])('degrades a %i to unavailable/failed', async (status) => {
    postMock.mockResolvedValueOnce(jsonResponse({ detail: 'nope' }, status));
    expect(await searchByEpic('ZZZ0000001')).toEqual({ kind: 'unavailable', reason: 'failed' });
  });

  it('degrades a network error to unavailable/failed', async () => {
    postMock.mockRejectedValueOnce(new TypeError('socket hang up'));
    expect(await searchByEpic('ZZZ0000001')).toEqual({ kind: 'unavailable', reason: 'failed' });
  });

  // The TLS-chain failure this endpoint actually produces under Node when the
  // transport's CA bundle is wrong (see electoral-transport.ts's header). It
  // must read as an outage, never as "voter not on the roll".
  it('degrades a TLS verification failure to unavailable/failed', async () => {
    postMock.mockRejectedValueOnce(new Error('unable to verify the first certificate'));
    expect(await searchByEpic('ZZZ0000001')).toEqual({ kind: 'unavailable', reason: 'failed' });
  });

  it('reports a timeout distinctly', async () => {
    postMock.mockRejectedValueOnce(new TransportTimeoutError('no response in 5000ms'));
    expect(await searchByEpic('ZZZ0000001')).toEqual({ kind: 'unavailable', reason: 'timeout' });
  });

  it('degrades unparseable JSON to unavailable/malformed', async () => {
    postMock.mockResolvedValueOnce({ status: 200, body: '<html>gateway</html>' });
    expect(await searchByEpic('ZZZ0000001')).toEqual({ kind: 'unavailable', reason: 'malformed' });
  });

  it.each([
    ['an object instead of an array', { voter_epic: 'ZZZ0000001' }],
    ['a row missing ps_name', [{ ...UPSTREAM_ROW, ps_name: undefined }]],
    ['a row with a non-numeric ps_lat', [{ ...UPSTREAM_ROW, ps_lat: 'twelve' }]],
  ])('degrades %s to unavailable/malformed', async (_label, body) => {
    postMock.mockResolvedValueOnce(jsonResponse(body));
    expect(await searchByEpic('ZZZ0000001')).toEqual({ kind: 'unavailable', reason: 'malformed' });
  });

  // The Kannada name field has been observed empty for some records; that is
  // a thin record, not a broken one.
  it('accepts a record with an empty Kannada name', async () => {
    postMock.mockResolvedValueOnce(jsonResponse([{ ...UPSTREAM_ROW, name_kn: '', ps_name_l1: '' }]));
    const result = await searchByEpic('ZZZ0000001');
    expect(result.kind).toBe('found');
    expect(result.kind === 'found' && result.record.nameKn).toBe('');
  });

  it('honours ELECTORAL_API_ORIGIN', async () => {
    vi.stubEnv('ELECTORAL_API_ORIGIN', 'http://localhost:9999');
    postMock.mockResolvedValueOnce(jsonResponse([]));
    await searchByEpic('ZZZ0000001');
    expect(postMock.mock.calls[0][0]).toBe('http://localhost:9999/searchby-epic');
  });
});

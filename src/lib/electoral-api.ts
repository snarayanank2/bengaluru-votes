/**
 * Client for the BBMP electoral API — the upstream behind polling-booth
 * lookup by EPIC (voter ID) number.
 *
 * `POST {origin}/searchby-epic` with `{"epic_no": "..."}` answers with a
 * JSON ARRAY: one object for a match, `[]` for anything it doesn't
 * recognize. Sibling endpoints exist (`GET /corporations`,
 * `GET /wards/{corp_id}`, `POST /searchby-name`); only searchby-epic is used
 * here. There is no API key, no auth and no published contract — hence the
 * defensive parse below and the deliberate absence of any assumption beyond
 * "an array of objects, or we don't trust it".
 *
 * ============================================================================
 * PRIVACY. The response carries the voter's NAME (English and Kannada)
 * alongside the booth. That is third-party personal data passing through our
 * server on its way to the citizen who asked for it, and it must:
 *   - never be logged (`logEvent` gets result kinds and ids only — this
 *     module logs nothing at all, and the route above it logs no field that
 *     came out of this file),
 *   - never be cached or persisted — no geocode-cache equivalent, no row
 *     anywhere. The record exists for the duration of one request.
 *   - never reach a cacheable response. Callers set `cache-control:
 *     no-store` (architecture §5).
 * The EPIC number itself is subject to exactly the same rules.
 * ============================================================================
 *
 * NORMALIZATION matters more than it looks. Upstream is case- and
 * whitespace-sensitive: it answers `[]` — indistinguishable from "not on the
 * roll" — to a lowercase EPIC or one with a trailing space. Normalizing
 * before the call is what stops a correctly-typed voter ID reading as a
 * missing one.
 *
 * `ELECTORAL_API_ORIGIN` overrides the host (tests, staging). Unset, it is
 * the live one — this is a public read-only endpoint with no credential to
 * omit, so there is no "unset key degrades to a no-op" case here; the
 * documented degradation is the timeout below.
 *
 * The HTTP call itself lives in `src/lib/electoral-transport.ts` and is NOT a
 * `fetch`. That is not a style choice: the server serves an incomplete TLS
 * chain that Node's fetch cannot verify at all, while curl and browsers paper
 * over it. Read that file's header before changing how this talks to the
 * network.
 */
import { z } from 'zod';
import { postJson, TransportTimeoutError } from './electoral-transport';

const DEFAULT_ORIGIN = 'https://electoralapi.bbmpgov.in';
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * The upstream row, as observed. Unknown keys are ignored rather than
 * rejected — an upstream that adds a field should not take booth lookup
 * down. `name_kn`/`ps_name_l1` are allowed to be empty strings: some records
 * carry no Kannada text, which is thin data, not a broken response.
 */
const upstreamRowSchema = z.object({
  voter_epic: z.string(),
  name_en: z.string(),
  name_kn: z.string().default(''),
  corporation_name: z.string(),
  ward_name: z.string(),
  ps_serial_no: z.number(),
  ps_name: z.string(),
  ps_name_l1: z.string().default(''),
  ps_lat: z.number(),
  ps_long: z.number(),
});

const upstreamResponseSchema = z.array(upstreamRowSchema);

/** One voter's roll entry. Every field here is personal data — see the header. */
export interface EpicRecord {
  epic: string;
  nameEn: string;
  nameKn: string;
  /** 'Central' | 'North' | 'South' | 'East' | 'West' — their spelling, not validated here. */
  corporationName: string;
  /** e.g. '49 - Doddakannelli Ward'. Only the leading number is trusted (electoral-wards.ts). */
  wardName: string;
  psSerialNo: number;
  psNameEn: string;
  psNameKn: string;
  psLat: number;
  psLng: number;
}

export type EpicSearchResult =
  | { kind: 'found'; record: EpicRecord }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: 'timeout' | 'failed' | 'malformed' };

/**
 * Upstream matches on an exact string. Uppercase and strip every space so a
 * citizen reading their card aloud — "s v f 9148909" — is not told they are
 * missing from the roll.
 */
export function normalizeEpic(epic: string): string {
  return epic.replace(/\s+/g, '').toUpperCase();
}

function origin(): string {
  return process.env.ELECTORAL_API_ORIGIN || DEFAULT_ORIGIN;
}

function timeoutMs(): number {
  const raw = Number(process.env.ELECTORAL_API_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * Look up one EPIC. Never throws: every failure mode — timeout, network
 * error, non-2xx, unparseable body, unexpected shape — becomes an
 * `unavailable` result the caller can render as "try again shortly".
 */
export async function searchByEpic(epic: string): Promise<EpicSearchResult> {
  const epicNo = normalizeEpic(epic);
  if (epicNo.length === 0) {
    return { kind: 'not_found' };
  }

  let res: { status: number; body: string };
  try {
    res = await postJson(`${origin()}/searchby-epic`, { epic_no: epicNo }, timeoutMs());
  } catch (err) {
    const timedOut = err instanceof TransportTimeoutError || (err as Error | undefined)?.name === 'TransportTimeoutError';
    return { kind: 'unavailable', reason: timedOut ? 'timeout' : 'failed' };
  }

  if (res.status < 200 || res.status >= 300) {
    return { kind: 'unavailable', reason: 'failed' };
  }

  let body: unknown;
  try {
    body = JSON.parse(res.body);
  } catch {
    return { kind: 'unavailable', reason: 'malformed' };
  }

  const parsed = upstreamResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { kind: 'unavailable', reason: 'malformed' };
  }

  const row = parsed.data[0];
  if (!row) {
    return { kind: 'not_found' };
  }

  return {
    kind: 'found',
    record: {
      epic: row.voter_epic,
      nameEn: row.name_en,
      nameKn: row.name_kn,
      corporationName: row.corporation_name,
      wardName: row.ward_name,
      psSerialNo: row.ps_serial_no,
      psNameEn: row.ps_name,
      psNameKn: row.ps_name_l1,
      psLat: row.ps_lat,
      psLng: row.ps_long,
    },
  };
}

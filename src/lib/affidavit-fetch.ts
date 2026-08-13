/**
 * SSRF-hardened fetch of a curator-supplied EC (Election Commission) affidavit
 * link (Task 37; architecture.md §7, §13; PRD §5.2). This is THE one place
 * in the platform that performs a server-side fetch of a URL a curator
 * typed in — every other outbound request the app makes targets a
 * hard-coded, developer-chosen host. Get this wrong and a curator (trusted,
 * but not infallible, and a phishing/compromise target) can turn the
 * server into an open SSRF proxy against the host's own metadata service
 * or its private network.
 *
 * DEFENSE LAYERS (all must hold, independently — this is not one check):
 *   1. Scheme: https only. A `http://` link is rejected outright — never a
 *      cleartext fetch of a citizen-facing "official" document.
 *   2. Host allowlist: only the EC/CEO-Karnataka domains in
 *      `EC_AFFIDAVIT_HOSTS` (below) are fetchable, exact case-insensitive
 *      match. An IP-literal host (e.g. `https://127.0.0.1/x`) is rejected
 *      even before the allowlist check — a hostname must be present at all.
 *   3. DNS resolution + IP-range check: the hostname is resolved (ALL
 *      addresses — `dns.lookup(..., {all:true})`), and EVERY resolved
 *      address must be a PUBLIC address (`isPublicIp`, below). This is what
 *      stops DNS rebinding / a compromised allowlisted host resolving to a
 *      private or metadata address.
 *   4. Redirects handled MANUALLY (`redirect: 'manual'`) and re-checked
 *      end-to-end (scheme + host allowlist + DNS + IP-range) BEFORE EACH
 *      HOP — this is the load-bearing control. Without it, an allowlisted
 *      EC host that 302s to `http://169.254.169.254/latest/meta-data/` (the
 *      cloud metadata IP) would sail through on the strength of the
 *      first-hop check alone. Capped at `MAX_REDIRECTS` hops.
 *   5. Size cap + timeout: the response body is streamed with a running
 *      byte count capped at the same affidavit size limit `storeMedia`
 *      enforces (`MEDIA_LIMITS.affidavit`, 20 MB) — both from a lying
 *      `Content-Length` header and from the actual bytes read, so a body
 *      that omits/understates its length can't force an unbounded
 *      download. Each hop has its own request timeout (`FETCH_TIMEOUT_MS`)
 *      via `AbortController` — and (Task 37 review Fix 3) that timeout is
 *      NOT cleared once `fetch()` returns headers: it stays armed through
 *      the ENTIRE body read (`readBodyCapped` is passed the same
 *      `AbortSignal` and cancels its reader the instant the signal fires).
 *      Without this, a body that trickles in slower than
 *      `FETCH_TIMEOUT_MS` per byte — while staying under the 20 MB cap —
 *      could hold the request (and the curator's in-request `await`) open
 *      indefinitely; the size cap alone does not bound TIME, only bytes.
 *
 * What this module deliberately does NOT do: validate the fetched bytes are
 * actually a PDF. That is `storeMedia`'s job (magic-byte sniff + the same
 * size cap) — the caller MUST pass the returned `Buffer` through
 * `storeMedia(actor, {bytes}, 'affidavit')` before treating it as a stored
 * affidavit. This keeps "is it a valid PDF" as a single source of truth
 * shared with the direct-upload path, per architecture §7.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { MEDIA_LIMITS } from './media';

/**
 * Official EC / CEO-Karnataka domains the platform is willing to fetch an
 * affidavit from. Extend ONLY here — every check in this module reads from
 * this single list, so adding a domain here is the complete, sufficient
 * change (no other file needs to know about it).
 */
export const EC_AFFIDAVIT_HOSTS = ['eci.gov.in', 'ceo.karnataka.gov.in', 'affidavit.eci.gov.in'] as const;

export type AffidavitFetchErrorCode =
  | 'ssrf_scheme'
  | 'ssrf_host'
  | 'ssrf_ip'
  | 'ssrf_redirect_cap'
  | 'fetch_failed'
  | 'fetch_timeout'
  | 'media_too_large';

const MAX_REDIRECTS = 3;
const MAX_DOWNLOAD_BYTES = MEDIA_LIMITS.affidavit;
const FETCH_TIMEOUT_MS = 10_000;

/**
 * True iff `ip` (a literal IPv4 or IPv6 address string — NOT a hostname) is
 * a PUBLIC, routable address: not private (10/8, 172.16/12, 192.168/16),
 * not loopback (127/8, ::1), not link-local (169.254/16, fe80::/10 — which
 * covers the cloud metadata address 169.254.169.254), not unspecified
 * (0.0.0.0, ::), and not IPv6 ULA (fc00::/7). Returns `false` for anything
 * that isn't a syntactically valid IP literal at all (`net.isIP` returns 0).
 *
 * IPv4-mapped IPv6 literals (`::ffff:a.b.c.d`) are unwrapped and re-checked
 * against the IPv4 rules — otherwise `::ffff:127.0.0.1` would sail through
 * as "not one of the IPv6 special ranges" despite being loopback.
 */
export function isPublicIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPublicIpv4(ip);
  if (version === 6) return isPublicIpv6(ip);
  return false; // not a valid IP literal at all
}

function isPublicIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0) return false; // 0.0.0.0/8 — unspecified
  if (a === 10) return false; // 10/8 — private
  if (a === 127) return false; // 127/8 — loopback
  if (a === 169 && b === 254) return false; // 169.254/16 — link-local, incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16/12 — private
  if (a === 192 && b === 168) return false; // 192.168/16 — private
  return true;
}

/** Expands an IPv6 literal (any valid `::`-compressed or dotted-quad-embedded form) to 8 hextet strings. */
function expandIpv6(ip: string): string[] {
  let addr = ip;

  // Embedded IPv4 tail (e.g. "::ffff:192.168.1.1") — convert to two hextets.
  const ipv4Match = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const quad = ipv4Match[1].split('.').map(Number);
    const hex1 = ((quad[0] << 8) | quad[1]).toString(16);
    const hex2 = ((quad[2] << 8) | quad[3]).toString(16);
    addr = `${addr.slice(0, addr.length - ipv4Match[1].length)}${hex1}:${hex2}`;
  }

  let head: string[];
  let tail: string[];
  const doubleColonIdx = addr.indexOf('::');
  if (doubleColonIdx !== -1) {
    const left = addr.slice(0, doubleColonIdx);
    const right = addr.slice(doubleColonIdx + 2);
    head = left ? left.split(':') : [];
    tail = right ? right.split(':') : [];
  } else {
    head = addr.split(':');
    tail = [];
  }

  const missing = Math.max(8 - head.length - tail.length, 0);
  const zeros = new Array(missing).fill('0');
  return [...head, ...zeros, ...tail].map((h) => (h === '' ? '0' : h));
}

function ipv6ToBigInt(ip: string): bigint {
  let result = 0n;
  for (const hextet of expandIpv6(ip)) {
    result = (result << 16n) | BigInt(parseInt(hextet, 16) || 0);
  }
  return result;
}

/** Renders the low 32 bits of `v4` as a dotted-quad string, for handing off to `isPublicIpv4`. */
function low32ToIpv4String(v4: bigint): string {
  const a = Number((v4 >> 24n) & 0xffn);
  const b = Number((v4 >> 16n) & 0xffn);
  const c = Number((v4 >> 8n) & 0xffn);
  const d = Number(v4 & 0xffn);
  return `${a}.${b}.${c}.${d}`;
}

function isPublicIpv6(ip: string): boolean {
  const value = ipv6ToBigInt(ip);

  if (value === 0n) return false; // :: — unspecified
  if (value === 1n) return false; // ::1 — loopback
  if (value >> 118n === 0x3fan) return false; // fe80::/10 — link-local
  if (value >> 121n === 0x7en) return false; // fc00::/7 — unique local (ULA)

  // ::ffff:0:0/96 — IPv4-mapped: unwrap and re-check against the IPv4 rules.
  if (value >> 32n === 0xffffn) {
    return isPublicIpv4(low32ToIpv4String(value & 0xffffffffn));
  }

  // ::a.b.c.d/96 — the deprecated "IPv4-compatible" form (top 96 bits zero,
  // distinct from the ::ffff:/96 IPv4-MAPPED form above): unwrap the same
  // way. `:: ` (0n) and `::1` (1n) are already handled above, so this can't
  // misfire on those.
  if (value >> 32n === 0n) {
    return isPublicIpv4(low32ToIpv4String(value & 0xffffffffn));
  }

  return true;
}

/**
 * Runs the FULL check (scheme + host allowlist + DNS resolution + IP-range)
 * against `url`. Called once for the initial URL and again for every
 * redirect target BEFORE it is followed — this re-run is what makes a
 * redirect to a private/metadata address unreachable even from an
 * allowlisted starting host.
 */
async function checkUrlSafe(url: URL): Promise<void> {
  if (url.protocol !== 'https:') {
    throw new Error('ssrf_scheme' satisfies AffidavitFetchErrorCode);
  }

  const hostname = url.hostname.toLowerCase();

  // An IP-literal host (e.g. https://127.0.0.1/x, https://[::1]/x) is
  // rejected outright — the allowlist is a set of DOMAIN NAMES, and an IP
  // literal has no domain to match, so it can never be legitimately
  // allowlisted. Checked before the allowlist lookup for clarity, but the
  // allowlist check below would reject it anyway (no IP literal is in
  // EC_AFFIDAVIT_HOSTS).
  if (net.isIP(hostname) !== 0) {
    throw new Error('ssrf_host' satisfies AffidavitFetchErrorCode);
  }

  if (!(EC_AFFIDAVIT_HOSTS as readonly string[]).includes(hostname)) {
    throw new Error('ssrf_host' satisfies AffidavitFetchErrorCode);
  }

  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error('ssrf_ip' satisfies AffidavitFetchErrorCode);
  }
  for (const { address } of addresses) {
    if (!isPublicIp(address)) {
      throw new Error('ssrf_ip' satisfies AffidavitFetchErrorCode);
    }
  }
}

/**
 * Reads `response`'s body as a `Buffer`, enforcing `maxBytes` both against a
 * declared (possibly lying) `Content-Length` and against the actual streamed
 * byte count.
 *
 * `signal` (Task 37 review Fix 3) is the SAME `AbortSignal` used for the
 * `fetch()` call that produced `response` — the caller keeps its request
 * timeout armed through this whole read, rather than clearing it once
 * headers arrive, so a body that trickles in slower than the timeout (while
 * staying under `maxBytes`) can't hold the request open indefinitely. If
 * `signal` fires while a read is outstanding, the reader is cancelled and a
 * `fetch_timeout` error is thrown instead of hanging forever.
 */
async function readBodyCapped(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const declared = Number(declaredLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error('media_too_large' satisfies AffidavitFetchErrorCode);
    }
  }

  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();

    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
      throw new Error('fetch_timeout' satisfies AffidavitFetchErrorCode);
    }

    let timedOut = false;
    const onAbort = () => {
      timedOut = true;
      reader.cancel().catch(() => {});
    };
    signal?.addEventListener('abort', onAbort);

    try {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (timedOut) {
          throw new Error('fetch_timeout' satisfies AffidavitFetchErrorCode);
        }
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new Error('media_too_large' satisfies AffidavitFetchErrorCode);
          }
          chunks.push(value);
        }
      }
      return Buffer.concat(chunks.map((c) => Buffer.from(c)));
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  // No readable stream on the response (e.g. a simplified fetch mock in
  // tests) — fall back to buffering, still enforcing the cap on the result.
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error('media_too_large' satisfies AffidavitFetchErrorCode);
  }
  return buf;
}

/**
 * SSRF-hardened fetch of a curator-supplied EC affidavit URL. See the module
 * docstring for the full defense-in-depth rationale. Returns the raw
 * response body as a `Buffer` — the CALLER must still pass it through
 * `storeMedia(actor, {bytes}, 'affidavit')` for magic-byte + size
 * validation before treating it as a stored affidavit.
 */
export async function fetchAffidavitFromEc(url: string): Promise<Buffer> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new Error('ssrf_scheme' satisfies AffidavitFetchErrorCode);
  }

  await checkUrlSafe(current);

  let redirectCount = 0;
  for (;;) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    // Task 37 review Fix 3: `timeout` is deliberately NOT cleared right
    // after `fetch()` resolves — it is cleared in the `finally` below,
    // AFTER the body has been fully read (for the terminal 200 response) or
    // after the redirect target has been safety-checked (for a 30x hop).
    // Clearing it eagerly (the old behavior) would leave a slow-trickling
    // body under the 20 MB cap free to hold the request open forever.
    try {
      const response = await fetch(current, { redirect: 'manual', signal: controller.signal });

      if (response.status >= 300 && response.status < 400) {
        redirectCount += 1;
        if (redirectCount > MAX_REDIRECTS) {
          throw new Error('ssrf_redirect_cap' satisfies AffidavitFetchErrorCode);
        }
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('fetch_failed' satisfies AffidavitFetchErrorCode);
        }
        const next = new URL(location, current);
        // THE critical re-check: a redirect to an off-allowlist host or a
        // host resolving to a private/metadata IP is rejected here, BEFORE
        // it is ever followed.
        await checkUrlSafe(next);
        current = next;
        continue;
      }

      if (!response.ok) {
        throw new Error('fetch_failed' satisfies AffidavitFetchErrorCode);
      }

      return await readBodyCapped(response, MAX_DOWNLOAD_BYTES, controller.signal);
    } finally {
      clearTimeout(timeout);
    }
  }
}

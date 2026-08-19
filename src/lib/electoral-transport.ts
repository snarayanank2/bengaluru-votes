/**
 * The HTTP transport under `src/lib/electoral-api.ts`, split out for one
 * reason: **the BBMP electoral API serves an incomplete TLS chain, and Node's
 * `fetch` cannot talk to it at all.**
 *
 * ============================================================================
 * WHY THIS FILE EXISTS — do not "simplify" it back into a `fetch` call.
 *
 * `electoralapi.bbmpgov.in` presents ONLY its leaf certificate
 * (`CN=*.bbmpgov.in`). It omits the intermediate that signed it, "Go Daddy
 * Secure Certificate Authority - G2". Browsers and curl paper over this:
 * they cache intermediates and chase the certificate's AIA extension to
 * fetch a missing one. **Node does neither.** It ships Mozilla's ROOT store
 * and expects the server to send every intermediate, so the handshake fails:
 *
 *     TypeError: fetch failed
 *       cause: unable to verify the first certificate
 *
 * This is the trap that makes the bug expensive: `curl` from a laptop
 * succeeds, so the endpoint looks fine, and only the deployed server sees the
 * failure — as a generic "unavailable", indistinguishable from the upstream
 * being down.
 *
 * The fix is to supply the one missing link. `CA_BUNDLE` below is Node's own
 * default root store (`tls.rootCertificates`) PLUS that intermediate. Verified:
 * with it, the leaf validates against Node's bundled roots; without it, it does
 * not. So this is not a relaxation of TLS verification — every normal check
 * still runs, against the same roots as everything else. It closes a gap the
 * server left open. Turning verification OFF instead (`rejectUnauthorized:
 * false`) would be catastrophic here: this connection carries a citizen's
 * voter-ID number and returns their name.
 *
 * Two consequences worth holding:
 *  - If GoDaddy rotates that intermediate, or bbmpgov.in moves to another CA
 *    that also serves an incomplete chain, booth lookup starts returning
 *    `unavailable` until the PEM below is refreshed. That is a visible,
 *    honest failure state, not a silent wrong answer.
 *  - If they ever fix their chain, nothing here breaks — the bundle is the
 *    default roots plus one extra, so a correctly-served chain still verifies.
 *
 * The alternative (`NODE_EXTRA_CA_CERTS`, set per environment) was rejected:
 * it is process-wide, and an environment that forgets it breaks booth lookup
 * with no local signal. This travels with the code.
 * ============================================================================
 *
 * Kept deliberately thin — one function, no knowledge of what it is fetching —
 * so `electoral-api.ts` can be unit-tested by mocking this module, and neither
 * file needs a live network.
 */
import * as https from 'node:https';
import * as http from 'node:http';
import * as tls from 'node:tls';

/**
 * Go Daddy Secure Certificate Authority - G2 (serial 07), the intermediate
 * `electoralapi.bbmpgov.in` fails to send. Issued by "Go Daddy Root
 * Certificate Authority - G2", which IS in Node's default store.
 *
 *   subject: CN=Go Daddy Secure Certificate Authority - G2
 *   issuer:  CN=Go Daddy Root Certificate Authority - G2
 *   valid:   2011-05-03 .. 2031-05-03
 *   sha256:  97:3A:41:27:6F:FD:01:E0:27:A2:AA:D4:9E:34:C3:78:
 *            46:D3:E9:76:FF:6A:62:0B:67:12:E3:38:32:04:1A:A6
 *
 * Retrieved from the AIA URL in the server's own leaf certificate
 * (http://certificates.godaddy.com/repository/gdig2.crt) on 2026-08-19 and
 * checked both ways before being pasted here: it verifies the live leaf
 * against Node's bundled roots, and the leaf does not verify without it.
 * Re-check the fingerprint above against GoDaddy's repository before ever
 * replacing this block.
 */
const GODADDY_G2_INTERMEDIATE = `-----BEGIN CERTIFICATE-----
MIIE0DCCA7igAwIBAgIBBzANBgkqhkiG9w0BAQsFADCBgzELMAkGA1UEBhMCVVMx
EDAOBgNVBAgTB0FyaXpvbmExEzARBgNVBAcTClNjb3R0c2RhbGUxGjAYBgNVBAoT
EUdvRGFkZHkuY29tLCBJbmMuMTEwLwYDVQQDEyhHbyBEYWRkeSBSb290IENlcnRp
ZmljYXRlIEF1dGhvcml0eSAtIEcyMB4XDTExMDUwMzA3MDAwMFoXDTMxMDUwMzA3
MDAwMFowgbQxCzAJBgNVBAYTAlVTMRAwDgYDVQQIEwdBcml6b25hMRMwEQYDVQQH
EwpTY290dHNkYWxlMRowGAYDVQQKExFHb0RhZGR5LmNvbSwgSW5jLjEtMCsGA1UE
CxMkaHR0cDovL2NlcnRzLmdvZGFkZHkuY29tL3JlcG9zaXRvcnkvMTMwMQYDVQQD
EypHbyBEYWRkeSBTZWN1cmUgQ2VydGlmaWNhdGUgQXV0aG9yaXR5IC0gRzIwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC54MsQ1K92vdSTYuswZLiBCGzD
BNliF44v/z5lz4/OYuY8UhzaFkVLVat4a2ODYpDOD2lsmcgaFItMzEUz6ojcnqOv
K/6AYZ15V8TPLvQ/MDxdR/yaFrzDN5ZBUY4RS1T4KL7QjL7wMDge87Am+GZHY23e
cSZHjzhHU9FGHbTj3ADqRay9vHHZqm8A29vNMDp5T19MR/gd71vCxJ1gO7GyQ5HY
pDNO6rPWJ0+tJYqlxvTV0KaudAVkV4i1RFXULSo6Pvi4vekyCgKUZMQWOlDxSq7n
eTOvDCAHf+jfBDnCaQJsY1L6d8EbyHSHyLmTGFBUNUtpTrw700kuH9zB0lL7AgMB
AAGjggEaMIIBFjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAdBgNV
HQ4EFgQUQMK9J47MNIMwojPX+2yz8LQsgM4wHwYDVR0jBBgwFoAUOpqFBxBnKLbv
9r0FQW4gwZTaD94wNAYIKwYBBQUHAQEEKDAmMCQGCCsGAQUFBzABhhhodHRwOi8v
b2NzcC5nb2RhZGR5LmNvbS8wNQYDVR0fBC4wLDAqoCigJoYkaHR0cDovL2NybC5n
b2RhZGR5LmNvbS9nZHJvb3QtZzIuY3JsMEYGA1UdIAQ/MD0wOwYEVR0gADAzMDEG
CCsGAQUFBwIBFiVodHRwczovL2NlcnRzLmdvZGFkZHkuY29tL3JlcG9zaXRvcnkv
MA0GCSqGSIb3DQEBCwUAA4IBAQAIfmyTEMg4uJapkEv/oV9PBO9sPpyIBslQj6Zz
91cxG7685C/b+LrTW+C05+Z5Yg4MotdqY3MxtfWoSKQ7CC2iXZDXtHwlTxFWMMS2
RJ17LJ3lXubvDGGqv+QqG+6EnriDfcFDzkSnE3ANkR/0yBOtg2DZ2HKocyQetawi
DsoXiWJYRBuriSUBAA/NxBti21G00w9RKpv0vHP8ds42pM3Z2Czqrpv1KrKQ0U11
GIo/ikGQI31bS/6kA1ibRrLDYGCD+H1QQc7CoZDDu+8CL9IVVO5EFdkKrqeKM+2x
LXY2JtwE65/3YR8V3Idv7kaWKK2hJn0KCacuBKONvPi8BDAB
-----END CERTIFICATE-----`;

/** Node's default roots plus the one intermediate the server omits. */
const CA_BUNDLE: readonly string[] = [...tls.rootCertificates, GODADDY_G2_INTERMEDIATE];

/**
 * Hard cap on a response body. The upstream's real answers are well under a
 * kilobyte; anything approaching this is a broken or hostile peer, and
 * buffering it unbounded would be a free memory-exhaustion lever.
 */
const MAX_RESPONSE_BYTES = 256 * 1024;

const agent = new https.Agent({ ca: [...CA_BUNDLE], keepAlive: true });

/** Thrown when the request exceeded its deadline, so callers can say so precisely. */
export class TransportTimeoutError extends Error {
  override readonly name = 'TransportTimeoutError';
}

export interface JsonPostResponse {
  status: number;
  /** Raw body text. Parsing (and distrusting) it is the caller's job. */
  body: string;
}

/**
 * POST a JSON payload and read the response back as text. Rejects on network
 * error, on a body over {@link MAX_RESPONSE_BYTES}, and with
 * {@link TransportTimeoutError} on timeout. A non-2xx status is NOT an error
 * here — it comes back in `status` for the caller to interpret.
 *
 * Plain `http:` origins are supported so a local override of
 * `ELECTORAL_API_ORIGIN` can point at a stub; the CA bundle simply does not
 * apply there.
 */
export function postJson(url: string, payload: unknown, timeoutMs: number): Promise<JsonPostResponse> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const target = new URL(url);
    const secure = target.protocol === 'https:';
    const transport = secure ? https : http;

    const req = transport.request(
      target,
      {
        method: 'POST',
        agent: secure ? agent : undefined,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'content-length': body.byteLength,
          // Honest identification. The endpoint does not gate on User-Agent
          // (verified against the live host), so there is nothing to gain by
          // impersonating a browser, and whoever maintains a public service
          // deserves to know who is calling it.
          'user-agent': 'BengaluruVotes/1.0 (+https://bengaluruvotes.opencity.in)',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > MAX_RESPONSE_BYTES) {
            req.destroy(new Error('electoral-transport: response exceeded size cap'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', reject);
      },
    );

    // Covers a stalled connection as well as a stalled response — `destroy`
    // makes the 'error' handler below fire with our own error.
    req.setTimeout(timeoutMs, () => {
      req.destroy(new TransportTimeoutError(`electoral-transport: no response in ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.end(body);
  });
}

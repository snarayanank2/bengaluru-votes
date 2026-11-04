/**
 * src/lib/affidavit-fetch.ts — SSRF-hardened fetch of a curator-supplied EC
 * affidavit link (Task 37; architecture §7/§13; dormant, §15). Mocks `node:dns/promises`
 * and the global `fetch` — NEVER touches the real network. This is the
 * SECURITY-CRITICAL surface of the task: the redirect re-check (a mid-hop
 * bounce to an off-allowlist host, or to a host that resolves to the cloud
 * metadata address) is the load-bearing control under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lookup } from 'node:dns/promises';
import { fetchAffidavitFromEc, isPublicIp } from '../../src/lib/affidavit-fetch';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

describe('isPublicIp (Task 37)', () => {
  it.each([
    ['8.8.8.8', true],
    ['10.0.0.1', false], // 10/8 private
    ['192.168.1.1', false], // 192.168/16 private
    ['172.16.0.1', false], // 172.16/12 private
    ['127.0.0.1', false], // loopback
    ['169.254.169.254', false], // link-local — cloud metadata address
    ['0.0.0.0', false], // unspecified
    ['::1', false], // IPv6 loopback
    ['fe80::1', false], // IPv6 link-local
    ['fc00::1', false], // IPv6 ULA
    ['2606:4700:4700::1111', true], // real public IPv6 (Cloudflare DNS)
    // Task 37 review Fix 4: IPv4-mapped IPv6 (::ffff:a.b.c.d) must unwrap
    // and re-check against the IPv4 rules — otherwise a private/loopback
    // IPv4 address dressed up in its IPv6-mapped form would sail through.
    ['::ffff:127.0.0.1', false], // IPv4-mapped loopback
    ['::ffff:10.0.0.1', false], // IPv4-mapped 10/8 private
    ['::ffff:192.168.0.1', false], // IPv4-mapped 192.168/16 private
    ['::ffff:8.8.8.8', true], // IPv4-mapped PUBLIC address
    ['::127.0.0.1', false], // deprecated IPv4-compatible loopback form
  ])('isPublicIp(%s) === %s', (ip, expected) => {
    expect(isPublicIp(ip)).toBe(expected);
  });

  it('returns false for a non-IP string', () => {
    expect(isPublicIp('not-an-ip')).toBe(false);
    expect(isPublicIp('eci.gov.in')).toBe(false);
  });
});

describe('fetchAffidavitFromEc (Task 37) — SSRF hardening', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockedLookup.mockReset();
  });

  it('rejects an http:// url -> ssrf_scheme, never calls fetch', async () => {
    await expect(fetchAffidavitFromEc('http://eci.gov.in/affidavit.pdf')).rejects.toThrow('ssrf_scheme');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('rejects an off-allowlist host -> ssrf_host, never calls fetch', async () => {
    await expect(fetchAffidavitFromEc('https://evil.example/affidavit.pdf')).rejects.toThrow('ssrf_host');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an IP-literal host -> ssrf_host, never calls fetch', async () => {
    await expect(fetchAffidavitFromEc('https://127.0.0.1/affidavit.pdf')).rejects.toThrow('ssrf_host');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an IPv6-literal host -> ssrf_host, never calls fetch', async () => {
    await expect(fetchAffidavitFromEc('https://[::1]/affidavit.pdf')).rejects.toThrow('ssrf_host');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an allowlisted host that RESOLVES to a private IP -> ssrf_ip, never calls fetch', async () => {
    mockedLookup.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }] as any);
    await expect(fetchAffidavitFromEc('https://eci.gov.in/affidavit.pdf')).rejects.toThrow('ssrf_ip');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Fix 4: a DNS response with MIXED public + private addresses is rejected -> ssrf_ip (ANY private address rejects the whole resolution, never calls fetch)', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ] as any);
    await expect(fetchAffidavitFromEc('https://eci.gov.in/affidavit.pdf')).rejects.toThrow('ssrf_ip');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('THE critical control: a redirect to an off-allowlist host is rejected before being followed', async () => {
    mockedLookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as any); // initial host resolves fine
    fetchMock.mockResolvedValueOnce({
      status: 302,
      ok: false,
      headers: new Headers({ location: 'https://evil.example/steal-me.pdf' }),
    } as unknown as Response);

    await expect(fetchAffidavitFromEc('https://eci.gov.in/affidavit.pdf')).rejects.toThrow('ssrf_host');
    // Only the first hop was ever fetched — the malicious redirect target was never requested.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('THE critical control: a redirect to a host resolving to the cloud metadata IP is rejected before being followed', async () => {
    mockedLookup
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as any) // initial eci.gov.in -> public
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }] as any); // redirect target resolves to metadata IP
    fetchMock.mockResolvedValueOnce({
      status: 302,
      ok: false,
      headers: new Headers({ location: 'https://ceo.karnataka.gov.in/redirected' }),
    } as unknown as Response);

    await expect(fetchAffidavitFromEc('https://eci.gov.in/affidavit.pdf')).rejects.toThrow('ssrf_ip');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps redirects: a 4th redirect is rejected (ssrf_redirect_cap)', async () => {
    mockedLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as any);
    for (let i = 0; i < 4; i++) {
      fetchMock.mockResolvedValueOnce({
        status: 302,
        ok: false,
        headers: new Headers({ location: 'https://eci.gov.in/next-hop' }),
      } as unknown as Response);
    }

    await expect(fetchAffidavitFromEc('https://eci.gov.in/affidavit.pdf')).rejects.toThrow('ssrf_redirect_cap');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('follows up to 3 redirects to allowlisted, public-resolving hosts before succeeding', async () => {
    mockedLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as any);
    const pdfBytes = Buffer.from('%PDF-1.4\nfinal body\n%%EOF');
    for (let i = 0; i < 3; i++) {
      fetchMock.mockResolvedValueOnce({
        status: 302,
        ok: false,
        headers: new Headers({ location: 'https://eci.gov.in/next-hop' }),
      } as unknown as Response);
    }
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers({ 'content-length': String(pdfBytes.length) }),
      arrayBuffer: async () => bufferToArrayBuffer(pdfBytes),
    } as unknown as Response);

    const result = await fetchAffidavitFromEc('https://eci.gov.in/affidavit.pdf');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.toString('utf8')).toBe(pdfBytes.toString('utf8'));
  });

  it('rejects when Content-Length exceeds the 20MB cap (media_too_large)', async () => {
    mockedLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as any);
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers({ 'content-length': String(21 * 1024 * 1024) }),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);

    await expect(fetchAffidavitFromEc('https://eci.gov.in/affidavit.pdf')).rejects.toThrow('media_too_large');
  });

  it('happy path: allowlisted host, resolves public, 200 with %PDF body -> returns the Buffer', async () => {
    mockedLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as any);
    const pdfBytes = Buffer.from('%PDF-1.4\nfake affidavit body\n%%EOF');
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers({ 'content-length': String(pdfBytes.length) }),
      arrayBuffer: async () => bufferToArrayBuffer(pdfBytes),
    } as unknown as Response);

    const result = await fetchAffidavitFromEc('https://eci.gov.in/affidavit.pdf');
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString('utf8')).toBe(pdfBytes.toString('utf8'));
  });

  it('a non-2xx, non-redirect response is rejected (fetch_failed)', async () => {
    mockedLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as any);
    fetchMock.mockResolvedValueOnce({ status: 404, ok: false, headers: new Headers() } as unknown as Response);

    await expect(fetchAffidavitFromEc('https://eci.gov.in/affidavit.pdf')).rejects.toThrow('fetch_failed');
  });

  it('Fix 3: the per-hop timeout stays armed through the BODY-READ phase — a slow-trickle body times out instead of hanging forever', async () => {
    vi.useFakeTimers();
    try {
      mockedLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as any);

      let cancelled = false;
      // A body whose `pull` never enqueues or closes — simulates a body
      // trickling in slower than the fetch timeout, while staying well
      // under the 20MB size cap. Only the timeout's abort (which cancels
      // the reader, below) should ever settle this stream.
      const slowBody = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<void>(() => {});
        },
        cancel() {
          cancelled = true;
        },
      });

      fetchMock.mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: slowBody,
      } as unknown as Response);

      const resultPromise = fetchAffidavitFromEc('https://eci.gov.in/affidavit.pdf');
      const assertion = expect(resultPromise).rejects.toThrow('fetch_timeout');

      // Advance well past the module's FETCH_TIMEOUT_MS (10s) so the
      // AbortController fires; advanceTimersByTimeAsync interleaves
      // microtask flushes with each tick, letting the DNS lookup + fetch()
      // + body-read chain actually progress between advances.
      await vi.advanceTimersByTimeAsync(15_000);

      await assertion;
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

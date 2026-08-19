/**
 * The hand-rolled HTTP transport under the electoral API client
 * (src/lib/electoral-transport.ts).
 *
 * It is hand-rolled for one reason — the upstream's incomplete TLS chain
 * defeats Node's `fetch` (that file's header has the full account) — which
 * means the request/response/timeout/size-cap plumbing is ours to get right
 * rather than the platform's. Hence this file.
 *
 * Every case runs against a LOOPBACK server started here. Nothing leaves the
 * machine, and the TLS path is deliberately not exercised: a self-signed
 * local certificate would test our CA bundle against the wrong CA and prove
 * nothing about the real one. That the bundle completes the live chain was
 * verified out-of-band with `openssl verify` against Node's own root store —
 * see the fingerprint recorded in the module.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { postJson, TransportTimeoutError } from '../../src/lib/electoral-transport';

let server: http.Server | null = null;

/** Start a loopback server with the given handler; returns its origin. */
async function serve(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe('postJson', () => {
  it('POSTs the payload as JSON and returns the status and raw body', async () => {
    let seen: { method?: string; contentType?: string; accept?: string; ua?: string; body?: string } = {};

    const origin = await serve((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seen = {
          method: req.method,
          contentType: req.headers['content-type'],
          accept: req.headers['accept'],
          ua: req.headers['user-agent'],
          body: Buffer.concat(chunks).toString('utf8'),
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('[{"ok":true}]');
      });
    });

    const result = await postJson(`${origin}/searchby-epic`, { epic_no: 'ZZZ0000001' }, 5000);

    expect(result).toEqual({ status: 200, body: '[{"ok":true}]' });
    expect(seen.method).toBe('POST');
    expect(seen.contentType).toBe('application/json');
    expect(seen.accept).toBe('application/json');
    expect(JSON.parse(seen.body!)).toEqual({ epic_no: 'ZZZ0000001' });
  });

  // Identifying ourselves honestly rather than impersonating a browser is a
  // deliberate choice (the endpoint does not gate on User-Agent).
  it('identifies itself as this platform, not as a browser', async () => {
    let ua = '';
    const origin = await serve((req, res) => {
      ua = req.headers['user-agent'] ?? '';
      res.writeHead(200).end('[]');
    });

    await postJson(`${origin}/x`, {}, 5000);

    expect(ua).toContain('BengaluruVotes');
    expect(ua).not.toContain('Mozilla');
  });

  // A non-2xx is data, not an exception: the client maps it to `unavailable`
  // itself and needs the status to do so.
  it.each([400, 422, 500, 503])('returns a %i rather than throwing', async (status) => {
    const origin = await serve((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end('{"detail":"nope"}');
    });

    const result = await postJson(`${origin}/x`, {}, 5000);

    expect(result.status).toBe(status);
    expect(result.body).toBe('{"detail":"nope"}');
  });

  it('handles a multi-chunk response body', async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('[{"a":1},');
      res.write('{"b":2}]');
      res.end();
    });

    const result = await postJson(`${origin}/x`, {}, 5000);

    expect(JSON.parse(result.body)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('reads a UTF-8 body (Kannada names) without mangling it across chunks', async () => {
    const kannada = 'ನಮ್ಮೂರ ಸರಕಾರಿ ಹಿರಿಯ ಪ್ರಾಥಮಿಕ ಶಾಲೆ';
    const origin = await serve((_req, res) => {
      const payload = Buffer.from(JSON.stringify({ n: kannada }), 'utf8');
      res.writeHead(200, { 'content-type': 'application/json' });
      // Split mid-character on purpose: a naive per-chunk toString('utf8')
      // corrupts the boundary, which would silently garble Kannada names.
      res.write(payload.subarray(0, 25));
      res.write(payload.subarray(25));
      res.end();
    });

    const result = await postJson(`${origin}/x`, {}, 5000);

    expect(JSON.parse(result.body).n).toBe(kannada);
  });

  // A citizen waiting on a government API that has stalled must get a
  // distinct answer from one whose lookup genuinely failed.
  it('rejects with TransportTimeoutError when the server never responds', async () => {
    const origin = await serve(() => {
      /* deliberately never responds */
    });

    await expect(postJson(`${origin}/x`, {}, 150)).rejects.toBeInstanceOf(TransportTimeoutError);
  });

  it('rejects on a connection error', async () => {
    // Port 1 on loopback: nothing is listening, connection refused.
    await expect(postJson('http://127.0.0.1:1/x', {}, 2000)).rejects.toThrow();
  });

  // Unbounded buffering of a hostile or broken peer's response is a free
  // memory-exhaustion lever on a single-VM deployment.
  it('rejects a response body over the size cap instead of buffering it', async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      // 512KB, twice the 256KB cap.
      for (let i = 0; i < 512; i++) res.write('x'.repeat(1024));
      res.end();
    });

    await expect(postJson(`${origin}/x`, {}, 5000)).rejects.toThrow(/size cap/);
  });
});

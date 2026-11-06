import { afterEach, describe, expect, it, vi } from 'vitest';
import { flagNetworkHash, readFlagBody } from '../../src/lib/flag-http';
import { flagBrowserHash, issueFlagToken, FLAG_COOKIE_SECONDS } from '../../src/lib/flag-abuse';
import { deriveTargetWardId } from '../../src/lib/flags';
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('flag security boundary', () => {
  it('accepts only issued, untampered, unexpired tokens', () => {
    const token = issueFlagToken();
    expect(flagBrowserHash(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(flagBrowserHash(token.slice(0,-1)+(token.endsWith('a')?'b':'a'))).toBeNull();
    vi.useFakeTimers(); vi.setSystemTime(Date.now()+FLAG_COOKIE_SECONDS*1000);
    expect(flagBrowserHash(token)).toBeNull();
  });
  it('ignores the protected header and rejects XFF on a direct deployment', () => {
    vi.stubEnv('FLAGS_TRUST_PROXY','');
    const request = new Request('http://localhost',{headers:{'x-flag-client-ip':'203.0.113.9'}});
    expect(flagNetworkHash(request,'192.0.2.1')).toBe(flagNetworkHash(new Request('http://localhost'),'192.0.2.1'));
    request.headers.set('x-forwarded-for','203.0.113.9');
    expect(()=>flagNetworkHash(request,'203.0.113.9')).toThrow('flag_client_address_unavailable');
  });
  it('uses only the overwritten proxy header when explicitly enabled', () => {
    vi.stubEnv('FLAGS_TRUST_PROXY','true');
    const request = new Request('https://example.com',{headers:{'x-flag-client-ip':'192.0.2.1','x-forwarded-for':'203.0.113.9'}});
    const hash=flagNetworkHash(request,'10.0.0.2');
    vi.stubEnv('FLAGS_TRUST_PROXY','');
    expect(hash).toBe(flagNetworkHash(new Request('http://localhost'),'192.0.2.1'));
  });
  it('canonicalizes mapped IPv4 and equivalent IPv6', () => {
    const r=new Request('http://localhost');
    expect(flagNetworkHash(r,'::ffff:192.0.2.1')).toBe(flagNetworkHash(r,'192.0.2.1'));
    expect(flagNetworkHash(r,'2001:db8:0:0:0:0:0:1')).toBe(flagNetworkHash(r,'2001:db8::1'));
  });
  it('rejects an oversized streamed body without a Content-Length', async () => {
    const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(131072)); c.enqueue(new Uint8Array(1)); c.close();}});
    const r=new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'} as RequestInit);
    await expect(readFlagBody(r)).rejects.toMatchObject({status:413});
  });
  it('rejects noncanonical target ids before querying the database', async () => {
    await expect(deriveTargetWardId('candidate_field','candidate:00001:age')).rejects.toThrow('invalid_flag_target');
    await expect(deriveTargetWardId('candidate_field','candidate:999999999999999999999:age')).rejects.toThrow('invalid_flag_target');
  });
});

it('rejects forged forwarding identity through the actual Astro adapter in direct mode', async () => {
  const { NodeApp } = await import('astro/app/node');
  const { IncomingMessage } = await import('node:http');
  const { Socket } = await import('node:net');
  const raw = new IncomingMessage(new Socket());
  raw.method='GET'; raw.url='/api/flags'; raw.headers={host:'localhost','x-forwarded-for':'203.0.113.99'};
  const request=NodeApp.createRequest(raw);
  const symbol=Object.getOwnPropertySymbols(request).find(key=>String(key).includes('clientAddress'))!;
  const address=Reflect.get(request,symbol) as string;
  expect(address).toBe('203.0.113.99'); // The adapter really accepts this header.
  vi.stubEnv('FLAGS_TRUST_PROXY','');
  expect(()=>flagNetworkHash(request,address)).toThrow('flag_client_address_unavailable');
});

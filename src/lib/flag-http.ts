/** HTTP boundary: bounded stream parsing and explicit, deployment-owned proxy trust. */
import { isIP } from 'node:net';
import { flagHash } from './flag-abuse';
/** Nine targets at the schema maxima (Kannada text is 3 bytes a character) fit; keep in step with nginx's `client_max_body_size` on the flag locations. */
export const FLAG_BODY_BYTES = 128 * 1024;
export class FlagBodyError extends Error { constructor(public status: number) { super('invalid_flag_body'); } }
export async function readFlagBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new FlagBodyError(400);
  const size = Number(request.headers.get('content-length'));
  if (size > FLAG_BODY_BYTES) throw new FlagBodyError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new FlagBodyError(400);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > FLAG_BODY_BYTES) { await reader.cancel(); throw new FlagBodyError(413); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error instanceof FlagBodyError) throw error; throw new FlagBodyError(400); }
  finally { reader.releaseLock(); }
}
export function flagNetworkHash(request: Request, clientAddress: string): string {
  // Production Compose explicitly enables this; nginx overwrites the header.
  // The app has no exposed production port. Never read X-Forwarded-For.
  // Astro's Node adapter accepts X-Forwarded-For even in direct mode.
  // Reject it here so clientAddress can only represent the socket peer.
  if (process.env.FLAGS_TRUST_PROXY !== 'true' && request.headers.has('x-forwarded-for')) throw new Error('flag_client_address_unavailable');
  let address = process.env.FLAGS_TRUST_PROXY === 'true' ? request.headers.get('x-flag-client-ip') ?? '' : clientAddress;
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) address = address.slice(7);
  if (!isIP(address)) throw new Error('flag_client_address_unavailable');
  if (isIP(address) === 6) address = new URL(`http://[${address}]/`).hostname.slice(1,-1);
  return flagHash('network', address);
}
export const flagJson = (body: unknown, status = 200, retryAfterSeconds = 60) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(status === 429 || status === 503 ? { 'retry-after': String(retryAfterSeconds) } : {}) } });

/**
 * GET /media/{id}/{hash} — public, immutable, content-hashed media serving
 * (architecture §5-§7, §13; Task 35).
 *
 * PUBLIC: affidavit PDFs are public sources
 * — this route reads no session/cookie, and is not gated by role.
 *
 * The `{hash}` path segment is the first 16 hex chars of the stored row's
 * sha256, i.e. the URL IS the cache key: an edit produces a new
 * `media` row (new id, new hash), so this URL never needs invalidating —
 * hence the long, immutable `Cache-Control` below and nginx's long-TTL
 * cache for this path (Task 60).
 *
 * A mismatched hash 404s — same as an unknown id — rather than 403, so a
 * guess against a valid id with the wrong hash reveals nothing about
 * whether that id exists.
 *
 * `Content-Type` is always the STORED (ingest-time, magic-byte-validated)
 * type — never re-sniffed from the bytes and never taken from any
 * query/declared type at serve time (arch §13). Paired with
 * `X-Content-Type-Options: nosniff` and an `inline` `Content-Disposition`
 * (citizens read affidavit PDFs in-browser; nosniff + the validated stored
 * type is what makes `inline` safe here).
 */
import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { media } from '../../../db/schema';


export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  const hash = params.hash ?? '';

  if (!Number.isInteger(id) || id <= 0) {
    return new Response('Not found', { status: 404 });
  }

  const [row] = await db.select().from(media).where(eq(media.id, id));
  // Only affidavit PDFs are stored; anything else is not served.
  if (!row || row.contentType !== 'application/pdf') {
    return new Response('Not found', { status: 404 });
  }

  // Constant-effort-ish string compare is unnecessary here — the hash
  // segment is not a secret (it's derived from public content and visible
  // in every media URL); this is a lookup key, not an auth token.
  if (hash !== row.sha256.slice(0, 16)) {
    return new Response('Not found', { status: 404 });
  }

  const filename = `affidavit-${id}.pdf`;

  // TS 5.7+'s `BodyInit` wants a `Uint8Array<ArrayBuffer>`; `Buffer`'s own
  // type is generic over `ArrayBufferLike` and doesn't structurally
  // satisfy that. `Uint8Array.from` copies into a fresh, plain
  // `ArrayBuffer`-backed typed array, which does.
  const body = Uint8Array.from(row.bytes);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': row.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};

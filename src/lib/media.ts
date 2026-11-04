/**
 * The media store (Task 35; architecture §5-§7, §13) — curator-uploaded
 * candidate photos and affidavit PDFs, stored as `bytea` in Postgres and
 * served back at an immutable content-hashed URL (`/media/{id}/{hash}`).
 *
 * SECURITY (arch §13): the declared MIME type and any filename extension
 * are NEVER trusted — both are attacker-controlled. `storeMedia` sniffs the
 * real type from the file's magic bytes and validates it against the
 * `kind`'s allowlist; an SVG (a script container, servable from this
 * origin) is rejected even when its declared type/extension claims to be a
 * PNG or JPEG. The type stored in `media.content_type` is the SNIFFED
 * (validated) type, not the caller's `declaredType` — the serving route
 * (`src/pages/media/[id]/[hash].ts`) echoes that stored type back and never
 * re-sniffs or re-derives it from the request.
 */
import crypto from 'node:crypto';
import { db } from '../db/client';
import { media } from '../db/schema';

export type MediaKind = 'photo' | 'affidavit';

/** Size caps in bytes: photos ≤2 MB, affidavit PDFs ≤20 MB. */
export const MEDIA_LIMITS: Record<MediaKind, number> = {
  photo: 2 * 1024 * 1024,
  affidavit: 20 * 1024 * 1024,
};

export type SniffedMediaType = 'jpeg' | 'png' | 'webp' | 'pdf' | 'svg' | 'gif' | 'unknown';

/** Error codes `storeMedia` throws (as `Error.message`, matching this codebase's convention — see votes.ts's `CastVoteErrorCode`). Later route tasks map these to 400/413. */
export type MediaStoreErrorCode = 'unsupported_media_type' | 'media_too_large';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = Buffer.from('%PDF', 'ascii');
const GIF87_MAGIC = Buffer.from('GIF87a', 'ascii');
const GIF89_MAGIC = Buffer.from('GIF89a', 'ascii');

/**
 * Sniffs the real file type from magic bytes — the ONLY thing `storeMedia`
 * trusts (never the caller's declared type or filename extension). Exported
 * standalone so tests can assert SVG/GIF are correctly identified (and thus
 * correctly rejected) without going through the full store+DB path.
 */
export function sniffMediaType(bytes: Buffer): SniffedMediaType {
  if (bytes.length >= JPEG_MAGIC.length && bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) {
    return 'jpeg';
  }
  if (bytes.length >= PNG_MAGIC.length && bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  if (bytes.length >= PDF_MAGIC.length && bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    return 'pdf';
  }
  if (
    (bytes.length >= GIF87_MAGIC.length && bytes.subarray(0, GIF87_MAGIC.length).equals(GIF87_MAGIC)) ||
    (bytes.length >= GIF89_MAGIC.length && bytes.subarray(0, GIF89_MAGIC.length).equals(GIF89_MAGIC))
  ) {
    return 'gif';
  }
  // SVG has no fixed magic-byte signature (it's text/XML) — sniff by
  // looking for an XML declaration or an <svg> root tag near the start of
  // the file, tolerating leading whitespace/BOM. This is what catches the
  // "SVG masquerading as a .png" attack: the bytes are checked regardless
  // of what the caller declared or named the file.
  const head = bytes.subarray(0, 256).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) {
    return 'svg';
  }
  return 'unknown';
}

const CANONICAL_CONTENT_TYPE: Partial<Record<SniffedMediaType, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

const ALLOWED_TYPES_BY_KIND: Record<MediaKind, SniffedMediaType[]> = {
  photo: ['jpeg', 'png', 'webp'],
  affidavit: ['pdf'],
};

export interface MediaFileInput {
  bytes: Buffer;
  /** Attacker-controlled; IGNORED for validation — kept only for logging/debugging by callers, never trusted. */
  declaredType?: string;
}

export interface StoredMedia {
  id: number;
  hash: string;
  url: string;
}

/**
 * Validates (magic-byte sniff + size cap) and stores an uploaded file as a
 * `media` row. Throws `Error('unsupported_media_type')` when the sniffed
 * type isn't in `kind`'s allowlist (wrong kind, or an unknown/SVG/GIF
 * type), and `Error('media_too_large')` when `bytes` exceeds `kind`'s cap
 * in `MEDIA_LIMITS`. `file.declaredType` is accepted for interface
 * symmetry with callers but never consulted.
 */
export async function storeMedia(
  actor: { userId: number },
  file: MediaFileInput,
  kind: MediaKind,
): Promise<StoredMedia> {
  const limit = MEDIA_LIMITS[kind];
  if (file.bytes.length > limit) {
    throw new Error('media_too_large' satisfies MediaStoreErrorCode);
  }

  const sniffed = sniffMediaType(file.bytes);
  const allowed = ALLOWED_TYPES_BY_KIND[kind];
  if (!allowed.includes(sniffed)) {
    throw new Error('unsupported_media_type' satisfies MediaStoreErrorCode);
  }

  const contentType = CANONICAL_CONTENT_TYPE[sniffed]!;
  const sha256 = crypto.createHash('sha256').update(file.bytes).digest('hex');

  const [row] = await db
    .insert(media)
    .values({
      bytes: file.bytes,
      contentType,
      sha256,
      size: file.bytes.length,
      createdBy: actor.userId,
    })
    .returning({ id: media.id });

  const id = row!.id;
  const hashSegment = sha256.slice(0, 16);
  return { id, hash: sha256, url: `/media/${id}/${hashSegment}` };
}

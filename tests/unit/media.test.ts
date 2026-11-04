import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { sniffMediaType, storeMedia, MEDIA_MAX_BYTES } from '../../src/lib/media';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see AGENTS.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific fixture id (Task 35 brief) — this suite owns 99350.
// media.createdBy carries no FK, so a bare id (no real users row) is fine.
const ACTOR = { userId: 99350 };

// --- Real magic-byte fixtures -------------------------------------------

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body-for-test'),
]);

const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]), // chunk size, irrelevant for sniffing
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('fake-webp-body'),
]);

const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake-pdf-body-for-test\n%%EOF');

const GIF_BYTES = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from('fake-gif-body')]);

const SVG_BYTES = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');

const SVG_BYTES_NO_XML_DECL = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

const UNKNOWN_BYTES = crypto.randomBytes(32);

describe('sniffMediaType (Task 35)', () => {
  it('identifies real JPEG magic bytes', () => {
    expect(sniffMediaType(JPEG_BYTES)).toBe('jpeg');
  });

  it('identifies real PNG magic bytes', () => {
    expect(sniffMediaType(PNG_BYTES)).toBe('png');
  });

  it('identifies real WebP (RIFF....WEBP) magic bytes', () => {
    expect(sniffMediaType(WEBP_BYTES)).toBe('webp');
  });

  it('identifies real PDF magic bytes (%PDF)', () => {
    expect(sniffMediaType(PDF_BYTES)).toBe('pdf');
  });

  it('identifies an SVG (<?xml ...<svg) as svg, not an image type', () => {
    expect(sniffMediaType(SVG_BYTES)).toBe('svg');
  });

  it('identifies an SVG with no xml declaration (<svg ...) as svg', () => {
    expect(sniffMediaType(SVG_BYTES_NO_XML_DECL)).toBe('svg');
  });

  it('identifies a GIF (GIF89a) as gif', () => {
    expect(sniffMediaType(GIF_BYTES)).toBe('gif');
  });

  it('random bytes -> unknown', () => {
    expect(sniffMediaType(UNKNOWN_BYTES)).toBe('unknown');
  });
});

describe('storeMedia (Task 35)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
  });

  afterAll(async () => {
    await client.end();
  });

  it('stores a valid PDF: returns url /media/{id}/{16hex}, contentType application/pdf, correct sha256', async () => {
    const result = await storeMedia(ACTOR, { bytes: PDF_BYTES });

    expect(typeof result.id).toBe('number');
    const expectedSha256 = crypto.createHash('sha256').update(PDF_BYTES).digest('hex');
    expect(result.hash).toBe(expectedSha256);
    expect(result.url).toBe(`/media/${result.id}/${expectedSha256.slice(0, 16)}`);

    const [row] = await db.select().from(schema.media).where(eq(schema.media.id, result.id));
    expect(row).toBeDefined();
    expect(row!.contentType).toBe('application/pdf');
    expect(row!.sha256).toBe(expectedSha256);
    expect(row!.size).toBe(PDF_BYTES.length);
    expect(row!.createdBy).toBe(ACTOR.userId);
  });

  it('rejects an image (PNG) even when declared as application/pdf -- sniff wins', async () => {
    await expect(storeMedia(ACTOR, { bytes: PNG_BYTES, declaredType: 'application/pdf' })).rejects.toThrow(
      'unsupported_media_type',
    );
  });

  it('rejects an SVG masquerading as a PDF', async () => {
    await expect(storeMedia(ACTOR, { bytes: SVG_BYTES, declaredType: 'application/pdf' })).rejects.toThrow(
      'unsupported_media_type',
    );
  });

  it('rejects a GIF', async () => {
    await expect(storeMedia(ACTOR, { bytes: GIF_BYTES })).rejects.toThrow('unsupported_media_type');
  });

  it('rejects an oversize PDF (> 20 MB) before any type check', async () => {
    const big = Buffer.concat([PDF_BYTES, Buffer.alloc(MEDIA_MAX_BYTES)]);
    expect(big.length).toBeGreaterThan(MEDIA_MAX_BYTES);
    await expect(storeMedia(ACTOR, { bytes: big })).rejects.toThrow('media_too_large');
  });
});

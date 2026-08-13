import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';
import { storeMedia } from '../../src/lib/media';
import { GET as mediaGET } from '../../src/pages/media/[id]/[hash].ts';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific fixture id (Task 35 brief) — this suite owns 99351.
const ACTOR = { userId: 99351 };

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body-for-route-test'),
]);

const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake-pdf-body-for-route-test\n%%EOF');

function req(path: string): Request {
  return new Request(`http://localhost${path}`);
}

async function get(id: number | string, hash: string) {
  return mediaGET({ params: { id: String(id), hash }, request: req(`/media/${id}/${hash}`) } as any);
}

describe('GET /media/{id}/{hash} (Task 35)', () => {
  let photoId: number;
  let photoHash: string;
  let pdfId: number;
  let pdfHash: string;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    const photo = await storeMedia(ACTOR, { bytes: PNG_BYTES }, 'photo');
    photoId = photo.id;
    photoHash = photo.hash.slice(0, 16);

    const pdf = await storeMedia(ACTOR, { bytes: PDF_BYTES }, 'affidavit');
    pdfId = pdf.id;
    pdfHash = pdf.hash.slice(0, 16);
  });

  afterAll(async () => {
    await client.end();
  });

  it('correct id + hash -> 200, body = stored bytes, stored Content-Type, nosniff, Content-Disposition, long immutable cache', async () => {
    const res = await get(photoId, photoHash);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Disposition')).toContain('inline');
    expect(res.headers.get('Content-Disposition')).toContain(`photo-${photoId}`);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(PNG_BYTES)).toBe(true);
  });

  it('a PDF is served inline with a .pdf filename and Content-Type application/pdf (stored, not sniffed)', async () => {
    const res = await get(pdfId, pdfHash);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('inline');
    expect(res.headers.get('Content-Disposition')).toContain(`affidavit-${pdfId}.pdf`);

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(PDF_BYTES)).toBe(true);
  });

  it('wrong hash (valid id) -> 404', async () => {
    const res = await get(photoId, '0000000000000000');
    expect(res.status).toBe(404);
  });

  it('unknown id -> 404', async () => {
    const res = await get(999999999, photoHash);
    expect(res.status).toBe(404);
  });

  it('non-numeric id -> 404 (not a 500)', async () => {
    const res = await get('not-a-number', photoHash);
    expect(res.status).toBe(404);
  });
});

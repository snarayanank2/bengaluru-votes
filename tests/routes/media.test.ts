import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';
import { storeMedia } from '../../src/lib/media';
import { GET as mediaGET } from '../../src/pages/media/[id]/[hash].ts';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see AGENTS.md ("Tests need a database") for how to get one.',
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
  let pdfId: number;
  let pdfHash: string;
  let imageId: number;
  let imageHash: string;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    const pdf = await storeMedia(ACTOR, { bytes: PDF_BYTES });
    pdfId = pdf.id;
    pdfHash = pdf.hash.slice(0, 16);

    // A legacy non-PDF row (e.g. an old candidate photo) written directly:
    // storeMedia no longer accepts images, and the route must not serve one.
    const sha256 = crypto.createHash('sha256').update(PNG_BYTES).digest('hex');
    const [image] = await db
      .insert(schema.media)
      .values({ bytes: PNG_BYTES, contentType: 'image/png', sha256, size: PNG_BYTES.length, createdBy: ACTOR.userId })
      .returning({ id: schema.media.id });
    imageId = image!.id;
    imageHash = sha256.slice(0, 16);
  });

  afterAll(async () => {
    await client.end();
  });

  it('correct id + hash -> 200, body = stored bytes, application/pdf, nosniff, inline .pdf filename, long immutable cache', async () => {
    const res = await get(pdfId, pdfHash);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Disposition')).toContain('inline');
    expect(res.headers.get('Content-Disposition')).toContain(`affidavit-${pdfId}.pdf`);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(PDF_BYTES)).toBe(true);
  });

  it('a stored non-PDF row is not served (404)', async () => {
    const res = await get(imageId, imageHash);
    expect(res.status).toBe(404);
  });

  it('wrong hash (valid id) -> 404', async () => {
    const res = await get(pdfId, '0000000000000000');
    expect(res.status).toBe(404);
  });

  it('unknown id -> 404', async () => {
    const res = await get(999999999, pdfHash);
    expect(res.status).toBe(404);
  });

  it('non-numeric id -> 404 (not a 500)', async () => {
    const res = await get('not-a-number', pdfHash);
    expect(res.status).toBe(404);
  });
});

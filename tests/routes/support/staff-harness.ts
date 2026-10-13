/**
 * Shared set-up for the curator route suites: a database handle, a request
 * driven through the REAL middleware and the real page twin (the technique
 * every route suite here uses), people with sessions, and a candidate with
 * a published affidavit behind it.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../src/db/schema';
import { db as appDb } from '../../../src/db/client';
import { SESSION_COOKIE, createSession } from '../../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../../src/lib/csrf';
import { onRequest } from '../../../src/middleware';
import { fieldsFromExtraction, publishAffidavitFields } from '../../../src/lib/affidavit-publish';
import type { AffidavitExtraction } from '../../../src/lib/affidavit-extraction';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. These tests need a Postgres database of their own — see AGENTS.md ("Tests need a database").');
}

export const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const SITE_URL = new URL(SITE_ORIGIN);

export const client = postgres(process.env.DATABASE_URL, { max: 1 });
export const db = drizzle(client, { schema });
export { schema };

export type Role = 'citizen' | 'transcriber' | 'curator' | 'admin';
export type Auth = { userId: number; cookieValue: string; token: string };
export interface WardFixture { id: number; nameEn: string; nameKn: string; corporation: 'south'; zone: string; boundaryRef: string }

export function ward(id: number, label: string): WardFixture {
  return { id, nameEn: `${id % 1000} - ${label}`, nameKn: `${label} ಕನ್ನಡ`, corporation: 'south', zone: 'Zone T', boundaryRef: `staff-harness-${id}` };
}

async function makeContainer() {
  return AstroContainer.create({
    astroConfig: { site: SITE_ORIGIN, i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } } },
  });
}

export async function run(component: unknown, path: string, opts: { auth?: Auth; form?: FormData; params?: Record<string, string> } = {}): Promise<Response> {
  const url = new URL(path, SITE_URL);
  const headers = new Headers({ 'sec-fetch-site': 'same-origin' });
  const cookieValue = opts.auth?.cookieValue;
  if (cookieValue) headers.set('cookie', `${SESSION_COOKIE}=${cookieValue}`);
  const request = new Request(url, { method: opts.form ? 'POST' : 'GET', headers, body: opts.form });
  const cookiesStub = { get: (name: string) => (name === SESSION_COOKIE && cookieValue ? { value: cookieValue } : undefined) };
  const locals: Record<string, unknown> = {};
  const ctx = { request, url, site: SITE_URL, cookies: cookiesStub, locals } as any;
  const container = await makeContainer();
  const next = async () => container.renderToResponse(component as any, { partial: false, params: opts.params, request, locals: locals as unknown as App.Locals });
  return (await onRequest(ctx, next)) as Response;
}

/** Tracks what a suite created so `cleanup` can remove exactly that. */
export class Fixtures {
  userIds: number[] = [];
  wardIds: number[] = [];
  constructor(private emailPrefix: string) {}

  async wards(...wards: WardFixture[]): Promise<void> {
    for (const w of wards) {
      await db.insert(schema.wards).values(w).onConflictDoUpdate({ target: schema.wards.id, set: w });
      this.wardIds.push(w.id);
    }
  }

  async person(role: Role): Promise<Auth> {
    const [row] = await db.insert(schema.users).values({ email: `${this.emailPrefix}${randomUUID()}@example.com`, role }).returning({ id: schema.users.id });
    this.userIds.push(row.id);
    const { id, cookieValue } = await createSession(row.id);
    return { userId: row.id, cookieValue, token: issueCsrfToken(id) };
  }

  /** A stored PDF. `createdBy` is the first person this suite made, so cleanup finds it. */
  async pdf(): Promise<{ mediaId: number; sha256: string; pdfUrl: string }> {
    const bytes = Buffer.from(`%PDF-1.4 staff harness ${randomUUID()}`);
    const sha256 = randomUUID().replace(/-/g, '').padEnd(64, '0');
    const [m] = await db.insert(schema.media).values({ bytes, contentType: 'application/pdf', sha256, size: bytes.length, createdBy: this.userIds[0] }).returning({ id: schema.media.id });
    return { mediaId: m.id, sha256, pdfUrl: `/media/${m.id}/${sha256.slice(0, 16)}` };
  }

  /** A candidate with a published, AI-read affidavit: what a citizen flags. */
  async candidateWithAffidavit(wardId: number) {
    const e = extraction(wardId);
    const { mediaId, sha256, pdfUrl } = await this.pdf();
    const [c] = await db.insert(schema.candidates).values({ slug: `staff-harness-${randomUUID()}`, wardId, nameEn: e.identity.name.text!, partyEn: e.identity.party.text! }).returning({ id: schema.candidates.id, slug: schema.candidates.slug });
    await appDb.transaction((tx) => publishAffidavitFields(tx, { userId: null, role: 'system' }, c.id, fieldsFromExtraction(e), { sourceUrl: pdfUrl, checked: false }));
    const [a] = await db.insert(schema.candidateAffidavits).values({ candidateId: c.id, mediaId, sha256, state: 'published', extraction: e, confidence: e.confidence, attempts: 1 }).returning({ id: schema.candidateAffidavits.id });
    return { candidateId: c.id, slug: c.slug, affidavitId: a.id, pdfUrl, extraction: e };
  }

  /** A candidate somebody typed in, with no affidavit behind it. */
  async bareCandidate(wardId: number, nameEn = `Bare Person ${randomUUID().slice(0, 8)} (FICTIONAL)`): Promise<number> {
    const [c] = await db.insert(schema.candidates).values({ slug: `staff-harness-${randomUUID()}`, wardId, nameEn, partyEn: 'Independent' }).returning({ id: schema.candidates.id });
    return c.id;
  }

  /** An affidavit the worker read but could not publish. */
  async waitingAffidavit(opts: { wardId: number; reason: 'ward_unresolved' | 'possible_duplicate' | 'reported_by_transcriber'; candidateId?: number; note?: string; name?: string }) {
    const e = extraction(opts.wardId, opts.name);
    const { mediaId, sha256, pdfUrl } = await this.pdf();
    const [a] = await db
      .insert(schema.candidateAffidavits)
      .values({ candidateId: opts.candidateId ?? null, mediaId, sha256, state: 'needs_matching', matchReason: opts.reason, matchNote: opts.note ?? null, extraction: e, confidence: e.confidence, attempts: 1 })
      .returning({ id: schema.candidateAffidavits.id });
    return { affidavitId: a.id, pdfUrl, extraction: e };
  }

  async cleanup(): Promise<void> {
    if (this.wardIds.length) await db.delete(schema.flagSubmissions).where(inArray(schema.flagSubmissions.flagItemId, db.select({ id: schema.flagItems.id }).from(schema.flagItems).where(inArray(schema.flagItems.wardId, this.wardIds))));
    if (this.wardIds.length) await db.delete(schema.flagItems).where(inArray(schema.flagItems.wardId, this.wardIds));
    const mediaIds = this.userIds.length ? (await db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.createdBy, this.userIds[0]))).map((r) => r.id) : [];
    if (mediaIds.length) await db.delete(schema.candidateAffidavits).where(inArray(schema.candidateAffidavits.mediaId, mediaIds));
    const candidateIds = this.wardIds.length ? (await db.select({ id: schema.candidates.id }).from(schema.candidates).where(inArray(schema.candidates.wardId, this.wardIds))).map((r) => r.id) : [];
    if (candidateIds.length) {
      await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
      await db.delete(schema.candidates).where(inArray(schema.candidates.id, candidateIds));
    }
    if (mediaIds.length) await db.delete(schema.media).where(inArray(schema.media.id, mediaIds));
    if (this.userIds.length) {
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, this.userIds));
      await db.delete(schema.users).where(inArray(schema.users.id, this.userIds));
    }
    if (this.wardIds.length) await db.delete(schema.wards).where(inArray(schema.wards.id, this.wardIds));
  }
}

export function tokenForm(auth: Auth, fields: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set(CSRF_FIELD_NAME, auth.token);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

export function extraction(wardId: number, name = `Harness Person ${randomUUID().slice(0, 8)} (FICTIONAL)`): AffidavitExtraction {
  return {
    age: { status: 'value', years: 52 },
    education: { status: 'value', level: 'Graduate', stated: 'B.Com' },
    assets: { status: 'value', movableInr: 10210000, immovableInr: 35000000, totalInr: 45210000, note: 'Self 2 crore; spouse 2.5 crore' },
    cases: { status: 'value', pending: 2, convictions: 0, note: 'IPC 420 and 468' },
    identity: {
      name: { status: 'value', text: name },
      ward: { status: 'value', number: wardId % 1000, name: 'As read', corporation: 'south' },
      party: { status: 'value', text: 'Demo Party A' },
      gender: { status: 'value', gender: 'female' },
    },
    confidence: 64,
  };
}

export async function fieldRow(candidateId: number, key: string) {
  const rows = await db.select().from(schema.candidateFields).where(eq(schema.candidateFields.candidateId, candidateId));
  return rows.find((r) => r.fieldKey === key);
}

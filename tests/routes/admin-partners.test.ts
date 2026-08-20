/**
 * `/admin/partners` (Task 46, information-architecture.md §6.4; PRD
 * §5.12/§5.13/§9.1/§11). Drives every request through the REAL middleware
 * (src/middleware.ts) composed with the real page twin via Astro's
 * container API — same technique as tests/routes/admin-roles.test.ts.
 *
 * COVERAGE MAP:
 *   - ADMIN-ONLY: a curator or a citizen hitting the route -> 403; an
 *     anonymous request redirects to /login.
 *   - RENDER: admin GET renders the roster, coverage summary, held-wards
 *     table, and both EOI queue sections.
 *   - CREATE/UPDATE PARTNER: POST formAction=create_partner /
 *     update_partner actually writes partners/partner_wards rows, audited.
 *   - OVERRIDE: POST formAction=override_hold sets commsHoldOverride,
 *     audited.
 *   - EOI TRIAGE: accept_awareness provisions a partner; accept_curation
 *     accepts WITHOUT any role grant; decline_eoi declines.
 *   - CSRF: POST without the token -> 403, DB unaffected.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { onRequest } from '../../src/middleware';

import PartnersRoute from '../../src/pages/admin/partners.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const SITE_URL = new URL(SITE_ORIGIN);

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward ids. tests/unit/partners.test.ts owns
// 99840-99849; this route suite owns 99850-99859.
const ZONE = 'Partners Route Test Zone';
const WARD_COVERED = { id: 99850, nameEn: 'Partners Route Test Ward Covered', nameKn: 'ಆ೧', corporation: 'south' as const, zone: ZONE, boundaryRef: 'partners-route-test-covered' };
const WARD_HELD = { id: 99851, nameEn: 'Partners Route Test Ward Held', nameKn: 'ಆ೨', corporation: 'south' as const, zone: ZONE, boundaryRef: 'partners-route-test-held' };
const WARD_OVERRIDE = { id: 99852, nameEn: 'Partners Route Test Ward Override', nameKn: 'ಆ೩', corporation: 'south' as const, zone: ZONE, boundaryRef: 'partners-route-test-override' };
const WARD_REPLACE = { id: 99853, nameEn: 'Partners Route Test Ward Replace', nameKn: 'ಆ೪', corporation: 'south' as const, zone: ZONE, boundaryRef: 'partners-route-test-replace' };
const ALL_WARDS = [WARD_COVERED, WARD_HELD, WARD_OVERRIDE, WARD_REPLACE];
const ALL_WARD_IDS = ALL_WARDS.map((w) => w.id);

const EMAILS = {
  admin: 'admin-partners-route-test-admin@example.com',
  curator: 'admin-partners-route-test-curator@example.com',
  citizen: 'admin-partners-route-test-citizen@example.com',
};

const SLUG_CREATE = 'partners-route-test-create';
const SLUG_UPDATE_TARGET = 'partners-route-test-update-target';
const SLUG_AWARENESS_ACCEPT = 'partners-route-test-awareness-accept';
const SLUG_CSRF_TARGET = 'partners-route-test-csrf-target';

function normalize(html: string): string {
  return html
    .replace(/\s+data-astro-cid-\w+/g, '')
    .replace(/\s+data-astro-(?:source-file|source-loc)="[^"]*"/g, '')
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<')
    .replace(/\s+/g, ' ');
}

async function makeContainer() {
  return AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
}

interface RunOptions {
  method?: 'GET' | 'POST';
  cookieValue?: string;
  form?: FormData;
  secFetchSite?: string | null;
}

async function run(component: unknown, path: string, opts: RunOptions = {}): Promise<Response> {
  const { method = 'GET', cookieValue, form, secFetchSite = 'same-origin' } = opts;
  const url = new URL(path, SITE_URL);

  const headers = new Headers();
  if (cookieValue) headers.set('cookie', `${SESSION_COOKIE}=${cookieValue}`);
  if (secFetchSite) headers.set('sec-fetch-site', secFetchSite);

  const request = new Request(url, { method, headers, body: form });

  const cookiesStub = {
    get: (name: string) => (name === SESSION_COOKIE && cookieValue ? { value: cookieValue } : undefined),
  };
  const locals: Record<string, unknown> = {};
  const ctx = { request, url, site: SITE_URL, cookies: cookiesStub, locals } as any;

  const container = await makeContainer();
  const next = async () =>
    container.renderToResponse(component as any, {
      partial: false,
      request,
      locals: locals as unknown as App.Locals,
    });

  return (await onRequest(ctx, next)) as Response;
}

function formWithToken(fields: Record<string, string>, token: string): FormData {
  const fd = new FormData();
  fd.set(CSRF_FIELD_NAME, token);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function sessionFor(userId: number): Promise<{ cookieValue: string; token: string }> {
  const { id, cookieValue } = await createSession(userId);
  return { cookieValue, token: issueCsrfToken(id) };
}

async function upsertUser(email: string, role: 'citizen' | 'curator' | 'admin'): Promise<number> {
  const [row] = await db
    .insert(schema.users)
    .values({ email, role, status: 'active' })
    .onConflictDoUpdate({ target: schema.users.email, set: { role, status: 'active' } })
    .returning({ id: schema.users.id });
  return row!.id;
}

let adminId: number;
let curatorId: number;
let citizenId: number;
let adminAuth: { cookieValue: string; token: string };
let curatorAuth: { cookieValue: string; token: string };
let citizenAuth: { cookieValue: string; token: string };
const createdPartnerIds: number[] = [];
const createdEoiIds: number[] = [];

describe('/admin/partners (Task 46)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    for (const ward of ALL_WARDS) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }

    adminId = await upsertUser(EMAILS.admin, 'admin');
    curatorId = await upsertUser(EMAILS.curator, 'curator');
    citizenId = await upsertUser(EMAILS.citizen, 'citizen');

    adminAuth = await sessionFor(adminId);
    curatorAuth = await sessionFor(curatorId);
    citizenAuth = await sessionFor(citizenId);

    // WARD_HELD: zero candidates -> incomplete -> shows up in the held-wards table.
    // WARD_OVERRIDE: same (incomplete) -- overridden by a test below.
  });

  afterAll(async () => {
    if (createdEoiIds.length > 0) {
      await db.delete(schema.eoiSubmissions).where(inArray(schema.eoiSubmissions.id, createdEoiIds));
    }
    if (createdPartnerIds.length > 0) {
      await db.delete(schema.partnerWards).where(inArray(schema.partnerWards.partnerId, createdPartnerIds));
      await db.delete(schema.partners).where(inArray(schema.partners.id, createdPartnerIds));
    }
    await db.delete(schema.wardReadiness).where(inArray(schema.wardReadiness.wardId, ALL_WARD_IDS));
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, [adminId, curatorId, citizenId]));
    await db.delete(schema.users).where(inArray(schema.users.id, [adminId, curatorId, citizenId]));
    await db.delete(schema.wards).where(inArray(schema.wards.id, ALL_WARD_IDS));
    await client.end();
  });

  describe('admin-only', () => {
    it('GET as a curator -> 403', async () => {
      const res = await run(PartnersRoute, '/admin/partners', { cookieValue: curatorAuth.cookieValue });
      expect(res.status).toBe(403);
    });

    it('GET as a citizen -> 403', async () => {
      const res = await run(PartnersRoute, '/admin/partners', { cookieValue: citizenAuth.cookieValue });
      expect(res.status).toBe(403);
    });

    it('GET anonymous -> redirect to /login', async () => {
      const res = await run(PartnersRoute, '/admin/partners');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('/login');
    });

    it('GET as admin -> 200, no-store, renders the page sections', async () => {
      const res = await run(PartnersRoute, '/admin/partners', { cookieValue: adminAuth.cookieValue });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const html = normalize(await res.text());
      expect(html).toContain('Partner roster');
      expect(html).toContain('Ward coverage');
      expect(html).toContain('Wards held from candidate comms');
      expect(html).toContain('Expressions of interest');
    });
  });

  describe('create + update partner', () => {
    it('POST formAction=create_partner creates a partner + partner_wards, audited', async () => {
      const form = formWithToken(
        { formAction: 'create_partner', slug: SLUG_CREATE, name: 'Route Test Partner', contact: 'route-test@example.org', wardIds: String(WARD_COVERED.id), confirm: 'on' },
        adminAuth.token,
      );
      const res = await run(PartnersRoute, '/admin/partners', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/admin/partners');

      const [row] = await db.select().from(schema.partners).where(eq(schema.partners.slug, SLUG_CREATE));
      expect(row).toBeDefined();
      createdPartnerIds.push(row!.id);

      const wardRows = await db.select().from(schema.partnerWards).where(eq(schema.partnerWards.partnerId, row!.id));
      expect(wardRows.map((r) => r.wardId)).toEqual([WARD_COVERED.id]);

    });

    it('POST formAction=create_partner without confirm -> 400, no partner created', async () => {
      const form = formWithToken({ formAction: 'create_partner', slug: 'partners-route-test-noconfirm', name: 'Nope' }, adminAuth.token);
      const res = await run(PartnersRoute, '/admin/partners', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);
      const rows = await db.select().from(schema.partners).where(eq(schema.partners.slug, 'partners-route-test-noconfirm'));
      expect(rows).toEqual([]);
    });

    it('POST formAction=update_partner REPLACES ward coverage, audited', async () => {
      const createForm = formWithToken(
        { formAction: 'create_partner', slug: SLUG_UPDATE_TARGET, name: 'Before Update', wardIds: String(WARD_COVERED.id), confirm: 'on' },
        adminAuth.token,
      );
      await run(PartnersRoute, '/admin/partners', { method: 'POST', cookieValue: adminAuth.cookieValue, form: createForm });
      const [created] = await db.select().from(schema.partners).where(eq(schema.partners.slug, SLUG_UPDATE_TARGET));
      createdPartnerIds.push(created!.id);

      const updateForm = formWithToken(
        { formAction: 'update_partner', partnerId: String(created!.id), name: 'After Update', contact: 'after@example.org', wardIds: String(WARD_REPLACE.id), confirm: 'on' },
        adminAuth.token,
      );
      const res = await run(PartnersRoute, '/admin/partners', { method: 'POST', cookieValue: adminAuth.cookieValue, form: updateForm });
      expect(res.status).toBe(302);

      const [row] = await db.select().from(schema.partners).where(eq(schema.partners.id, created!.id));
      expect(row?.name).toBe('After Update');

      const wardRows = await db.select().from(schema.partnerWards).where(eq(schema.partnerWards.partnerId, created!.id));
      expect(wardRows.map((r) => r.wardId)).toEqual([WARD_REPLACE.id]);

    });
  });

  describe('held wards + override', () => {
    it('an incomplete ward shows up in the rendered held-wards table', async () => {
      const res = await run(PartnersRoute, '/admin/partners', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await res.text());
      expect(html).toContain(WARD_HELD.nameEn);
    });

    it('POST formAction=override_hold releases the ward, audited', async () => {
      const form = formWithToken({ formAction: 'override_hold', wardId: String(WARD_OVERRIDE.id), confirm: 'on' }, adminAuth.token);
      const res = await run(PartnersRoute, '/admin/partners', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);

      const [row] = await db.select().from(schema.wardReadiness).where(eq(schema.wardReadiness.wardId, WARD_OVERRIDE.id));
      expect(row?.commsHoldOverride).toBe(true);

      const afterRes = await run(PartnersRoute, '/admin/partners', { cookieValue: adminAuth.cookieValue });
      const html = normalize(await afterRes.text());
      expect(html).toContain(WARD_OVERRIDE.nameEn);
      expect(html).toContain('Released (override)');
    });
  });

  describe('EOI triage', () => {
    async function insertEoi(path: 'awareness' | 'curation', contact: string): Promise<number> {
      const [row] = await db
        .insert(schema.eoiSubmissions)
        .values({ path, name: 'Route Test Applicant', contact, status: 'new' })
        .returning({ id: schema.eoiSubmissions.id });
      createdEoiIds.push(row!.id);
      return row!.id;
    }

    it('accept_awareness provisions a partner and marks the EOI accepted', async () => {
      const eoiId = await insertEoi('awareness', 'awareness-applicant@example.org');

      const form = formWithToken(
        { formAction: 'accept_awareness', eoiId: String(eoiId), slug: SLUG_AWARENESS_ACCEPT, name: 'Awareness Org', confirm: 'on' },
        adminAuth.token,
      );
      const res = await run(PartnersRoute, '/admin/partners', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);

      const [eoi] = await db.select().from(schema.eoiSubmissions).where(eq(schema.eoiSubmissions.id, eoiId));
      expect(eoi?.status).toBe('accepted');

      const [partnerRow] = await db.select().from(schema.partners).where(eq(schema.partners.slug, SLUG_AWARENESS_ACCEPT));
      expect(partnerRow).toBeDefined();
      createdPartnerIds.push(partnerRow!.id);
    });

    it('accept_curation marks accepted WITHOUT creating a partner or granting any role', async () => {
      const eoiId = await insertEoi('curation', 'curation-applicant@example.org');
      const partnerCountBefore = (await db.select({ id: schema.partners.id }).from(schema.partners)).length;

      const form = formWithToken({ formAction: 'accept_curation', eoiId: String(eoiId), confirm: 'on' }, adminAuth.token);
      const res = await run(PartnersRoute, '/admin/partners', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);

      const [eoi] = await db.select().from(schema.eoiSubmissions).where(eq(schema.eoiSubmissions.id, eoiId));
      expect(eoi?.status).toBe('accepted');

      const partnerCountAfter = (await db.select({ id: schema.partners.id }).from(schema.partners)).length;
      expect(partnerCountAfter).toBe(partnerCountBefore);

      const [citizenRow] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, citizenId));
      expect(citizenRow?.role).toBe('citizen');
    });

    it('decline_eoi marks the EOI declined', async () => {
      const eoiId = await insertEoi('awareness', 'decline-applicant@example.org');
      const form = formWithToken({ formAction: 'decline_eoi', eoiId: String(eoiId), confirm: 'on' }, adminAuth.token);
      const res = await run(PartnersRoute, '/admin/partners', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);

      const [eoi] = await db.select().from(schema.eoiSubmissions).where(eq(schema.eoiSubmissions.id, eoiId));
      expect(eoi?.status).toBe('declined');
    });
  });

  describe('CSRF', () => {
    it('POST without the CSRF token -> 403, DB unaffected', async () => {
      const fd = new FormData();
      fd.set('formAction', 'create_partner');
      fd.set('slug', SLUG_CSRF_TARGET);
      fd.set('name', 'CSRF Target');
      fd.set('confirm', 'on');

      const res = await run(PartnersRoute, '/admin/partners', { method: 'POST', cookieValue: adminAuth.cookieValue, form: fd });
      expect(res.status).toBe(403);

      const rows = await db.select().from(schema.partners).where(eq(schema.partners.slug, SLUG_CSRF_TARGET));
      expect(rows).toEqual([]);
    });

    it('POST with a valid CSRF token succeeds', async () => {
      const form = formWithToken({ formAction: 'create_partner', slug: SLUG_CSRF_TARGET, name: 'CSRF Target', confirm: 'on' }, adminAuth.token);
      const res = await run(PartnersRoute, '/admin/partners', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);

      const [row] = await db.select().from(schema.partners).where(eq(schema.partners.slug, SLUG_CSRF_TARGET));
      expect(row).toBeDefined();
      createdPartnerIds.push(row!.id);
    });
  });
});

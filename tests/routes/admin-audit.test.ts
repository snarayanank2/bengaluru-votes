/**
 * `/admin/audit` (Task 47, information-architecture.md §6.5; architecture.md
 * §7 "Audit ROLLBACK"; PRD §11). Drives every request through the REAL
 * middleware (src/middleware.ts) composed with the real page twin via
 * Astro's container API — same technique as tests/routes/admin-roles.test.ts.
 *
 * COVERAGE MAP:
 *   - ADMIN-ONLY: a curator or a citizen hitting the route -> 403; an
 *     anonymous request redirects to /login.
 *   - VIEWER: GET renders the entries table; entityType/wardId/actorUserId
 *     filters narrow results; limit/offset paginate.
 *   - RESTORE: POST formAction=restore on a restorable (candidate_field)
 *     entry republishes the old value and redirects with a "restored"
 *     notice; missing confirm -> 400; a non-restorable entry -> 400
 *     friendly 'not_restorable' message.
 *   - CSRF: POST without the token -> 403, nothing published.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';
import { SESSION_COOKIE, createSession } from '../../src/lib/session';
import { issueCsrfToken, CSRF_FIELD_NAME } from '../../src/lib/csrf';
import { onRequest } from '../../src/middleware';
import { publishCandidateField } from '../../src/lib/publish';
import { writeAudit } from '../../src/lib/audit';

import AuditRoute from '../../src/pages/admin/audit.astro';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. CI always sets this; for local runs export ' +
      'DATABASE_URL=postgres://postgres@localhost:54329/bv_test (see task brief).',
  );
}

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';
const SITE_URL = new URL(SITE_ORIGIN);

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward id (Task 47 brief: "use high dedicated ids") —
// tests/unit/audit-restore.test.ts owns 99900-99901; this route suite owns
// 99920.
const WARD_ID = 99920;

const EMAILS = {
  admin: 'admin-audit-route-test-admin@example.com',
  curator: 'admin-audit-route-test-curator@example.com',
  citizen: 'admin-audit-route-test-citizen@example.com',
};

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

async function makeCandidate(slugPrefix: string): Promise<number> {
  const [candidate] = await db
    .insert(schema.candidates)
    .values({
      slug: `${slugPrefix}-${randomUUID()}`,
      wardId: WARD_ID,
      nameEn: 'Route Test Candidate',
      partyEn: 'Independent',
    })
    .returning();
  return candidate!.id;
}

let adminId: number;
let curatorId: number;
let citizenId: number;
let adminAuth: { cookieValue: string; token: string };
let curatorAuth: { cookieValue: string; token: string };
let citizenAuth: { cookieValue: string; token: string };

describe('/admin/audit (Task 47)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    await db
      .insert(schema.wards)
      .values({
        id: WARD_ID,
        nameEn: 'Admin Audit Route Test Ward',
        nameKn: 'ಆ.ಆ.ಪ ವಾರ್ಡ್',
        corporation: 'south',
        zone: 'Admin Audit Route Test Zone',
        boundaryRef: 'admin-audit-route-test',
      })
      .onConflictDoNothing();

    adminId = await upsertUser(EMAILS.admin, 'admin');
    curatorId = await upsertUser(EMAILS.curator, 'curator');
    citizenId = await upsertUser(EMAILS.citizen, 'citizen');

    adminAuth = await sessionFor(adminId);
    curatorAuth = await sessionFor(curatorId);
    citizenAuth = await sessionFor(citizenId);
  });

  afterAll(async () => {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, adminId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, curatorId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, citizenId));
    await db.delete(schema.users).where(eq(schema.users.id, curatorId));
    await db.delete(schema.users).where(eq(schema.users.id, citizenId));
    await db.delete(schema.users).where(eq(schema.users.id, adminId));
    await client.end();
  });

  describe('admin-only', () => {
    it('GET /admin/audit as a curator -> 403', async () => {
      const res = await run(AuditRoute, '/admin/audit', { cookieValue: curatorAuth.cookieValue });
      expect(res.status).toBe(403);
    });

    it('GET /admin/audit as a citizen -> 403', async () => {
      const res = await run(AuditRoute, '/admin/audit', { cookieValue: citizenAuth.cookieValue });
      expect(res.status).toBe(403);
    });

    it('GET /admin/audit anonymous -> redirect to /login', async () => {
      const res = await run(AuditRoute, '/admin/audit');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('/login');
    });

    it('GET /admin/audit as admin -> 200, no-store', async () => {
      const res = await run(AuditRoute, '/admin/audit', { cookieValue: adminAuth.cookieValue });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });
  });

  describe('viewer', () => {
    it('renders published entries and narrows them by entityType/wardId/actorUserId filters', async () => {
      const candidateId = await makeCandidate('admin-audit-route-viewer');
      const fieldKey = 'track_record';
      const entityId = `${candidateId}:${fieldKey}`;

      await publishCandidateField(
        { userId: adminId, role: 'admin' },
        { candidateId, fieldKey, valueEn: 'Viewer Value', sourceUrl: 'https://example.org/viewer', sourceType: 'curator', authoredLang: 'en' },
      );

      const res = await run(
        AuditRoute,
        `/admin/audit?entityType=candidate_field&wardId=${WARD_ID}&actorUserId=${adminId}`,
        { cookieValue: adminAuth.cookieValue },
      );
      expect(res.status).toBe(200);
      const html = normalize(await res.text());
      expect(html).toContain(entityId);
      expect(html).toContain('Viewer Value');
      expect(html).toContain('https://example.org/viewer');
    });

    it('paginates with limit/offset', async () => {
      const candidateId = await makeCandidate('admin-audit-route-pagination');
      const fieldKey = 'track_record';
      const entityId = `${candidateId}:${fieldKey}`;

      await publishCandidateField(
        { userId: adminId, role: 'admin' },
        { candidateId, fieldKey, valueEn: 'Page V1', sourceUrl: null, sourceType: 'curator', authoredLang: 'en' },
      );
      await publishCandidateField(
        { userId: adminId, role: 'admin' },
        { candidateId, fieldKey, valueEn: 'Page V2', sourceUrl: null, sourceType: 'curator', authoredLang: 'en' },
      );

      // Row 1 (newest, offset=0) is the "Page V1 -> Page V2" publish — its
      // "old -> new" cell legitimately shows BOTH values (that's the whole
      // point of the column), so assert on the pagination summary and the
      // NEW-value side rather than "doesn't contain the old text anywhere".
      const page1 = await run(AuditRoute, `/admin/audit?entityType=candidate_field&wardId=${WARD_ID}&actorUserId=${adminId}&limit=1&offset=0`, {
        cookieValue: adminAuth.cookieValue,
      });
      const html1 = normalize(await page1.text());
      expect(html1).toContain(entityId);
      expect(html1).toContain('Showing 1–1 of 3');
      expect(html1).toContain('Page V1 → Page V2');

      // Row 2 (offset=1) is the FIRST-EVER publish of this field — "null ->
      // Page V1" — which never mentions "Page V2" at all, so THIS page can
      // assert its absence.
      const page2 = await run(AuditRoute, `/admin/audit?entityType=candidate_field&wardId=${WARD_ID}&actorUserId=${adminId}&limit=1&offset=1`, {
        cookieValue: adminAuth.cookieValue,
      });
      const html2 = normalize(await page2.text());
      expect(html2).toContain('Showing 2–2 of 3');
      expect(html2).toContain('Page V1');
      expect(html2).not.toContain('Page V2');
    });
  });

  describe('restore', () => {
    it('POST formAction=restore on a restorable entry republishes the old value and redirects with a restored notice', async () => {
      const candidateId = await makeCandidate('admin-audit-route-restore');
      const fieldKey = 'track_record';
      const entityId = `${candidateId}:${fieldKey}`;

      await publishCandidateField(
        { userId: adminId, role: 'admin' },
        { candidateId, fieldKey, valueEn: 'Restore A', sourceUrl: 'https://example.org/a', sourceType: 'curator', authoredLang: 'en' },
      );
      await publishCandidateField(
        { userId: adminId, role: 'admin' },
        { candidateId, fieldKey, valueEn: 'Restore B', sourceUrl: 'https://example.org/b', sourceType: 'curator', authoredLang: 'en' },
      );

      const [entryB] = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.entityId, entityId), eq(schema.auditLog.action, 'publish')))
        .orderBy(schema.auditLog.id)
        .limit(1)
        .offset(1);

      const form = formWithToken({ formAction: 'restore', auditId: String(entryB!.id), confirm: 'on' }, adminAuth.token);
      const res = await run(AuditRoute, '/admin/audit', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('restored=1');

      const [field] = await db
        .select()
        .from(schema.candidateFields)
        .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, fieldKey)));
      expect(field!.valueEn).toBe('Restore A');

      const [restoreEntry] = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.entityId, entityId), eq(schema.auditLog.action, 'restore')));
      expect(restoreEntry).toBeDefined();
      expect((restoreEntry!.newValue as { restoredFromAuditId: number }).restoredFromAuditId).toBe(entryB!.id);

      // Following the redirect renders the restored notice.
      const redirectLocation = res.headers.get('location')!;
      const noticeRes = await run(AuditRoute, redirectLocation, { cookieValue: adminAuth.cookieValue });
      expect(noticeRes.status).toBe(200);
      const noticeHtml = normalize(await noticeRes.text());
      expect(noticeHtml).toContain('restored');
    });

    it('POST formAction=restore without confirm -> 400, nothing published', async () => {
      const candidateId = await makeCandidate('admin-audit-route-noconfirm');
      const fieldKey = 'track_record';
      const entityId = `${candidateId}:${fieldKey}`;

      await publishCandidateField(
        { userId: adminId, role: 'admin' },
        { candidateId, fieldKey, valueEn: 'No Confirm A', sourceUrl: null, sourceType: 'curator', authoredLang: 'en' },
      );
      await publishCandidateField(
        { userId: adminId, role: 'admin' },
        { candidateId, fieldKey, valueEn: 'No Confirm B', sourceUrl: null, sourceType: 'curator', authoredLang: 'en' },
      );

      const [entryB] = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.entityId, entityId), eq(schema.auditLog.action, 'publish')))
        .orderBy(schema.auditLog.id)
        .limit(1)
        .offset(1);

      const form = formWithToken({ formAction: 'restore', auditId: String(entryB!.id) }, adminAuth.token);
      const res = await run(AuditRoute, '/admin/audit', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);

      const [field] = await db
        .select()
        .from(schema.candidateFields)
        .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, fieldKey)));
      expect(field!.valueEn).toBe('No Confirm B');
    });

    it('POST formAction=restore on a non-restorable entry -> 400 friendly message', async () => {
      const targetEntityId = `admin-audit-route-user-${randomUUID()}`;
      const banEntryId = await db.transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { userId: adminId, role: 'admin' },
          action: 'ban',
          entityType: 'user',
          entityId: targetEntityId,
          oldValue: { status: 'active' },
          newValue: { status: 'banned' },
        });
        const [row] = await tx.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, targetEntityId));
        return row!.id;
      });

      const form = formWithToken({ formAction: 'restore', auditId: String(banEntryId), confirm: 'on' }, adminAuth.token);
      const res = await run(AuditRoute, '/admin/audit', { method: 'POST', cookieValue: adminAuth.cookieValue, form });
      expect(res.status).toBe(400);

      const after = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, targetEntityId));
      expect(after.length).toBe(1); // no new row appended
    });
  });

  describe('CSRF', () => {
    it('POST without the CSRF token -> 403, nothing published', async () => {
      const candidateId = await makeCandidate('admin-audit-route-csrf');
      const fieldKey = 'track_record';
      const entityId = `${candidateId}:${fieldKey}`;

      await publishCandidateField(
        { userId: adminId, role: 'admin' },
        { candidateId, fieldKey, valueEn: 'CSRF A', sourceUrl: null, sourceType: 'curator', authoredLang: 'en' },
      );
      await publishCandidateField(
        { userId: adminId, role: 'admin' },
        { candidateId, fieldKey, valueEn: 'CSRF B', sourceUrl: null, sourceType: 'curator', authoredLang: 'en' },
      );

      const [entryB] = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.entityId, entityId), eq(schema.auditLog.action, 'publish')))
        .orderBy(schema.auditLog.id)
        .limit(1)
        .offset(1);

      const fd = new FormData();
      fd.set('formAction', 'restore');
      fd.set('auditId', String(entryB!.id));
      fd.set('confirm', 'on');

      const res = await run(AuditRoute, '/admin/audit', { method: 'POST', cookieValue: adminAuth.cookieValue, form: fd });
      expect(res.status).toBe(403);

      const [field] = await db
        .select()
        .from(schema.candidateFields)
        .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, fieldKey)));
      expect(field!.valueEn).toBe('CSRF B');
    });
  });
});

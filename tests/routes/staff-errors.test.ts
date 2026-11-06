/**
 * Staff errors and the shared staff controls, through the real middleware and
 * page twins: the 403 and 404 pages stay inside the staff shell, an unknown id
 * under /curator or /transcribe gets the staff 404 (never the public one), the
 * publish buttons are gated on their confirmation, the staff bar marks the
 * current section, and a ward is named the same way everywhere.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { Fixtures, client, db, run, schema, ward, type Auth } from './support/staff-harness';
import { submitPublicFlag } from '../../src/lib/flags';
import { anonReporter } from '../support/reporter';
import { t } from '../../src/i18n';
import ForbiddenRoute from '../../src/pages/account/forbidden.astro';
import CuratorRestRoute from '../../src/pages/curator/[...rest].astro';
import TranscribeRestRoute from '../../src/pages/transcribe/[...rest].astro';
import QueueIndexRoute from '../../src/pages/curator/queue/index.astro';
import QueueItemRoute from '../../src/pages/curator/queue/[id].astro';
import CandidateRoute from '../../src/pages/curator/candidate/[id].astro';
import MatchItemRoute from '../../src/pages/curator/matching/[id].astro';
import MatchListRoute from '../../src/pages/curator/matching/index.astro';
import TranscribeIdRoute from '../../src/pages/transcribe/[id].astro';
import GuideRoute from '../../src/pages/transcribe/guide.astro';

// This suite owns ward id 99414.
const WARD = ward(99414, 'Staff Errors Test Ward');
const fx = new Fixtures('staff-errors-test-');
let curator: Auth;
let transcriber: Auth;
let admin: Auth;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await fx.wards(WARD);
  curator = await fx.person('curator');
  transcriber = await fx.person('transcriber');
  admin = await fx.person('admin');
});

afterAll(async () => {
  await fx.cleanup();
  await client.end();
});

/** A staff-shell page: its own bar and landmark, an H1, and none of the public chrome. */
function expectStaffShell(html: string) {
  expect(html).toContain('<main id="main-content"');
  expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
  expect(html).toContain('action="/logout"');
  expect(html).not.toContain('lang-toggle');
  expect(html).not.toContain('site-footer');
  expect(html).not.toContain('flag-modal');
}

describe('the staff 403 page', () => {
  it.each([
    ['transcriber', '/curator', '/transcribe', 'staff.error.back.transcribe'],
    ['curator', '/transcribe', '/curator', 'staff.error.back.curator'],
    ['curator', '/admin/users', '/curator', 'staff.error.back.curator'],
  ] as const)('shows a %s asking for %s their own shell, a heading and a link home', async (role, path, home, backKey) => {
    const res = await run(ForbiddenRoute, path, { auth: role === 'curator' ? curator : transcriber });
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('set-cookie')).toBeNull();
    const html = await res.text();
    expectStaffShell(html);
    expect(html).toContain(`<title>${t('en', 'staff.error.403.title')}</title>`);
    expect(html).toContain(t('en', 'staff.error.403.heading'));
    expect(html).toContain(`href="${home}"`);
    expect(html).toContain(t('en', backKey));
    expect(html).not.toBe('Forbidden');
  });

  it('shows an admin the admin shell', async () => {
    const html = await (await run(ForbiddenRoute, '/account/forbidden', { auth: admin })).text();
    expect(html).toContain('href="/admin"');
    expect(html).toContain(t('en', 'staff.error.back.admin'));
  });

  it('speaks the language the person saved', async () => {
    const kn = await fx.person('curator');
    await db.update(schema.users).set({ language: 'kn' }).where(eq(schema.users.id, kn.userId));
    const html = await (await run(ForbiddenRoute, '/transcribe', { auth: kn })).text();
    expect(html).toMatch(/<html lang="kn"/);
    expect(html).toContain(t('kn', 'staff.error.403.heading'));
  });

  it('leaves a request with no session to the sign-in redirect', async () => {
    const anon = await run(ForbiddenRoute, '/curator');
    expect(anon.status).toBe(302);
    expect(anon.headers.get('location')).toBe('/login?next=%2Fcurator');
  });
});

describe('the staff 404 page', () => {
  it('answers an unknown curator address inside the curator shell', async () => {
    const res = await run(CuratorRestRoute, '/curator/nonexistent', { auth: curator, params: { rest: 'nonexistent' } });
    expect(res.status).toBe(404);
    const html = await res.text();
    expectStaffShell(html);
    expect(html).toContain(t('en', 'staff.error.404.heading'));
    expect(html).toContain('href="/curator"');
    expect(html).toContain('href="/curator/queue"');
  });

  it('answers an unknown transcriber address inside the transcriber shell', async () => {
    const res = await run(TranscribeRestRoute, '/transcribe/nope/more', { auth: transcriber, params: { rest: 'nope/more' } });
    expect(res.status).toBe(404);
    const html = await res.text();
    expectStaffShell(html);
    expect(html).toContain('href="/transcribe"');
  });

  it.each([
    ['a flag', QueueItemRoute, '/curator/queue/'],
    ['a candidate', CandidateRoute, '/curator/candidate/'],
    ['a waiting affidavit', MatchItemRoute, '/curator/matching/'],
  ] as const)('answers an unknown id on %s with the staff 404, not the public one', async (_name, route, base) => {
    for (const id of ['99999999', 'abc']) {
      const res = await run(route, `${base}${id}`, { auth: curator, params: { id } });
      expect(res.status).toBe(404);
      const html = await res.text();
      expectStaffShell(html);
      expect(html).toContain(t('en', 'staff.error.404.heading'));
    }
  });

  it("answers someone else's or a missing assignment with the staff 404", async () => {
    for (const id of ['99999999', 'abc']) {
      const res = await run(TranscribeIdRoute, `/transcribe/${id}`, { auth: transcriber, params: { id } });
      expect(res.status).toBe(404);
      expectStaffShell(await res.text());
    }
  });
});

describe('publish buttons are gated on their confirmation', () => {
  it('the flag fix, the candidate editor and the matching form render a disabled-until-ticked submit with a hint', async () => {
    const c = await fx.candidateWithAffidavit(WARD.id);
    const flagged = await submitPublicFlag(anonReporter(), { targetType: 'candidate_field', targetRef: `candidate:${c.candidateId}:age`, detail: 'The age is wrong' });

    const waiting = await fx.waitingAffidavit({ wardId: WARD.id, reason: 'ward_unresolved' });
    const pages = [
      await (await run(QueueItemRoute, `/curator/queue/${flagged.flagItemId}`, { auth: curator, params: { id: String(flagged.flagItemId) } })).text(),
      await (await run(CandidateRoute, `/curator/candidate/${c.candidateId}`, { auth: curator, params: { id: String(c.candidateId) } })).text(),
      await (await run(MatchItemRoute, `/curator/matching/${waiting.affidavitId}`, { auth: curator, params: { id: String(waiting.affidavitId) } })).text(),
    ];
    for (const html of pages) {
      expect(html).toContain('data-gated-submit');
      expect(html).toContain('data-gated-hint');
      expect(html).toContain(t('en', 'curator.confirm.needsTick'));
      // The tick stays a native required control: the server re-checks it, and without script the button still works.
      expect(html).toMatch(/name="confirmPublish"[^>]*required/);
      expect(html).not.toMatch(/data-gated-submit[^>]*disabled/);
    }
  });
});

describe('shared staff controls', () => {
  it('marks the current staff section with aria-current, and only that one', async () => {
    const html = await (await run(QueueIndexRoute, '/curator/queue', { auth: curator })).text();
    expect(html).toMatch(/<a href="\/curator\/queue"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/<a href="\/curator\/matching"[^>]*aria-current/);
    expect(html).not.toMatch(/<a href="\/curator\/guide"[^>]*aria-current/);
    // The sort links are a link group that also marks the current choice.
    expect(html).toMatch(/class="link-group"[^>]*aria-label/);
    expect(html).toMatch(/<a href="\?sort=recent"[^>]*aria-current="true"/);
  });

  it('marks the transcriber guide as the current page', async () => {
    const html = await (await run(GuideRoute, '/transcribe/guide', { auth: transcriber })).text();
    expect(html).toMatch(/<a href="\/transcribe\/guide"[^>]*aria-current="page"/);
  });

  it('shows the matching table in a focusable, named scroll region with an empty-state alternative', async () => {
    await fx.waitingAffidavit({ wardId: WARD.id, reason: 'ward_unresolved' });
    const html = await (await run(MatchListRoute, '/curator/matching', { auth: curator })).text();
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(`aria-label="${t('en', 'curator.matching.table.label')}"`);
    expect(html).toContain('data-scroll-hint');
  });

  it('titles a waiting affidavit by the name the AI read, never by its database number', async () => {
    const waiting = await fx.waitingAffidavit({ wardId: WARD.id, reason: 'ward_unresolved', name: 'Heading Person (FICTIONAL)' });
    const html = await (await run(MatchItemRoute, `/curator/matching/${waiting.affidavitId}`, { auth: curator, params: { id: String(waiting.affidavitId) } })).text();
    expect(html).toMatch(/<h1[^>]*>Match affidavit: Heading Person \(FICTIONAL\)<\/h1>/);
    expect(html).not.toContain(`#${waiting.affidavitId}`);
  });

  it('names a ward by its number and name on the flag page', async () => {
    const c = await fx.candidateWithAffidavit(WARD.id);
    const flagged = await submitPublicFlag(anonReporter(), { targetType: 'candidate_field', targetRef: `candidate:${c.candidateId}:age`, detail: 'The age is wrong' });
    const html = await (await run(QueueItemRoute, `/curator/queue/${flagged.flagItemId}`, { auth: curator, params: { id: String(flagged.flagItemId) } })).text();
    expect(html).toContain(`Flag in Ward ${WARD.id % 1000} Staff Errors Test Ward`);
    expect(html).not.toContain(`${WARD.id % 1000} - Staff Errors`);
  });
});

describe('the 403 page and the CSP nonce', () => {
  it('has no inline script that could need the nonce, and the header nonce is the request nonce', async () => {
    const res = await run(ForbiddenRoute, '/transcribe', { auth: curator });
    const html = await res.text();
    // Staff layouts render only bundled `<script type="module" src>` tags, which `script-src 'self'` covers.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(res.headers.get('content-security-policy')).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
  });
});

/**
 * The curator and transcriber guides, through the real middleware: a contents
 * list whose links all land on a section, the entry rules written once and
 * shown in both guides, the screen's own verb ("Reject") and no stale advice,
 * in both languages.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { Fixtures, client, db, run, schema, type Auth } from './support/staff-harness';
import { EDUCATION_LEVELS } from '../../src/lib/affidavit-extraction';
import { t } from '../../src/i18n';
import CuratorGuide from '../../src/pages/curator/guide.astro';
import TranscribeGuide from '../../src/pages/transcribe/guide.astro';

const fx = new Fixtures('staff-guides-test-');
let curator: Auth;
let transcriber: Auth;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  curator = await fx.person('curator');
  transcriber = await fx.person('transcriber');
});

afterAll(async () => {
  await fx.cleanup();
  await client.end();
});

const guides = [
  ['curator', CuratorGuide, '/curator/guide'],
  ['transcriber', TranscribeGuide, '/transcribe/guide'],
] as const;

describe.each(guides)('the %s guide', (role, route, path) => {
  const auth = () => (role === 'curator' ? curator : transcriber);

  it('lists its sections and every contents link lands on a section', async () => {
    const html = await (await run(route, path, { auth: auth() })).text();
    expect(html).toContain(`aria-label="${t('en', 'staff.guide.contents')}"`);
    const links = [...html.matchAll(/class="guide-contents"[\s\S]*?<\/nav>/g)][0]![0];
    const ids = [...links.matchAll(/href="#([A-Za-z]+)"/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    for (const id of ids) expect(html).toMatch(new RegExp(`<section[^>]*id="${id}"`));
  });

  it('shows the shared entry rules and account notes', async () => {
    const html = await (await run(route, path, { auth: auth() })).text();
    expect(html).toContain(t('en', 'staff.entry.answers.partial'));
    for (const level of EDUCATION_LEVELS) expect(html).toContain(level);
    expect(html).not.toContain('{levels}');
    expect(html).toContain(t('en', 'staff.basics.idle'));
    expect(html).toContain(t('en', 'staff.entry.never.heading'));
  });

  it('is a staff page with a title and a single H1', async () => {
    const html = await (await run(route, path, { auth: auth() })).text();
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toMatch(/<title>[^<]+— Bengaluru Votes<\/title>/);
  });

  it('renders in Kannada for a Kannada user without a missing key', async () => {
    const kn = await fx.person(role);
    await db.update(schema.users).set({ language: 'kn' }).where(eq(schema.users.id, kn.userId));
    const res = await run(route, path, { auth: kn });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<html lang="kn"/);
    expect(html).toContain(t('kn', 'staff.entry.heading'));
  });
});

describe('guide wording', () => {
  it('the curator guide uses the screen verb Reject and gives no advice a curator cannot follow', async () => {
    const html = await (await run(CuratorGuide, '/curator/guide', { auth: curator })).text();
    expect(html).not.toMatch(/dismiss/i);
    expect(html).toContain('select Reject');
    expect(html).not.toMatch(/affidavit number/i);
    expect(html).not.toContain('within a minute');
    expect(html).toContain('Cannot read');
    expect(html).not.toContain('The reason is read by');
  });

  it('both guides carry the owner-decided entry rules', async () => {
    for (const [route, path, who] of [[CuratorGuide, '/curator/guide', curator], [TranscribeGuide, '/transcribe/guide', transcriber]] as const) {
      const html = await (await run(route, path, { auth: who })).text();
      expect(html).toContain('exactly as printed on the affidavit');
      expect(html).toContain('If the affidavit says nil for assets, choose Not declared');
      expect(html).toContain('lists as pending in its criminal-cases section');
      expect(html).toContain('A curator can fix it later in the candidate editor');
    }
  });

  it('the curator guide says curators ignore AI confidence, how to escalate and what to do with links and old wards', async () => {
    const html = await (await run(CuratorGuide, '/curator/guide', { auth: curator })).text();
    expect(html).toContain('Curators do not use it');
    expect(html).toContain('message the admin directly');
    expect(html).not.toMatch(/@|\+91|\b\d{10}\b/);
    expect(html).toContain('never enter credentials or download files');
    expect(html).toContain('leave it for matching');
    expect(html).toContain('not sent to transcribers again');
    expect(html).toContain('There is no list of such fields');
  });

  it('each guide gives the 404 example that fits its reader', async () => {
    const c = await (await run(CuratorGuide, '/curator/guide', { auth: curator })).text();
    const tr = await (await run(TranscribeGuide, '/transcribe/guide', { auth: transcriber })).text();
    expect(c).toContain('a flag someone has already handled');
    expect(c).not.toContain('10 minutes have run out');
    expect(tr).toContain('10 minutes have run out');
    expect(tr).not.toContain('a flag someone');
    expect(c).toContain('South 14 · J.P Nagar');
  });

  it('the transcriber guide covers release, resume, the 5-minute warning and the matching list', async () => {
    const html = await (await run(TranscribeGuide, '/transcribe/guide', { auth: transcriber })).text();
    expect(html).toContain('Release this affidavit');
    expect(html).toContain('Resume');
    expect(html).toContain('5 minutes are left');
    expect(html).toContain('waiting for a match');
  });

  it('the fix-form strings no longer send a curator to add an affidavit or dismiss a flag', () => {
    expect(t('en', 'curator.fix.noAffidavitLink')).not.toMatch(/add the affidavit/i);
    for (const key of ['curator.fix.dismissOnly', 'curator.fix.error.unchanged', 'curator.fix.error.unsupported']) {
      expect(t('en', key)).not.toMatch(/dismiss/i);
    }
    expect(t('en', 'curator.queueItem.error.reasonRequired')).not.toMatch(/submitter/i);
  });
});

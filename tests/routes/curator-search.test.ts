/** `/curator?q=`: finding a candidate or a ward by name or number. */
import { it, beforeAll, afterAll, expect } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { Fixtures, client, db, run, ward, type Auth } from './support/staff-harness';
import { SEARCH_CAP } from '../../src/lib/curator';
import { t } from '../../src/i18n';
import DashboardRoute from '../../src/pages/curator/index.astro';

// This suite owns ward id 99431.
const WARD = ward(99431, 'Zyxwv Search Test Ward');
const fx = new Fixtures('curator-search-test-');
let curator: Auth;
let alphaId: number;

const search = (q: string) => run(DashboardRoute, `/curator?q=${encodeURIComponent(q)}`, { auth: curator });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await fx.wards(WARD);
  curator = await fx.person('curator');
  alphaId = await fx.bareCandidate(WARD.id, 'Qqsearch Alpha (FICTIONAL)');
  await fx.bareCandidate(WARD.id, 'Qqsearch 100%_Sure (FICTIONAL)');
});

afterAll(async () => {
  await fx.cleanup();
  await client.end();
});

it('shows the search form and no results before a search', async () => {
  const html = await (await run(DashboardRoute, '/curator', { auth: curator })).text();
  expect(html).toContain('name="q"');
  expect(html).not.toContain(t('en', 'curator.dashboard.search.candidates'));
});

it('finds a candidate by part of the name, whatever the case, and links to the editor', async () => {
  const html = await (await search('qqSEARCH alp')).text();
  expect(html).toContain(`href="/curator/candidate/${alphaId}"`);
  expect(html).toContain('Qqsearch Alpha (FICTIONAL)');
  expect(html).not.toContain('100%_Sure');
});

it('finds a ward by name and by its id', async () => {
  expect(await (await search('Zyxwv Search')).text()).toContain(`href="/curator/ward/${WARD.id}"`);
  expect(await (await search(String(WARD.id))).text()).toContain(`href="/curator/ward/${WARD.id}"`);
});

it('treats % and _ as the characters they are', async () => {
  const hit = await (await search('100%_S')).text();
  expect(hit).toContain('100%_Sure');
  expect(hit).not.toContain('Qqsearch Alpha');
  const none = t('en', 'curator.dashboard.search.none', { q: 'Qqsearch A%a' }).replace(/"/g, '&quot;');
  expect(await (await search('Qqsearch A%a')).text()).toContain(none);
});

it('asks for more than one character', async () => {
  expect(await (await search('q')).text()).toContain(t('en', 'curator.dashboard.search.tooShort'));
});

it('says so when nothing matches', async () => {
  expect(await (await search('zzznomatchzzz')).text()).toContain('zzznomatchzzz');
});

it('drops a NUL byte from the query instead of failing', async () => {
  const res = await search('Qqsearch\0 Alp');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain(`href="/curator/candidate/${alphaId}"`);
});

it('limits the search box to 100 characters', async () => {
  expect(await (await run(DashboardRoute, '/curator', { auth: curator })).text()).toContain('maxlength="100"');
});

it('stops at the cap and says so', async () => {
  for (let i = 0; i < SEARCH_CAP + 1; i += 1) await fx.bareCandidate(WARD.id, `Capsearch Person ${String(i).padStart(2, '0')} (FICTIONAL)`);
  const html = await (await search('Capsearch')).text();
  expect(html.match(/Capsearch Person/g)).toHaveLength(SEARCH_CAP);
  expect(html).toContain(t('en', 'curator.dashboard.search.capped', { count: SEARCH_CAP }));
});

it('refuses a citizen', async () => {
  expect((await run(DashboardRoute, '/curator?q=alpha', { auth: await fx.person('citizen') })).status).toBe(403);
});

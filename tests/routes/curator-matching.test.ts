/** `/curator/matching` and `/curator/matching/{id}`: a curator matches a waiting affidavit to a candidate and ward. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { Fixtures, client, db, fieldRow, run, schema, tokenForm, ward, type Auth } from './support/staff-harness';
import { t } from '../../src/i18n';
import ListRoute from '../../src/pages/curator/matching/index.astro';
import ItemRoute from '../../src/pages/curator/matching/[id].astro';

// This suite owns ward ids 99441 and 99442.
const WARD_A = ward(99441, 'Matching Test Ward A');
const WARD_B = ward(99442, 'Matching Test Ward B');
const fx = new Fixtures('curator-matching-test-');
let curator: Auth;

const list = (auth: Auth = curator, query = '') => run(ListRoute, `/curator/matching${query}`, { auth });
const item = (id: number | string, form?: FormData, auth: Auth = curator) => run(ItemRoute, `/curator/matching/${id}`, { auth, form, params: { id: String(id) } });
const confirm = (fields: Record<string, string>) => tokenForm(curator, { formAction: 'match', confirmPublish: 'on', ...fields });
const affidavitRow = async (id: number) => (await db.select().from(schema.candidateAffidavits).where(eq(schema.candidateAffidavits.id, id)))[0];
/** Astro writes an apostrophe in text as `&#39;`. */
const rendered = (text: string) => text.replaceAll("'", '&#39;');

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await fx.wards(WARD_A, WARD_B);
  curator = await fx.person('curator');
});

afterAll(async () => {
  await fx.cleanup();
  await client.end();
});

describe('who may match', () => {
  it.each(['citizen', 'transcriber'] as const)('refuses a %s', async (role) => {
    expect((await list(await fx.person(role))).status).toBe(403);
  });

  it('admits an admin', async () => {
    expect((await list(await fx.person('admin'))).status).toBe(200);
  });
});

describe('the list', () => {
  it('shows every reason an affidavit waits, with what the AI read', async () => {
    const unresolved = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    const duplicate = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'possible_duplicate' });
    const published = await fx.candidateWithAffidavit(WARD_A.id);
    const sentBack = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'reported_by_transcriber', candidateId: published.candidateId, note: 'This is ward B' });
    const res = await list();
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    for (const a of [unresolved, duplicate, sentBack]) expect(html).toContain(`href="/curator/matching/${a.affidavitId}"`);
    for (const reason of ['ward_unresolved', 'possible_duplicate', 'reported_by_transcriber']) expect(html).toContain(t('en', `curator.matching.reason.${reason}`));
    expect(html).toContain(unresolved.extraction.identity.name.text!);
    expect(html).toContain('This is ward B');
  });

  it('shows a notice only from the fixed list', async () => {
    expect(await (await list(curator, '?notice=matched')).text()).toContain(t('en', 'curator.matching.notice.matched'));
    expect(await (await list(curator, '?notice=gone')).text()).toContain(t('en', 'curator.matching.notice.gone'));
    expect((await list(curator, '?notice=item.heading')).status).toBe(200);
  });
});

describe('one waiting affidavit', () => {
  it('shows the PDF beside the form, pre-filled with the name and party as read', async () => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    const res = await item(a.affidavitId);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain(`src="${a.pdfUrl}#navpanes=0&#38;view=FitH"`);
    expect(html).toContain(`value="${a.extraction.identity.name.text}"`);
    expect(html).toContain('name="wardId"');
  });

  it('creates the candidate in the chosen ward, with the curator as the checker of the name', async () => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    const res = await item(a.affidavitId, confirm({ name: 'Matched Person (FICTIONAL)', party: 'Demo Party A', wardId: String(WARD_B.id) }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/curator/matching?notice=matched');
    const row = await affidavitRow(a.affidavitId);
    expect(row.state).toBe('published');
    const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, row.candidateId!));
    expect(candidate.wardId).toBe(WARD_B.id);
    expect(candidate.nameEn).toBe('Matched Person (FICTIONAL)');
    expect((await fieldRow(candidate.id, 'full_name'))!.checkedBy).toBe(curator.userId);
    expect((await fieldRow(candidate.id, 'age'))!.aiExtracted).toBe(true);
  });

  it('attaches a possible duplicate to the candidate it duplicates', async () => {
    const existing = await fx.candidateWithAffidavit(WARD_A.id);
    const name = existing.extraction.identity.name.text!;
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'possible_duplicate', name });
    const html = await (await item(a.affidavitId)).text();
    expect(html).toContain(`<option value="${existing.candidateId}"`);
    const res = await item(a.affidavitId, confirm({ name, party: 'Demo Party A', wardId: String(WARD_A.id), attachToCandidateId: String(existing.candidateId) }));
    expect(res.status).toBe(302);
    expect((await affidavitRow(a.affidavitId)).candidateId).toBe(existing.candidateId);
  });

  it('moves and renames the candidate of a sent-back affidavit', async () => {
    const published = await fx.candidateWithAffidavit(WARD_A.id);
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'reported_by_transcriber', candidateId: published.candidateId, note: 'Wrong ward' });
    const html = await (await item(a.affidavitId)).text();
    expect(html).toContain('Wrong ward');
    expect(html).toContain(`<option value="${WARD_A.id}" selected`);
    expect(html).toContain(`href="/curator/candidate/${published.candidateId}"`);
    expect((await item(a.affidavitId, confirm({ name: 'Renamed Person (FICTIONAL)', party: 'Demo Party A', wardId: String(WARD_B.id) }))).status).toBe(302);
    const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, published.candidateId));
    expect(candidate.wardId).toBe(WARD_B.id);
    expect(candidate.nameEn).toBe('Renamed Person (FICTIONAL)');
  });

  it.each([
    ['no name', { name: ' ', party: 'P', wardId: '99441' }, 'admin.affidavits.error.nameRequired'],
    ['no party', { name: 'N', party: '', wardId: '99441' }, 'admin.affidavits.error.partyRequired'],
    ['no ward', { name: 'N', party: 'P', wardId: '' }, 'admin.affidavits.error.unknownWard'],
    ['a ward that does not exist', { name: 'N', party: 'P', wardId: '99999999' }, 'admin.affidavits.error.unknownWard'],
    ['a candidate that does not exist', { name: 'N', party: 'P', wardId: '99441', attachToCandidateId: '999999999' }, 'admin.affidavits.error.unknownCandidate'],
    ['a candidate id that is not a number', { name: 'N', party: 'P', wardId: '99441', attachToCandidateId: 'abc' }, 'admin.affidavits.error.unknownCandidate'],
    ['a candidate id too large to be one', { name: 'N', party: 'P', wardId: '99441', attachToCandidateId: '99999999999' }, 'admin.affidavits.error.unknownCandidate'],
    ['a ward id too large to be one', { name: 'N', party: 'P', wardId: '99999999999' }, 'admin.affidavits.error.unknownWard'],
  ] as const)('refuses %s and leaves it waiting', async (_label, fields, key) => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    const res = await item(a.affidavitId, confirm(fields));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(rendered(t('en', key)));
    expect((await affidavitRow(a.affidavitId)).state).toBe('needs_matching');
  });

  it('shows back what was typed after a refusal', async () => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    const html = await (await item(a.affidavitId, confirm({ name: 'Typed Name (FICTIONAL)', party: '', wardId: String(WARD_B.id) }))).text();
    expect(html).toContain('value="Typed Name (FICTIONAL)"');
    expect(html).toContain(`<option value="${WARD_B.id}" selected`);
  });

  it('refuses a confirm without the tick', async () => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    const res = await item(a.affidavitId, tokenForm(curator, { formAction: 'match', name: 'N', party: 'P', wardId: String(WARD_A.id) }));
    expect(res.status).toBe(400);
    expect((await affidavitRow(a.affidavitId)).state).toBe('needs_matching');
  });

  it.each(['retry', 'discard', 'upload'])('refuses the admin-only action %s', async (formAction) => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    expect((await item(a.affidavitId, tokenForm(curator, { formAction, affidavitId: String(a.affidavitId), confirm: 'on' }))).status).toBe(400);
    expect(await affidavitRow(a.affidavitId)).toBeDefined();
  });

  it('is not found once resolved, for an unknown id, and for a published affidavit', async () => {
    const a = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'ward_unresolved' });
    expect((await item(a.affidavitId, confirm({ name: 'Once (FICTIONAL)', party: 'P', wardId: String(WARD_A.id) }))).status).toBe(302);
    expect((await item(a.affidavitId)).status).toBe(404);
    expect((await item(999999999)).status).toBe(404);
    expect((await item('abc')).status).toBe(404);
    expect((await item((await fx.candidateWithAffidavit(WARD_A.id)).affidavitId)).status).toBe(404);
  });
});

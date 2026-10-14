/** `/curator/candidate/{id}`: the seven affidavit fields and the ward, each saved on its own against the affidavit. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { Fixtures, client, db, fieldRow, run, schema, tokenForm, ward, type Auth } from './support/staff-harness';
import { t } from '../../src/i18n';
import CandidateRoute from '../../src/pages/curator/candidate/[id].astro';

// This suite owns ward ids 99421 and 99422.
const WARD_A = ward(99421, 'Editor Fields Test Ward A');
const WARD_B = ward(99422, 'Editor Fields Test Ward B');
const fx = new Fixtures('curator-candidate-fields-test-');
let curator: Auth;

const page = (id: number, form?: FormData) => run(CandidateRoute, `/curator/candidate/${id}`, { auth: curator, form, params: { id: String(id) } });
const save = (formAction: string, fields: Record<string, string>) => tokenForm(curator, { formAction, confirmPublish: 'on', ...fields });
const candidateRow = async (id: number) => (await db.select().from(schema.candidates).where(eq(schema.candidates.id, id)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await fx.wards(WARD_A, WARD_B);
  curator = await fx.person('curator');
});

afterAll(async () => {
  await fx.cleanup();
  await client.end();
});

describe('the candidate editor on structured fields', () => {
  it('shows the affidavit beside all seven fields and the ward, pre-filled', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const html = await (await page(c.candidateId)).text();
    expect(html).toContain(`src="${c.pdfUrl}#navpanes=0&#38;view=FitH"`);
    for (const action of ['field:full_name', 'field:party', 'field:gender', 'field:age', 'field:education', 'field:assets', 'field:cases', 'ward']) {
      expect(html).toContain(`name="formAction" value="${action}"`);
    }
    expect(html).toContain('name="age" value="52"');
    expect(html).not.toContain('track_record');
    expect(html).not.toContain('name="nameEn"');
  });

  it('saves one field as a structured, person-checked value and leaves the others alone', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const res = await page(c.candidateId, save('field:age', { 'status.age': 'value', age: '47' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/curator/candidate/${c.candidateId}`);
    const age = (await fieldRow(c.candidateId, 'age'))!;
    expect(age.valueData).toEqual({ key: 'age', status: 'value', years: 47 });
    expect(age.checkedBy).toBe(curator.userId);
    expect(age.sourceUrl).toBe(c.pdfUrl);
    expect((await fieldRow(c.candidateId, 'cases'))!.checkedBy).toBeNull();
  });

  it('renames the candidate through the name field', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    expect((await page(c.candidateId, save('field:full_name', { 'status.full_name': 'value', name: 'Corrected Name (FICTIONAL)' }))).status).toBe(302);
    expect((await candidateRow(c.candidateId)).nameEn).toBe('Corrected Name (FICTIONAL)');
  });

  it('moves the candidate to another ward', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    expect((await page(c.candidateId, save('ward', { wardId: String(WARD_B.id) }))).status).toBe(302);
    expect((await candidateRow(c.candidateId)).wardId).toBe(WARD_B.id);
  });

  it.each([
    ['an unchanged value', 'field:age', { 'status.age': 'value', age: '52' }, 'curator.fix.error.unchanged'],
    ['an invalid value', 'field:age', { 'status.age': 'value', age: '121' }, 'transcribe.error.age_range'],
    ['the same ward', 'ward', { wardId: String(99421) }, 'curator.fix.error.unchanged'],
  ] as const)('refuses %s', async (_label, action, fields, key) => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const res = await page(c.candidateId, save(action, fields));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(t('en', key));
    expect((await fieldRow(c.candidateId, 'age'))!.checkedBy).toBeNull();
    expect((await candidateRow(c.candidateId)).wardId).toBe(WARD_A.id);
  });

  it('refuses a save without the confirmation tick', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const res = await page(c.candidateId, tokenForm(curator, { formAction: 'field:age', 'status.age': 'value', age: '47' }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(t('en', 'curator.fix.error.confirmRequired'));
  });

  it('refuses a field name that is not an affidavit field', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    expect((await page(c.candidateId, save('field:track_record', { valueEn: 'x' }))).status).toBe(400);
  });

  it('asks for the affidavit first when the candidate has none, and refuses a field save', async () => {
    const candidateId = await fx.bareCandidate(WARD_A.id);
    const html = await (await page(candidateId)).text();
    // Astro escapes the apostrophe in text.
    expect(html).toContain(t('en', 'curator.candidateEdit.fields.needAffidavit').replace("'", '&#39;'));
    expect(html).not.toContain('value="field:age"');
    expect(html).toContain('value="affidavit"');
    const res = await page(candidateId, save('field:age', { 'status.age': 'value', age: '47' }));
    expect(res.status).toBe(400);
    expect(await fieldRow(candidateId, 'age')).toBeUndefined();
  });

  it('points to Matching when the only affidavit was sent back by a transcriber', async () => {
    const candidateId = await fx.bareCandidate(WARD_A.id);
    const waiting = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'reported_by_transcriber', candidateId });
    const html = await (await page(candidateId)).text();
    // Astro escapes the apostrophe in text.
    expect(html).toContain(t('en', 'curator.fix.affidavitWaiting').replace("'", '&#39;'));
    expect(html).toContain(`href="/curator/matching/${waiting.affidavitId}"`);
    expect(html).not.toContain(t('en', 'curator.candidateEdit.fields.needAffidavit').replace("'", '&#39;'));
    expect(html).not.toContain('value="field:age"');
  });

  it('keeps the English name when the core card is saved', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const before = (await candidateRow(c.candidateId)).nameEn;
    const res = await page(c.candidateId, tokenForm(curator, { formAction: 'core', status: 'contesting', nameKn: 'ಹೆಸರು', partyKn: '', nameEn: 'Smuggled Name' }));
    expect(res.status).toBe(302);
    const row = await candidateRow(c.candidateId);
    expect(row.nameEn).toBe(before);
    expect(row.nameKn).toBe('ಹೆಸರು');
    expect(row.status).toBe('contesting');
  });
});

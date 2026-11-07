/** `/curator/candidate/{id}`: the seven affidavit fields and the ward, each saved on its own against the affidavit. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { Fixtures, client, db, fieldRow, run, schema, tokenForm, ward, type Auth } from './support/staff-harness';
import { loadFixCandidate, loadFixFields } from '../../src/lib/curator-fix';
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
    expect(html).toContain(`src="${c.pdfUrl}#navpanes=0&amp;view=FitH"`);
    expect(html).toContain('name="formAction" value="fields"');
    expect(html.match(/name="confirmPublish"/g)).toHaveLength(1);
    // One Save and publish for the editor; the other submit is the Sign out in the bar.
    expect(html.match(/type="submit"/g)).toHaveLength(2);
    expect(html.match(/<form[^>]*action="\/logout"/g)).toHaveLength(1);
    expect(html).toContain('name="age" value="52"');
    expect(html).not.toContain('track_record');
    expect(html).not.toContain('name="nameEn"');
    expect(html).not.toContain('name="nameKn"');
    expect(html).not.toContain('name="partyKn"');
    expect(html).not.toContain('name="photo"');
    expect(html).not.toContain('Election status');
  });

  it('saves one field as a structured, person-checked value and leaves the others alone', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const res = await page(c.candidateId, save('field:age', { 'status.age': 'value', age: '47' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/curator/candidate/${c.candidateId}?saved=1`);
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

  it('refuses an invalid value with an error banner and a 400', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const res = await page(c.candidateId, save('field:age', { 'status.age': 'value', age: '121' }));
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain(t('en', 'transcribe.error.age_range'));
    expect(html).toContain('role="alert"');
    expect((await fieldRow(c.candidateId, 'age'))!.checkedBy).toBeNull();
    expect((await candidateRow(c.candidateId)).wardId).toBe(WARD_A.id);
  });

  // Nothing failed and there is nothing to recover from: a notice (role=status)
  // with a 200, not an error banner with a 400 (design-system §7.6).
  it.each([
    ['an unchanged value', 'field:age', { 'status.age': 'value', age: '52' }],
    ['the same ward', 'ward', { wardId: String(99421) }],
  ] as const)('answers %s with a notice and a 200, and writes nothing', async (_label, action, fields) => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const res = await page(c.candidateId, save(action, fields));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(t('en', 'curator.fix.error.unchanged'));
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
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
    expect(html).not.toContain('value="affidavit"');
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

  it('status saves are forbidden', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const before = (await candidateRow(c.candidateId)).nameEn;
    const res = await page(c.candidateId, tokenForm(curator, { formAction: 'core', status: 'contesting', nameKn: 'ಹೆಸರು', partyKn: '', nameEn: 'Smuggled Name' }));
    expect(res.status).toBe(403);
    const row = await candidateRow(c.candidateId);
    expect(row.nameEn).toBe(before);
    expect(row.status).toBe('filed');
  });
});

async function batch(id: number, overrides: Record<string, string> = {}) {
  const candidate = (await loadFixCandidate(id))!;
  const fields = await loadFixFields(candidate);
  const values: Record<string, string> = { wardId: String(candidate.wardId) };
  for (const field of fields) {
    values[`status.${field.key}`] = field.status;
    Object.assign(values, field.inputs);
  }
  return save('fields', { ...values, ...overrides });
}

describe('the confirmation after a save', () => {
  const saved = (id: number, query = '?saved=1') => run(CandidateRoute, `/curator/candidate/${id}${query}`, { auth: curator, params: { id: String(id) } });

  it('shows "Saved and published" as a notice after a real save', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    expect((await page(c.candidateId, save('field:age', { 'status.age': 'value', age: '47' }))).status).toBe(302);
    const res = await saved(c.candidateId);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(t('en', 'curator.candidateEdit.notice.saved'));
    expect(html).toContain('role="status"');
  });

  // Only a name or party also stamps the candidate row; every other field stamps
  // just its own row, and the notice must still appear for those.
  it('shows it after saving a field that does not touch the candidate row, on an older candidate', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    await db.update(schema.candidates).set({ updatedAt: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(schema.candidates.id, c.candidateId));
    expect((await page(c.candidateId, save('field:age', { 'status.age': 'value', age: '47' }))).status).toBe(302);
    expect((await candidateRow(c.candidateId)).updatedAt.getTime()).toBeLessThan(Date.now() - 30 * 60 * 1000);
    expect(await (await saved(c.candidateId)).text()).toContain(t('en', 'curator.candidateEdit.notice.saved'));
  });

  it('shows it after a ward-only save too', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    await page(c.candidateId, save('ward', { wardId: String(WARD_B.id) }));
    expect(await (await saved(c.candidateId)).text()).toContain(t('en', 'curator.candidateEdit.notice.saved'));
  });

  // The query string is never proof: a stale or typed URL for a candidate
  // nobody just edited shows no notice.
  it('shows nothing for ?saved=1 when the candidate was not edited just now', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await db.update(schema.candidates).set({ updatedAt: anHourAgo }).where(eq(schema.candidates.id, c.candidateId));
    await db.update(schema.candidateFields).set({ updatedAt: anHourAgo }).where(eq(schema.candidateFields.candidateId, c.candidateId));
    expect(await (await saved(c.candidateId)).text()).not.toContain(t('en', 'curator.candidateEdit.notice.saved'));
  });

  it('shows nothing on a plain visit', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    await page(c.candidateId, save('field:age', { 'status.age': 'value', age: '47' }));
    expect(await (await saved(c.candidateId, '')).text()).not.toContain(t('en', 'curator.candidateEdit.notice.saved'));
  });

  it('is in the curator\'s saved language', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    await page(c.candidateId, save('field:age', { 'status.age': 'value', age: '47' }));
    await db.update(schema.users).set({ language: 'kn' }).where(eq(schema.users.id, curator.userId));
    try {
      expect(await (await saved(c.candidateId)).text()).toContain(t('kn', 'curator.candidateEdit.notice.saved'));
    } finally {
      await db.update(schema.users).set({ language: 'en' }).where(eq(schema.users.id, curator.userId));
    }
  });
});

describe('one save for report-card and ward changes', () => {
  it('saves multiple changes and ward together, leaving other provenance untouched', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const before = await fieldRow(c.candidateId, 'cases');
    const form = await batch(c.candidateId, { age: '48', party: 'Demo Corrected Party (FICTIONAL)', wardId: String(WARD_B.id) });
    expect((await page(c.candidateId, form)).status).toBe(302);
    expect((await fieldRow(c.candidateId, 'age'))!.checkedBy).toBe(curator.userId);
    expect((await fieldRow(c.candidateId, 'party'))!.valueEn).toBe('Demo Corrected Party (FICTIONAL)');
    expect(await fieldRow(c.candidateId, 'cases')).toEqual(before);
    expect((await candidateRow(c.candidateId)).wardId).toBe(WARD_B.id);
  });

  it('invalid field prevents all changes and preserves every entered value', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const form = await batch(c.candidateId, { age: '121', name: 'Changed Name (FICTIONAL)', wardId: String(WARD_B.id) });
    const response = await page(c.candidateId, form);
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('value="121"');
    expect(html).toContain('value="Changed Name (FICTIONAL)"');
    expect((await candidateRow(c.candidateId)).wardId).toBe(WARD_A.id);
    expect((await candidateRow(c.candidateId)).nameEn).not.toBe('Changed Name (FICTIONAL)');
    expect((await fieldRow(c.candidateId, 'age'))!.checkedBy).toBeNull();
  });

  it('invalid ward prevents otherwise valid field changes', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    expect((await page(c.candidateId, await batch(c.candidateId, { age: '48', wardId: '999999999' }))).status).toBe(400);
    expect((await fieldRow(c.candidateId, 'age'))!.checkedBy).toBeNull();
  });

  it('requires confirmation and refuses an unchanged form without confirming AI data', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const form = await batch(c.candidateId, { age: '48' });
    form.delete('confirmPublish');
    expect((await page(c.candidateId, form)).status).toBe(400);
    // Saving the form exactly as it opened changes nothing: a notice, not an error.
    const unchanged = await page(c.candidateId, await batch(c.candidateId));
    expect(unchanged.status).toBe(200);
    expect(await unchanged.text()).toContain(t('en', 'curator.fix.error.unchanged'));
    expect((await fieldRow(c.candidateId, 'age'))!.checkedBy).toBeNull();
  });

  it('allows a ward-only change without marking any report-card field checked', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    expect((await page(c.candidateId, await batch(c.candidateId, { wardId: String(WARD_B.id) }))).status).toBe(302);
    expect((await fieldRow(c.candidateId, 'age'))!.checkedBy).toBeNull();
  });
});

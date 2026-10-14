/**
 * `/curator/queue/{id}`: a flag seen against the affidavit, fixed with the
 * flagged field's structured inputs or by moving the candidate to another
 * ward, or dismissed. Through the real middleware and page twin.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { Fixtures, client, db, fieldRow, run, schema, tokenForm, ward, type Auth } from './support/staff-harness';
import { submitFlag } from '../../src/lib/flags';
import { t } from '../../src/i18n';
import QueueItemRoute from '../../src/pages/curator/queue/[id].astro';

// This suite owns ward ids 99411 and 99412.
const WARD_A = ward(99411, 'Flag Fix Test Ward A');
const WARD_B = ward(99412, 'Flag Fix Test Ward B');
const fx = new Fixtures('curator-flag-fix-test-');
let curator: Auth;
let citizen: Auth;

const item = (id: number, auth?: Auth, form?: FormData) => run(QueueItemRoute, `/curator/queue/${id}`, { auth, form, params: { id: String(id) } });
const flag = async (candidateId: number, key: string) => (await submitFlag(citizen.userId, { targetType: 'candidate_field', targetRef: `candidate:${candidateId}:${key}`, detail: `The ${key} is wrong` })).flagItemId;
const flagRow = async (id: number) => (await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, id)))[0];
const fix = (fields: Record<string, string>) => tokenForm(curator, { formAction: 'fix', confirmPublish: 'on', ...fields });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' });
  await fx.wards(WARD_A, WARD_B);
  curator = await fx.person('curator');
  citizen = await fx.person('citizen');
});

afterAll(async () => {
  await fx.cleanup();
  await client.end();
});

describe('who may open a flag', () => {
  it('refuses a citizen', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    expect((await item(await flag(c.candidateId, 'age'), citizen)).status).toBe(403);
  });
});

describe('a flag on an affidavit field', () => {
  it('shows the affidavit beside the flagged field, pre-filled with the published value', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const res = await item(await flag(c.candidateId, 'assets'), curator);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    // Astro escapes the ampersand in an attribute as `&#38;`.
    expect(html).toContain(`src="${c.pdfUrl}#navpanes=0&#38;view=FitH"`);
    expect(html).toContain('name="movableInr" value="10210000"');
    expect(html).toContain('name="immovableInr" value="35000000"');
    expect(html).not.toContain('name="age"');
    expect(html).toContain('The assets is wrong');
  });

  it('publishes the fix as a structured, person-checked value and accepts the flag', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'assets');
    const res = await item(id, curator, fix({ 'status.assets': 'value', movableInr: '1,02,10,000', immovableInr: '2,40,00,000' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/curator/queue');
    const row = (await fieldRow(c.candidateId, 'assets'))!;
    expect(row.valueData).toEqual({ key: 'assets', status: 'value', movableInr: 10210000, immovableInr: 24000000 });
    expect(row.checkedBy).toBe(curator.userId);
    expect(row.aiExtracted).toBe(false);
    expect(row.sourceUrl).toBe(c.pdfUrl);
    expect(row.sourceType).toBe('official');
    expect((await flagRow(id)).status).toBe('accepted');
    expect((await flagRow(id)).resolvedBy).toBe(curator.userId);
  });

  it('publishes "not declared" as an answer', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'cases');
    expect((await item(id, curator, fix({ 'status.cases': 'not_declared' }))).status).toBe(302);
    const row = (await fieldRow(c.candidateId, 'cases'))!;
    expect(row.notDeclared).toBe(true);
    expect(row.valueEn).toBeNull();
  });

  it('refuses the published value typed again, however the digits are grouped', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'assets');
    const res = await item(id, curator, fix({ 'status.assets': 'value', movableInr: '1,02,10,000', immovableInr: '3,50,00,000' }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(t('en', 'curator.fix.error.unchanged'));
    expect((await flagRow(id)).status).toBe('pending');
    expect((await fieldRow(c.candidateId, 'assets'))!.checkedBy).toBeNull();
  });

  it('publishes a correction that changes only the capitals of a name', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    await db.update(schema.candidates).set({ nameEn: 'RAVI KUMAR (FICTIONAL)' }).where(eq(schema.candidates.id, c.candidateId));
    const id = await flag(c.candidateId, 'full_name');
    const res = await item(id, curator, fix({ 'status.full_name': 'value', name: 'Ravi Kumar (Fictional)' }));
    expect(res.status).toBe(302);
    expect((await db.select().from(schema.candidates).where(eq(schema.candidates.id, c.candidateId)))[0].nameEn).toBe('Ravi Kumar (Fictional)');
    expect((await fieldRow(c.candidateId, 'full_name'))!.valueData).toEqual({ key: 'full_name', status: 'value', text: 'Ravi Kumar (Fictional)' });
    expect((await flagRow(id)).status).toBe('accepted');
  });

  it('refuses the published name typed again with only space around it', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const name = c.extraction.identity.name.text!;
    const id = await flag(c.candidateId, 'full_name');
    const res = await item(id, curator, fix({ 'status.full_name': 'value', name: `  ${name}  ` }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(t('en', 'curator.fix.error.unchanged'));
    expect((await flagRow(id)).status).toBe('pending');
    expect((await fieldRow(c.candidateId, 'full_name'))!.checkedBy).toBeNull();
  });

  it('refuses an invalid value, writes nothing, and shows back what was typed', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'age');
    const res = await item(id, curator, fix({ 'status.age': 'value', age: 'forty' }));
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain(t('en', 'transcribe.error.whole_number'));
    expect(html).toContain('name="age" value="forty"');
    expect((await fieldRow(c.candidateId, 'age'))!.valueData).toEqual({ key: 'age', status: 'value', years: 52 });
    expect((await flagRow(id)).status).toBe('pending');
  });

  it('refuses a fix without the confirmation tick', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'age');
    const res = await item(id, curator, tokenForm(curator, { formAction: 'fix', 'status.age': 'value', age: '41' }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(t('en', 'curator.fix.error.confirmRequired'));
    expect((await flagRow(id)).status).toBe('pending');
  });

  it('opens empty for a field that holds only free text, and a save gives it structure', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    await db.update(schema.candidateFields).set({ valueData: null, valueEn: 'Some college' }).where(eq(schema.candidateFields.id, (await fieldRow(c.candidateId, 'education'))!.id));
    const id = await flag(c.candidateId, 'education');
    const html = await (await item(id, curator)).text();
    expect(html).toContain('Some college');
    // Astro writes an empty attribute bare (`value`), which is the same thing as `value=""`.
    expect(html).toMatch(/name="educationStated" value(="")?[ >]/);
    expect((await item(id, curator, fix({ 'status.education': 'value', educationLevel: 'Graduate', educationStated: 'B.Com' }))).status).toBe(302);
    expect((await fieldRow(c.candidateId, 'education'))!.valueData).toEqual({ key: 'education', status: 'value', level: 'Graduate', stated: 'B.Com' });
  });

  it('tells a second curator the flag is already resolved', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'age');
    expect((await item(id, curator, fix({ 'status.age': 'value', age: '41' }))).status).toBe(302);
    const res = await item(id, curator, fix({ 'status.age': 'value', age: '42' }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(t('en', 'curator.queueItem.alreadyResolved'));
    expect((await fieldRow(c.candidateId, 'age'))!.valueData).toEqual({ key: 'age', status: 'value', years: 41 });
  });
});

describe('a flag on the ward', () => {
  it('moves the candidate, takes its other pending flags along, and accepts the flag', async () => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const other = await flag(c.candidateId, 'age');
    const id = await flag(c.candidateId, 'ward');
    const html = await (await item(id, curator)).text();
    expect(html).toContain(`<option value="${WARD_A.id}" selected`);
    expect((await item(id, curator, fix({ wardId: String(WARD_B.id) }))).status).toBe(302);
    const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, c.candidateId));
    expect(candidate.wardId).toBe(WARD_B.id);
    expect(candidate.slug).toBe(c.slug);
    expect((await fieldRow(c.candidateId, 'ward'))!.aiExtracted).toBe(false);
    expect((await flagRow(id)).status).toBe('accepted');
    expect((await flagRow(other)).wardId).toBe(WARD_B.id);
  });

  const refusedWards: Array<[label: string, wardId: () => string, key: string]> = [
    ['the ward the candidate is already in', () => String(WARD_A.id), 'curator.fix.error.unchanged'],
    ['a ward that does not exist', () => '99999999', 'curator.fix.error.unknownWard'],
    ['something that is not a number', () => 'north', 'curator.fix.error.unknownWard'],
  ];
  it.each(refusedWards)('refuses %s', async (_label, wardId, key) => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const id = await flag(c.candidateId, 'ward');
    const res = await item(id, curator, fix({ wardId: wardId() }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(t('en', key));
    expect((await db.select().from(schema.candidates).where(eq(schema.candidates.id, c.candidateId)))[0].wardId).toBe(WARD_A.id);
    expect((await flagRow(id)).status).toBe('pending');
  });
});

describe('the source a citizen gave', () => {
  const flagWithSource = async (sourceUrl: string) => {
    const c = await fx.candidateWithAffidavit(WARD_A.id);
    const { flagItemId } = await submitFlag(citizen.userId, { targetType: 'candidate_field', targetRef: `candidate:${c.candidateId}:age`, detail: 'See the source', sourceUrl });
    return (await item(flagItemId, curator)).text();
  };

  it('is a link when it is a web address', async () => {
    expect(await flagWithSource('https://example.com/affidavit')).toContain('href="https://example.com/affidavit"');
  });

  it('is plain text when it is anything else', async () => {
    const html = await flagWithSource('javascript:alert(1)');
    expect(html).toContain('javascript:alert(1)');
    expect(html).not.toContain('href="javascript:');
  });
});

describe('flags that cannot be fixed here', () => {
  it('points to Matching when the only affidavit was sent back by a transcriber', async () => {
    const candidateId = await fx.bareCandidate(WARD_A.id);
    const waiting = await fx.waitingAffidavit({ wardId: WARD_A.id, reason: 'reported_by_transcriber', candidateId });
    const html = await (await item(await flag(candidateId, 'age'), curator)).text();
    // Astro escapes the apostrophe in text.
    expect(html).toContain(t('en', 'curator.fix.affidavitWaiting').replace("'", '&#39;'));
    expect(html).toContain(`href="/curator/matching/${waiting.affidavitId}"`);
    expect(html).not.toContain(t('en', 'curator.fix.noAffidavitLink'));
    expect(html).not.toContain('value="fix"');
  });

  it('offers only dismissal for a candidate with no stored affidavit, and refuses a fix posted anyway', async () => {
    const candidateId = await fx.bareCandidate(WARD_A.id);
    const id = await flag(candidateId, 'age');
    const html = await (await item(id, curator)).text();
    expect(html).not.toContain('value="fix"');
    expect(html).not.toContain('<iframe');
    expect(html).toContain(`/curator/candidate/${candidateId}`);
    const res = await item(id, curator, fix({ 'status.age': 'value', age: '41' }));
    expect(res.status).toBe(400);
    expect(await fieldRow(candidateId, 'age')).toBeUndefined();
    expect((await item(id, curator, tokenForm(curator, { formAction: 'reject', reason: 'No affidavit on file yet' }))).status).toBe(302);
    expect((await flagRow(id)).status).toBe('rejected');
  });

  it('offers only dismissal for an old ward-issue flag', async () => {
    const [old] = await db.insert(schema.flagItems).values({ wardId: WARD_A.id, targetType: 'ward_issue', targetRef: 'ward_issue:999999', status: 'pending' }).returning({ id: schema.flagItems.id });
    const html = await (await item(old.id, curator)).text();
    expect(html).not.toContain('value="fix"');
    expect(html).toContain(t('en', 'curator.fix.dismissOnly'));
    expect((await item(old.id, curator, fix({ wardId: String(WARD_B.id) }))).status).toBe(400);
    expect((await flagRow(old.id)).status).toBe('pending');
  });
});

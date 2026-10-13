/**
 * src/lib/affidavit-publish.ts: the only writer of structured candidate
 * field values. Pure rendering and validation first, then the database
 * write, including what a later curator free-text edit does to it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';
import { db as appDb } from '../../src/db/client';
import {
  renderField,
  checkFieldData,
  fieldsFromExtraction,
  sameFieldData,
  publishAffidavitFields,
  type FieldData,
} from '../../src/lib/affidavit-publish';
import { publishCandidateField } from '../../src/lib/publish';
import type { AffidavitExtraction } from '../../src/lib/affidavit-extraction';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// This suite owns ward id 99440.
const WARD = {
  id: 99440,
  nameEn: 'Affidavit Publish Test Ward',
  nameKn: 'ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
  corporation: 'south' as const,
  zone: 'Zone T',
  boundaryRef: 'affidavit-publish-test-ward',
};
const SOURCE = '/media/1/abcdef0123456789';

function extraction(): AffidavitExtraction {
  return {
    age: { status: 'value', years: 52 },
    education: { status: 'value', level: 'Graduate', stated: 'B.Com' },
    assets: { status: 'value', movableInr: 10210000, immovableInr: 35000000, totalInr: 45210000, note: 'self and spouse' },
    cases: { status: 'value', pending: 2, convictions: 0, note: 'IPC 420' },
    identity: {
      name: { status: 'value', text: 'Demo Person (FICTIONAL)' },
      ward: { status: 'value', number: 440, name: 'Affidavit Publish Test Ward', corporation: 'south' },
      party: { status: 'value', text: 'Demo Party A' },
      gender: { status: 'value', gender: 'female' },
    },
    confidence: 82,
  };
}

describe('renderField', () => {
  it.each<[FieldData, string | null]>([
    [{ key: 'age', status: 'value', years: 52 }, '52'],
    [{ key: 'education', status: 'value', level: 'Graduate', stated: 'B.Com' }, 'Graduate: B.Com'],
    [{ key: 'education', status: 'value', level: 'Graduate', stated: 'Graduate' }, 'Graduate'],
    [
      { key: 'assets', status: 'value', movableInr: 10210000, immovableInr: 35000000 },
      '₹4,52,10,000 (movable ₹1,02,10,000; immovable ₹3,50,00,000)',
    ],
    [{ key: 'assets', status: 'value', movableInr: 0, immovableInr: 950 }, '₹950 (movable ₹0; immovable ₹950)'],
    [{ key: 'cases', status: 'value', pending: 2, convictions: 0 }, '2 pending, 0 convictions'],
    [{ key: 'gender', status: 'value', gender: 'male' }, 'Male'],
    [{ key: 'full_name', status: 'value', text: 'A Person' }, 'A Person'],
    [{ key: 'age', status: 'not_declared', years: null }, null],
    [{ key: 'cases', status: 'unreadable', pending: null, convictions: null }, null],
  ])('renders %j as %j', (data, text) => {
    expect(renderField(data)).toBe(text);
  });
});

describe('checkFieldData', () => {
  it('accepts consistent data', () => {
    expect(checkFieldData({ key: 'age', status: 'value', years: 40 })).toBeNull();
    expect(checkFieldData({ key: 'assets', status: 'not_declared', movableInr: null, immovableInr: null })).toBeNull();
  });

  it.each<FieldData>([
    { key: 'age', status: 'value', years: 0 },
    { key: 'age', status: 'value', years: 121 },
    { key: 'age', status: 'value', years: 40.5 },
    { key: 'age', status: 'value', years: null },
    { key: 'age', status: 'unreadable', years: 40 },
    { key: 'assets', status: 'value', movableInr: -1, immovableInr: 0 },
    { key: 'assets', status: 'value', movableInr: 5, immovableInr: null },
    { key: 'cases', status: 'value', pending: -1, convictions: 0 },
    { key: 'full_name', status: 'value', text: '   ' },
    { key: 'education', status: 'value', level: null, stated: 'B.Com' },
    { key: 'gender', status: 'value', gender: null },
  ])('rejects %j', (data) => {
    expect(checkFieldData(data)).not.toBeNull();
  });
});

describe('fieldsFromExtraction and sameFieldData', () => {
  it('returns the seven fields in affidavit order, without the ward', () => {
    expect(fieldsFromExtraction(extraction()).map((f) => f.key)).toEqual([
      'full_name', 'party', 'gender', 'age', 'education', 'assets', 'cases',
    ]);
  });

  it('compares values, ignoring surrounding space and letter case in text', () => {
    expect(sameFieldData({ key: 'party', status: 'value', text: 'Demo Party A' }, { key: 'party', status: 'value', text: ' demo party a ' })).toBe(true);
    expect(sameFieldData({ key: 'age', status: 'value', years: 52 }, { key: 'age', status: 'value', years: 53 })).toBe(false);
    expect(sameFieldData({ key: 'age', status: 'value', years: 52 }, { key: 'age', status: 'not_declared', years: null })).toBe(false);
  });
});

describe('publishAffidavitFields', () => {
  let candidateId: number;

  async function field(key: string) {
    const [row] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, key)));
    return row;
  }

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });
    const [row] = await db
      .insert(schema.candidates)
      .values({ slug: `affidavit-publish-${randomUUID()}`, wardId: WARD.id, nameEn: 'Placeholder (FICTIONAL)', partyEn: 'Independent' })
      .returning({ id: schema.candidates.id });
    candidateId = row.id;
  });

  afterAll(async () => {
    const ids = (await db.select({ id: schema.candidates.id }).from(schema.candidates).where(eq(schema.candidates.wardId, WARD.id))).map((r) => r.id);
    if (ids.length) await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, ids));
    await db.delete(schema.candidates).where(eq(schema.candidates.wardId, WARD.id));
    await client.end();
  });

  it('publishes an extraction as the system with structured data, text and the AI label', async () => {
    await appDb.transaction((tx) =>
      publishAffidavitFields(tx, { userId: null, role: 'system' }, candidateId, fieldsFromExtraction(extraction()), { sourceUrl: SOURCE, checked: false }),
    );

    const assets = await field('assets');
    expect(assets.valueEn).toBe('₹4,52,10,000 (movable ₹1,02,10,000; immovable ₹3,50,00,000)');
    expect(assets.valueData).toEqual({ key: 'assets', status: 'value', movableInr: 10210000, immovableInr: 35000000 });
    expect(assets).toMatchObject({ aiExtracted: true, notDeclared: false, unreadable: false, sourceType: 'official', sourceUrl: SOURCE });

    const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateId));
    expect(candidate.nameEn).toBe('Demo Person (FICTIONAL)');
    expect(candidate.partyEn).toBe('Demo Party A');
    expect((await field('full_name')).aiExtracted).toBe(true);
    expect((await field('gender')).valueEn).toBe('Female');
  });

  it('publishes not declared and unreadable without a value', async () => {
    await appDb.transaction((tx) =>
      publishAffidavitFields(
        tx,
        { userId: null, role: 'system' },
        candidateId,
        [
          { key: 'age', status: 'not_declared', years: null },
          { key: 'cases', status: 'unreadable', pending: null, convictions: null },
        ],
        { sourceUrl: SOURCE, checked: false },
      ),
    );
    expect(await field('age')).toMatchObject({ valueEn: null, notDeclared: true, unreadable: false });
    expect(await field('cases')).toMatchObject({ valueEn: null, notDeclared: false, unreadable: true, aiExtracted: true });
  });

  it('never overwrites the candidate name with an unreadable one', async () => {
    await appDb.transaction((tx) =>
      publishAffidavitFields(tx, { userId: null, role: 'system' }, candidateId, [{ key: 'full_name', status: 'unreadable', text: null }], { sourceUrl: SOURCE, checked: false }),
    );
    const [candidate] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, candidateId));
    expect(candidate.nameEn).toBe('Demo Person (FICTIONAL)');
    expect((await field('full_name')).unreadable).toBe(true);
  });

  it('refuses inconsistent data and writes nothing', async () => {
    await expect(
      appDb.transaction((tx) =>
        publishAffidavitFields(tx, { userId: null, role: 'system' }, candidateId, [{ key: 'assets', status: 'value', movableInr: -5, immovableInr: 1 }], { sourceUrl: SOURCE, checked: false }),
      ),
    ).rejects.toThrow(/assets/);
    expect((await field('assets')).valueEn).toContain('₹4,52,10,000');
  });

  describe('checked by a person', () => {
    const transcriber = { userId: 4242, role: 'transcriber' as const };
    const ai = fieldsFromExtraction(extraction());

    async function reset() {
      await appDb.transaction((tx) => publishAffidavitFields(tx, { userId: null, role: 'system' }, candidateId, ai, { sourceUrl: SOURCE, checked: false }));
    }

    it('marks a confirmed value checked, by whom and when, and clears the AI label', async () => {
      await reset();
      const before = Date.now();
      await appDb.transaction((tx) =>
        publishAffidavitFields(tx, transcriber, candidateId, [{ key: 'age', status: 'value', years: 52 }], { sourceUrl: SOURCE, checked: true, aiFields: ai }),
      );
      const age = await field('age');
      expect(age).toMatchObject({ aiExtracted: false, checkedBy: 4242, confirmedAi: true, valueEn: '52' });
      expect(age.checkedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it('records that the person changed the AI value', async () => {
      await reset();
      await appDb.transaction((tx) =>
        publishAffidavitFields(tx, transcriber, candidateId, [{ key: 'age', status: 'value', years: 53 }], { sourceUrl: SOURCE, checked: true, aiFields: ai }),
      );
      expect(await field('age')).toMatchObject({ aiExtracted: false, checkedBy: 4242, confirmedAi: false, valueEn: '53' });
    });

    it('leaves fields that were not submitted exactly as they were', async () => {
      await reset();
      await appDb.transaction((tx) =>
        publishAffidavitFields(tx, transcriber, candidateId, [{ key: 'age', status: 'value', years: 53 }], { sourceUrl: SOURCE, checked: true, aiFields: ai }),
      );
      expect(await field('assets')).toMatchObject({ aiExtracted: true, checkedBy: null, checkedAt: null, confirmedAi: null });
    });

    it('treats "not declared" as a checked answer', async () => {
      await reset();
      await appDb.transaction((tx) =>
        publishAffidavitFields(tx, transcriber, candidateId, [{ key: 'cases', status: 'not_declared', pending: null, convictions: null }], { sourceUrl: SOURCE, checked: true, aiFields: ai }),
      );
      expect(await field('cases')).toMatchObject({ notDeclared: true, aiExtracted: false, checkedBy: 4242, confirmedAi: false });
    });

    it('does not call "cannot read" a checked value', async () => {
      await reset();
      await appDb.transaction((tx) =>
        publishAffidavitFields(tx, transcriber, candidateId, [{ key: 'assets', status: 'unreadable', movableInr: null, immovableInr: null }], { sourceUrl: SOURCE, checked: true, aiFields: ai }),
      );
      expect(await field('assets')).toMatchObject({ unreadable: true, valueEn: null, aiExtracted: true, checkedBy: null, checkedAt: null, confirmedAi: null });
    });

    it('forgets who checked a value when the system later rewrites it', async () => {
      await reset();
      await appDb.transaction((tx) =>
        publishAffidavitFields(tx, transcriber, candidateId, [{ key: 'age', status: 'value', years: 53 }], { sourceUrl: SOURCE, checked: true, aiFields: ai }),
      );
      await reset();
      expect(await field('age')).toMatchObject({ aiExtracted: true, checkedBy: null, checkedAt: null, confirmedAi: null, valueEn: '52' });
    });

    it('clears the check marks when a curator rewrites the text by hand', async () => {
      await reset();
      await appDb.transaction((tx) =>
        publishAffidavitFields(tx, transcriber, candidateId, [{ key: 'age', status: 'value', years: 53 }], { sourceUrl: SOURCE, checked: true, aiFields: ai }),
      );
      await publishCandidateField({ userId: 1, role: 'curator' }, { candidateId, fieldKey: 'age', valueEn: '54', sourceUrl: SOURCE, sourceType: 'official', authoredLang: 'en' });
      expect(await field('age')).toMatchObject({ valueEn: '54', aiExtracted: false, confirmedAi: null, valueData: null });
    });
  });

  it("drops the structured value when a curator edits the field's text by hand", async () => {
    await publishCandidateField(
      { userId: 1, role: 'curator' },
      { candidateId, fieldKey: 'cases', valueEn: 'One pending case, per the corrected affidavit', sourceUrl: SOURCE, sourceType: 'official', authoredLang: 'en' },
    );
    const cases = await field('cases');
    expect(cases.valueData).toBeNull();
    expect(cases.unreadable).toBe(false);
    expect(cases.aiExtracted).toBe(false);
  });
});

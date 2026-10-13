import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/lib/translate-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/translate-runtime')>();
  return { ...actual, translateFieldSoon: vi.fn() };
});

import { translateFieldSoon } from '../../src/lib/translate-runtime';
import { submitFlag, resolveFlag } from '../../src/lib/flags';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 5 });
const db = drizzle(client, { schema });

// High, task-specific ward id (Task 31 brief) — other suites own
// 94xxx-99202; this suite owns 99310 (and 99312 for a second ward, B).
const WARD_ID = 99310;
const WARD_ID_B = 99312; // a SECOND ward — curators are city-wide, so the same curator acts here too

let candidateId: number;
let candidateBId: number; // in WARD_ID_B
let submitterAId: number;
let submitterBId: number;
let raceUserAId: number;
let raceUserBId: number;
// A REAL curator user, used by every curator ACCEPT below.
let curatorUserId: number;

function targetRefFor(fieldKey: string): string {
  return `candidate:${candidateId}:${fieldKey}`;
}

/**
 * A flag target on a brand-new candidate in WARD_ID. Only eight field keys are
 * flaggable, so a test that needs a pending item no other test has touched
 * takes its own candidate rather than an invented field key.
 */
async function freshTargetRef(fieldKey = 'age'): Promise<string> {
  const [row] = await db
    .insert(schema.candidates)
    .values({ slug: `flags-test-fresh-${randomUUID()}`, wardId: WARD_ID, nameEn: 'Flags Test Fresh Candidate', partyEn: 'Independent' })
    .returning({ id: schema.candidates.id });
  return `candidate:${row!.id}:${fieldKey}`;
}

/** The stored affidavit a fix is checked against; any path does for these tests. */
const SOURCE_URL = '/media/1/abc';

async function fieldRow(ofCandidateId: number, fieldKey: string) {
  const [row] = await db
    .select()
    .from(schema.candidateFields)
    .where(and(eq(schema.candidateFields.candidateId, ofCandidateId), eq(schema.candidateFields.fieldKey, fieldKey)));
  return row;
}

describe('flags.ts — deduped flag queue + transactional resolution (Task 31)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    await db
      .insert(schema.wards)
      .values({
        id: WARD_ID,
        nameEn: 'Flags Test Ward',
        nameKn: 'ಫ್ಲ್ಯಾಗ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
        corporation: 'south',
        zone: 'Zone F',
        boundaryRef: 'flags-test-ward',
      })
      .onConflictDoUpdate({ target: schema.wards.id, set: { nameEn: 'Flags Test Ward' } });

    await db
      .insert(schema.wards)
      .values({
        id: WARD_ID_B,
        nameEn: 'Flags Test Ward B',
        nameKn: 'ಫ್ಲ್ಯಾಗ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಬಿ',
        corporation: 'south',
        zone: 'Zone F',
        boundaryRef: 'flags-test-ward-b',
      })
      .onConflictDoUpdate({ target: schema.wards.id, set: { nameEn: 'Flags Test Ward B' } });

    const [candidate] = await db
      .insert(schema.candidates)
      .values({
        slug: `flags-test-candidate-${randomUUID()}`,
        wardId: WARD_ID,
        nameEn: 'Flags Test Candidate',
        partyEn: 'Independent',
      })
      .returning();
    candidateId = candidate!.id;

    const [candidateB] = await db
      .insert(schema.candidates)
      .values({
        slug: `flags-test-candidate-b-${randomUUID()}`,
        wardId: WARD_ID_B,
        nameEn: 'Flags Test Candidate B',
        partyEn: 'Independent',
      })
      .returning();
    candidateBId = candidateB!.id;

    // A real curator user, with no ward assignment of any kind.
    const [curatorUser] = await db
      .insert(schema.users)
      .values({ email: `flags-test-curator-${randomUUID()}@example.com`, homeWardId: WARD_ID, role: 'curator', status: 'active' })
      .returning();
    curatorUserId = curatorUser!.id;

    const submitterA = await db
      .insert(schema.users)
      .values({ email: `flags-test-submitter-a-${randomUUID()}@example.com`, homeWardId: WARD_ID, role: 'citizen', status: 'active' })
      .returning();
    submitterAId = submitterA[0]!.id;

    const submitterB = await db
      .insert(schema.users)
      .values({ email: `flags-test-submitter-b-${randomUUID()}@example.com`, homeWardId: WARD_ID, role: 'citizen', status: 'active' })
      .returning();
    submitterBId = submitterB[0]!.id;

    const raceUserA = await db
      .insert(schema.users)
      .values({ email: `flags-test-race-a-${randomUUID()}@example.com`, homeWardId: WARD_ID, role: 'citizen', status: 'active' })
      .returning();
    raceUserAId = raceUserA[0]!.id;

    const raceUserB = await db
      .insert(schema.users)
      .values({ email: `flags-test-race-b-${randomUUID()}@example.com`, homeWardId: WARD_ID, role: 'citizen', status: 'active' })
      .returning();
    raceUserBId = raceUserB[0]!.id;
  });

  afterAll(async () => {
    await client.end();
  });

  it('two users flagging the SAME targetRef collapse onto ONE flag_item with TWO flag_submissions', async () => {
    const targetRef = targetRefFor('cases');

    const first = await submitFlag(submitterAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Says no pending cases, but there is a FIR.',
      sourceUrl: 'https://example.org/fir-record',
    });

    const second = await submitFlag(submitterBId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Confirming — FIR #123 is public record.',
    });

    expect(second.flagItemId).toBe(first.flagItemId);

    const items = await db.select().from(schema.flagItems).where(eq(schema.flagItems.targetRef, targetRef));
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe('pending');
    expect(items[0]!.wardId).toBe(WARD_ID);
    expect(items[0]!.targetType).toBe('candidate_field');

    const submissions = await db
      .select()
      .from(schema.flagSubmissions)
      .where(eq(schema.flagSubmissions.flagItemId, first.flagItemId));
    expect(submissions).toHaveLength(2);
    expect(submissions.map((s) => s.userId).sort()).toEqual([submitterAId, submitterBId].sort());
  });

  it('resolveFlag ACCEPT: publishes the fix as a structured, person-checked value AND marks the item accepted; both submitters see the same accepted status', async () => {
    const targetRef = targetRefFor('age');

    const first = await submitFlag(submitterAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'The age is out of date.',
      suggestedValue: '41',
      sourceUrl: 'https://example.org/age-source',
    });
    await submitFlag(submitterBId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Agreed, needs updating.',
    });

    await resolveFlag({ userId: curatorUserId, role: 'curator' }, first.flagItemId, {
      accept: true,
      fix: { kind: 'field', candidateId, data: { key: 'age', status: 'value', years: 41 }, sourceUrl: SOURCE_URL },
    });

    const field = await fieldRow(candidateId, 'age');
    expect(field).toBeDefined();
    expect(field!.valueData).toEqual({ key: 'age', status: 'value', years: 41 });
    expect(field!.valueEn).toBe('41');
    expect(field!.checkedBy).toBe(curatorUserId);
    expect(field!.aiExtracted).toBe(false);
    expect(field!.sourceUrl).toBe(SOURCE_URL);

    const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, first.flagItemId));
    expect(item!.status).toBe('accepted');
    expect(item!.resolvedBy).toBe(curatorUserId);
    expect(item!.resolvedAt).not.toBeNull();

    // Both submitters' visible status is the SAME item — no per-submission
    // state to check separately, but confirm both rows still point at it.
    const submissions = await db
      .select()
      .from(schema.flagSubmissions)
      .where(eq(schema.flagSubmissions.flagItemId, first.flagItemId));
    expect(submissions).toHaveLength(2);
    for (const s of submissions) {
      const [resolvedItem] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, s.flagItemId));
      expect(resolvedItem!.status).toBe('accepted');
    }
  });

  it('resolveFlag REJECT: marks the item rejected with a reason; no publish; both submitters see the same rejected+reason', async () => {
    const targetRef = targetRefFor('assets');

    const first = await submitFlag(submitterAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Assets figure seems wrong.',
    });
    await submitFlag(submitterBId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Same concern here.',
    });

    await resolveFlag(
      { userId: 4202, role: 'admin' },
      first.flagItemId,
      { accept: false, reason: 'Verified against affidavit — figure is correct as published.' },
    );

    const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, first.flagItemId));
    expect(item!.status).toBe('rejected');
    expect(item!.resolutionReason).toBe('Verified against affidavit — figure is correct as published.');
    expect(item!.resolvedBy).toBe(4202);
    expect(item!.resolvedAt).not.toBeNull();

    // No candidate_fields row was ever created for this field.
    const [field] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, 'assets')));
    expect(field).toBeUndefined();

    const submissions = await db
      .select()
      .from(schema.flagSubmissions)
      .where(eq(schema.flagSubmissions.flagItemId, first.flagItemId));
    expect(submissions).toHaveLength(2);
    for (const s of submissions) {
      const [resolvedItem] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, s.flagItemId));
      expect(resolvedItem!.status).toBe('rejected');
      expect(resolvedItem!.resolutionReason).toBe('Verified against affidavit — figure is correct as published.');
    }
  });

  it('a NEW flag on a previously-REJECTED targetRef opens a fresh pending item (partial unique index on targetRef WHERE status=pending)', async () => {
    const targetRef = targetRefFor('education');

    const original = await submitFlag(submitterAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Education claim disputed.',
    });

    await resolveFlag({ userId: 4203, role: 'admin' }, original.flagItemId, {
      accept: false,
      reason: 'Checked, claim stands.',
    });

    const fresh = await submitFlag(submitterBId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'New concern raised again after rejection.',
    });

    expect(fresh.flagItemId).not.toBe(original.flagItemId);

    const items = await db
      .select()
      .from(schema.flagItems)
      .where(eq(schema.flagItems.targetRef, targetRef));
    expect(items).toHaveLength(2);

    const rejected = items.find((i) => i.id === original.flagItemId);
    const pending = items.find((i) => i.id === fresh.flagItemId);
    expect(rejected!.status).toBe('rejected');
    expect(pending!.status).toBe('pending');
  });

  it('race: pre-inserted pending item is FOUND, not duplicated (deterministic loser-path)', async () => {
    const targetRef = await freshTargetRef();

    const [preInserted] = await db
      .insert(schema.flagItems)
      .values({ wardId: WARD_ID, targetType: 'candidate_field', targetRef, status: 'pending' })
      .returning({ id: schema.flagItems.id });

    const result = await submitFlag(raceUserAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Joining an already-open item.',
    });

    expect(result.flagItemId).toBe(preInserted!.id);

    const items = await db.select().from(schema.flagItems).where(eq(schema.flagItems.targetRef, targetRef));
    expect(items).toHaveLength(1);
  });

  it('race: two CONCURRENT submitFlag calls for a brand-new targetRef still collapse onto ONE item (23505 re-select path)', async () => {
    const targetRef = await freshTargetRef();

    const [a, b] = await Promise.all([
      submitFlag(raceUserAId, {
        wardId: WARD_ID,
        targetType: 'candidate_field',
        targetRef,
        detail: 'First concurrent submitter.',
      }),
      submitFlag(raceUserBId, {
        wardId: WARD_ID,
        targetType: 'candidate_field',
        targetRef,
        detail: 'Second concurrent submitter.',
      }),
    ]);

    expect(a.flagItemId).toBe(b.flagItemId);

    const items = await db.select().from(schema.flagItems).where(eq(schema.flagItems.targetRef, targetRef));
    expect(items).toHaveLength(1);

    const submissions = await db
      .select()
      .from(schema.flagSubmissions)
      .where(eq(schema.flagSubmissions.flagItemId, a.flagItemId));
    expect(submissions).toHaveLength(2);
  });

  it('flag -> reject -> flag -> reject (TWO full reject cycles on the same targetRef) does not 23505 (partial index fix)', async () => {
    const targetRef = await freshTargetRef();

    const round1 = await submitFlag(submitterAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'First round concern.',
    });
    await resolveFlag({ userId: 4204, role: 'admin' }, round1.flagItemId, {
      accept: false,
      reason: 'Checked once, claim stands.',
    });

    // Second full cycle on the SAME targetRef: with the old FULL composite
    // unique index on (target_ref, status), this second reject would try
    // to insert a second (targetRef, 'rejected') row and hit an unhandled
    // 23505 — that's the bug this fix closes.
    const round2 = await submitFlag(submitterBId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Second round, raised again.',
    });
    expect(round2.flagItemId).not.toBe(round1.flagItemId);

    await expect(
      resolveFlag({ userId: 4204, role: 'admin' }, round2.flagItemId, {
        accept: false,
        reason: 'Checked again, still stands.',
      }),
    ).resolves.toBeUndefined();

    const items = await db.select().from(schema.flagItems).where(eq(schema.flagItems.targetRef, targetRef));
    expect(items).toHaveLength(2);
    const first = items.find((i) => i.id === round1.flagItemId);
    const second = items.find((i) => i.id === round2.flagItemId);
    expect(first!.status).toBe('rejected');
    expect(second!.status).toBe('rejected');
    expect(second!.resolutionReason).toBe('Checked again, still stands.');
  });

  it('double resolveFlag ACCEPT on the same item: the second call throws and does NOT publish a second time', async () => {
    const targetRef = await freshTargetRef('cases');

    const { flagItemId } = await submitFlag(submitterAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'The cases count is stale.',
    });

    const freshCandidateId = Number(targetRef.split(':')[1]);
    const fixTo = (pending: number) => ({
      accept: true as const,
      fix: { kind: 'field' as const, candidateId: freshCandidateId, data: { key: 'cases' as const, status: 'value' as const, pending, convictions: 0 }, sourceUrl: SOURCE_URL },
    });

    await resolveFlag({ userId: curatorUserId, role: 'curator' }, flagItemId, fixTo(1));

    await expect(resolveFlag({ userId: curatorUserId, role: 'curator' }, flagItemId, fixTo(9))).rejects.toThrow('flag_already_resolved');

    // The second, too-late fix wrote nothing.
    expect((await fieldRow(freshCandidateId, 'cases'))!.valueData).toEqual({ key: 'cases', status: 'value', pending: 1, convictions: 0 });

    const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, flagItemId));
    expect(item!.status).toBe('accepted');
  });

  it('resolveFlag on an already-rejected item throws and does not change state', async () => {
    const targetRef = await freshTargetRef();

    const { flagItemId } = await submitFlag(submitterAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Some concern.',
    });

    await resolveFlag({ userId: 4206, role: 'admin' }, flagItemId, {
      accept: false,
      reason: 'Verified, claim stands.',
    });

    await expect(
      resolveFlag({ userId: 4206, role: 'admin' }, flagItemId, {
        accept: false,
        reason: 'Trying to re-resolve.',
      }),
    ).rejects.toThrow('flag_already_resolved');

    const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, flagItemId));
    expect(item!.status).toBe('rejected');
    expect(item!.resolutionReason).toBe('Verified, claim stands.');
  });

  it('resolveFlag ACCEPT calls translateFieldSoon({table:"candidate_fields", id}) after the transaction commits', async () => {
    const targetRef = await freshTargetRef('education');
    const freshCandidateId = Number(targetRef.split(':')[1]);

    const { flagItemId } = await submitFlag(submitterAId, {
      targetType: 'candidate_field',
      targetRef,
      detail: 'Education needs updating.',
    });

    vi.mocked(translateFieldSoon).mockClear();

    await resolveFlag({ userId: curatorUserId, role: 'curator' }, flagItemId, {
      accept: true,
      fix: { kind: 'field', candidateId: freshCandidateId, data: { key: 'education', status: 'value', level: 'Graduate', stated: 'B.Com' }, sourceUrl: SOURCE_URL },
    });

    const field = await fieldRow(freshCandidateId, 'education');

    expect(vi.mocked(translateFieldSoon)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(translateFieldSoon)).toHaveBeenCalledWith({ table: 'candidate_fields', id: field!.id });
  });

  it('resolveFlag ACCEPT hands a field to translation only when its English text changed: a fix that reads the same keeps the Kannada it had', async () => {
    const targetRef = await freshTargetRef('education');
    const freshCandidateId = Number(targetRef.split(':')[1]);
    const fixTo = (stated: string | null) => ({
      accept: true as const,
      fix: { kind: 'field' as const, candidateId: freshCandidateId, data: { key: 'education' as const, status: 'value' as const, level: 'Graduate' as const, stated }, sourceUrl: SOURCE_URL },
    });

    // --- First accept: no row yet, so the English is new and translation fires once.
    const first = await submitFlag(submitterAId, { targetType: 'candidate_field', targetRef, detail: 'Initial concern about this field.' });
    vi.mocked(translateFieldSoon).mockClear();
    await resolveFlag({ userId: curatorUserId, role: 'curator' }, first.flagItemId, fixTo(null));
    expect(vi.mocked(translateFieldSoon)).toHaveBeenCalledTimes(1);

    // Simulate the translation having completed.
    const published = (await fieldRow(freshCandidateId, 'education'))!;
    expect(published.valueEn).toBe('Graduate');
    await db.update(schema.candidateFields).set({ valueKn: 'ಪದವೀಧರ', translationStatus: 'done' }).where(eq(schema.candidateFields.id, published.id));

    // --- Second accept: the qualification as stated repeats the level, so the
    // published English is still "Graduate" — nothing to translate again.
    const second = await submitFlag(submitterBId, { targetType: 'candidate_field', targetRef, detail: 'The affidavit states the qualification too.' });
    vi.mocked(translateFieldSoon).mockClear();
    await resolveFlag({ userId: curatorUserId, role: 'curator' }, second.flagItemId, fixTo('Graduate'));

    const field = (await fieldRow(freshCandidateId, 'education'))!;
    expect(field.valueData).toEqual({ key: 'education', status: 'value', level: 'Graduate', stated: 'Graduate' });
    expect(field.translationStatus).toBe('done');
    expect(field.valueKn).toBe('ಪದವೀಧರ');
    expect(vi.mocked(translateFieldSoon)).not.toHaveBeenCalled();

    const [secondItem] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, second.flagItemId));
    expect(secondItem!.status).toBe('accepted');
  });

  it('resolveFlag ACCEPT with a ward fix moves the candidate, accepts the item and translates nothing', async () => {
    const targetRef = await freshTargetRef('ward');
    const freshCandidateId = Number(targetRef.split(':')[1]);
    const { flagItemId } = await submitFlag(submitterAId, { targetType: 'candidate_field', targetRef, detail: 'This candidate is standing in ward B.' });

    vi.mocked(translateFieldSoon).mockClear();
    await resolveFlag({ userId: curatorUserId, role: 'curator' }, flagItemId, {
      accept: true,
      fix: { kind: 'ward', candidateId: freshCandidateId, wardId: WARD_ID_B, sourceUrl: SOURCE_URL },
    });

    const [moved] = await db.select().from(schema.candidates).where(eq(schema.candidates.id, freshCandidateId));
    expect(moved!.wardId).toBe(WARD_ID_B);
    expect((await fieldRow(freshCandidateId, 'ward'))!.aiExtracted).toBe(false);
    const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, flagItemId));
    expect(item!.status).toBe('accepted');
    expect(vi.mocked(translateFieldSoon)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Final-review Fix 1 — the flag's ward is derived from its target; curators and admins resolve city-wide.
  // -------------------------------------------------------------------------

  it('Fix 1(a): submitFlag DERIVES the ward from the target candidate, ignoring the client-supplied wardId', async () => {
    const targetRef = `candidate:${candidateBId}:cases`; // candidate B lives in WARD_ID_B

    // Client LIES about the ward (claims WARD_ID). The stored ward must be
    // the candidate's REAL ward.
    const { flagItemId } = await submitFlag(submitterAId, {
      wardId: WARD_ID, // wrong on purpose
      targetType: 'candidate_field',
      targetRef,
      detail: 'Trying to file a ward-B target into ward A\'s queue.',
    });

    const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, flagItemId));
    expect(item!.wardId).toBe(WARD_ID_B); // derived from candidate B, NOT the client's WARD_ID
  });

  it('Fix 1(a): submitFlag rejects a candidate_field target for a candidate that does not exist', async () => {
    await expect(
      submitFlag(submitterAId, {
        wardId: WARD_ID,
        targetType: 'candidate_field',
        targetRef: 'candidate:99999999:cases',
        detail: 'Nonexistent candidate.',
      }),
    ).rejects.toThrow('invalid_flag_target');
  });

  it('a curator (city-wide, no ward assignment) CAN accept/publish a flag whose target candidate is in a different ward', async () => {
    const targetRef = `candidate:${candidateBId}:age`;

    const { flagItemId } = await submitFlag(submitterAId, {
      targetType: 'candidate_field',
      targetRef,
      detail: 'Age for a ward-B candidate.',
    });

    const [itemBefore] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, flagItemId));
    expect(itemBefore!.wardId).toBe(WARD_ID_B);

    await resolveFlag({ userId: curatorUserId, role: 'curator' }, flagItemId, {
      accept: true,
      fix: { kind: 'field', candidateId: candidateBId, data: { key: 'age', status: 'value', years: 41 }, sourceUrl: SOURCE_URL },
    });

    const field = await fieldRow(candidateBId, 'age');
    expect(field!.valueData).toEqual({ key: 'age', status: 'value', years: 41 });
    expect(field!.checkedBy).toBe(curatorUserId);

    const [itemAfter] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, flagItemId));
    expect(itemAfter!.status).toBe('accepted');
  });

  it('admin CAN accept a flag in any ward', async () => {
    const targetRef = `candidate:${candidateBId}:assets`;

    const { flagItemId } = await submitFlag(submitterAId, {
      targetType: 'candidate_field',
      targetRef,
      detail: 'Assets for a ward-B candidate, resolved by an admin.',
    });

    await resolveFlag({ userId: 4299, role: 'admin' }, flagItemId, {
      accept: true,
      fix: { kind: 'field', candidateId: candidateBId, data: { key: 'assets', status: 'value', movableInr: 100000, immovableInr: 2500000 }, sourceUrl: SOURCE_URL },
    });

    const field = await fieldRow(candidateBId, 'assets');
    expect(field!.valueData).toEqual({ key: 'assets', status: 'value', movableInr: 100000, immovableInr: 2500000 });
    expect(field!.checkedBy).toBe(4299);
  });
});

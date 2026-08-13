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
// 94xxx-99202; this suite owns 99310 (and 99312 for the out-of-scope ward B).
const WARD_ID = 99310;
const WARD_ID_B = 99312; // a SECOND ward the scoped curator has NO scope over

let candidateId: number;
let candidateBId: number; // in WARD_ID_B — the out-of-scope accept target
let submitterAId: number;
let submitterBId: number;
let raceUserAId: number;
let raceUserBId: number;
// A REAL curator user scoped ONLY to WARD_ID (curator_scopes row), used by
// every curator ACCEPT below — resolveFlag now re-checks canEditWard against
// the candidate's real ward on the accept/publish path (final-review Fix 1).
let scopedCuratorId: number;

function targetRefFor(fieldKey: string): string {
  return `candidate:${candidateId}:${fieldKey}`;
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
        nameEn: 'Flags Test Ward B (out of scope)',
        nameKn: 'ಫ್ಲ್ಯಾಗ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಬಿ',
        corporation: 'south',
        zone: 'Zone F',
        boundaryRef: 'flags-test-ward-b',
      })
      .onConflictDoUpdate({ target: schema.wards.id, set: { nameEn: 'Flags Test Ward B (out of scope)' } });

    // audit_log is append-only (can't be cleaned between runs), so — like
    // tests/unit/audit.test.ts — this suite creates a fresh candidate (and
    // hence fresh targetRefs/entityIds) every run via a unique slug.
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

    // A real curator user, scoped ONLY to WARD_ID (NOT WARD_ID_B) — the
    // accept-path scope re-check reads curator_scopes via canEditWard.
    const [scopedCurator] = await db
      .insert(schema.users)
      .values({ email: `flags-test-scoped-curator-${randomUUID()}@example.com`, homeWardId: WARD_ID, role: 'curator', status: 'active' })
      .returning();
    scopedCuratorId = scopedCurator!.id;
    await db
      .insert(schema.curatorScopes)
      .values({ userId: scopedCuratorId, wardId: WARD_ID })
      .onConflictDoNothing();

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

  it('writes an audit "flag" event for every submission (moderation trail, not a publish)', async () => {
    const targetRef = targetRefFor('audit_check');

    const { flagItemId } = await submitFlag(submitterAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Track record claim looks fabricated.',
    });

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'flag'), eq(schema.auditLog.entityId, String(flagItemId))));

    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const submitRow = auditRows.find((r) => r.action === 'flag');
    expect(submitRow).toBeDefined();
    expect(submitRow!.actorRole).toBe('citizen');
    expect(submitRow!.actorUserId).toBe(submitterAId);
    expect(submitRow!.wardId).toBe(WARD_ID);
  });

  it('resolveFlag ACCEPT: publishes the candidate field AND marks the item accepted; both submitters see the same accepted status', async () => {
    const targetRef = targetRefFor('track_record');

    const first = await submitFlag(submitterAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Track record is out of date.',
      suggestedValue: 'Two-term corporator, led road-repair drive.',
      sourceUrl: 'https://example.org/track-record-source',
    });
    await submitFlag(submitterBId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Agreed, needs updating.',
    });

    await resolveFlag(
      { userId: scopedCuratorId, role: 'curator' },
      first.flagItemId,
      {
        accept: true,
        publish: {
          candidateId,
          fieldKey: 'track_record',
          valueEn: 'Two-term corporator, led road-repair drive.',
          sourceUrl: 'https://example.org/track-record-source',
          sourceType: 'curator',
          authoredLang: 'en',
        },
      },
    );

    const [field] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, 'track_record')));
    expect(field).toBeDefined();
    expect(field!.valueEn).toBe('Two-term corporator, led road-repair drive.');

    const publishAuditRows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.entityId, `${candidateId}:track_record`)));
    expect(publishAuditRows.some((r) => r.action === 'publish' && r.actorUserId === scopedCuratorId)).toBe(true);

    const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, first.flagItemId));
    expect(item!.status).toBe('accepted');
    expect(item!.resolvedBy).toBe(scopedCuratorId);
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

    const rejectAuditRows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'flag'), eq(schema.auditLog.entityId, String(first.flagItemId))));
    expect(rejectAuditRows.some((r) => r.action === 'flag_reject' && r.actorUserId === 4202)).toBe(true);

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
    const targetRef = targetRefFor('race_predetermined');

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
    const targetRef = targetRefFor('race_concurrent');

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
    const targetRef = targetRefFor('double_reject_cycle');

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
    const targetRef = targetRefFor('double_accept');

    const { flagItemId } = await submitFlag(submitterAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Approachability claim is stale.',
    });

    const publishInput = {
      candidateId,
      fieldKey: 'approachability',
      valueEn: 'Holds a weekly ward clinic.',
      sourceUrl: 'https://example.org/approachability-source',
      sourceType: 'curator' as const,
      authoredLang: 'en' as const,
    };

    await resolveFlag({ userId: scopedCuratorId, role: 'curator' }, flagItemId, { accept: true, publish: publishInput });

    const auditRowsAfterFirst = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.entityId, `${candidateId}:approachability`)));
    const publishCountAfterFirst = auditRowsAfterFirst.filter((r) => r.action === 'publish').length;
    expect(publishCountAfterFirst).toBe(1);

    await expect(
      resolveFlag({ userId: scopedCuratorId, role: 'curator' }, flagItemId, { accept: true, publish: publishInput }),
    ).rejects.toThrow('flag_already_resolved');

    const auditRowsAfterSecond = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.entityId, `${candidateId}:approachability`)));
    const publishCountAfterSecond = auditRowsAfterSecond.filter((r) => r.action === 'publish').length;
    expect(publishCountAfterSecond).toBe(publishCountAfterFirst);

    const [item] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, flagItemId));
    expect(item!.status).toBe('accepted');
  });

  it('resolveFlag on an already-rejected item throws and does not change state', async () => {
    const targetRef = targetRefFor('resolve_after_reject');

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
    const targetRef = targetRefFor('translate_parity');

    const { flagItemId } = await submitFlag(submitterAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Cases claim needs updating.',
    });

    vi.mocked(translateFieldSoon).mockClear();

    await resolveFlag(
      { userId: scopedCuratorId, role: 'curator' },
      flagItemId,
      {
        accept: true,
        publish: {
          candidateId,
          fieldKey: 'cases_translate_parity',
          valueEn: 'No pending cases as of this term.',
          sourceUrl: 'https://example.org/cases-source',
          sourceType: 'curator',
          authoredLang: 'en',
        },
      },
    );

    const [field] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, 'cases_translate_parity')));

    expect(vi.mocked(translateFieldSoon)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(translateFieldSoon)).toHaveBeenCalledWith({ table: 'candidate_fields', id: field!.id });
  });

  it('resolveFlag ACCEPT manual-suppression: normal accept fires translate once (pending); a later accept that only changes the OTHER language (authored unchanged) resolves to manual and does NOT fire translate (Fix 3, Task 40 review)', async () => {
    const targetRef = targetRefFor('manual_suppression');
    const fieldKey = 'manual_suppression_field';

    // --- First accept: brand-new field, no existing row -> decideTranslationStatus
    // returns 'pending' -> translateFieldSoon fires exactly once (normal case).
    const first = await submitFlag(submitterAId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'Initial concern about this field.',
    });

    vi.mocked(translateFieldSoon).mockClear();

    await resolveFlag(
      { userId: scopedCuratorId, role: 'curator' },
      first.flagItemId,
      {
        accept: true,
        publish: {
          candidateId,
          fieldKey,
          valueEn: 'Stable authored English text.',
          sourceUrl: 'https://example.org/manual-suppression-source',
          sourceType: 'curator',
          authoredLang: 'en',
        },
      },
    );

    expect(vi.mocked(translateFieldSoon)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(translateFieldSoon)).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'candidate_fields' }),
    );

    // Simulate MT having completed (status now 'done'), so the NEXT accept's
    // authored-unchanged / other-language-changed diff can resolve to
    // 'manual' rather than 'pending' (decideTranslationStatus, src/lib/publish.ts).
    await db
      .update(schema.candidateFields)
      .set({ valueKn: 'ಸ್ಥಿರ ಪಠ್ಯ.', translationStatus: 'done' })
      .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, fieldKey)));

    // A fresh flag on the same targetRef opens a new pending item (the first
    // is already accepted — see the dedupe test above).
    const second = await submitFlag(submitterBId, {
      wardId: WARD_ID,
      targetType: 'candidate_field',
      targetRef,
      detail: 'A curator wants to hand-fix the Kannada translation via accept.',
    });

    vi.mocked(translateFieldSoon).mockClear();

    // --- Second accept: authored value (valueEn) UNCHANGED, only valueKn
    // supplied differently -> decideTranslationStatus returns 'manual' ->
    // resolveFlag must NOT fire translateFieldSoon at all (flags.ts:~270).
    await resolveFlag(
      { userId: scopedCuratorId, role: 'curator' },
      second.flagItemId,
      {
        accept: true,
        publish: {
          candidateId,
          fieldKey,
          valueEn: 'Stable authored English text.', // authored value UNCHANGED
          valueKn: 'Curator-typed manual Kannada fix via flag accept.', // other language explicitly edited
          sourceUrl: 'https://example.org/manual-suppression-source',
          sourceType: 'curator',
          authoredLang: 'en',
        },
      },
    );

    const [field] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, fieldKey)));
    expect(field?.translationStatus).toBe('manual');
    expect(field?.valueKn).toBe('Curator-typed manual Kannada fix via flag accept.');
    expect(vi.mocked(translateFieldSoon)).not.toHaveBeenCalled();

    const [secondItem] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, second.flagItemId));
    expect(secondItem!.status).toBe('accepted');
  });

  // -------------------------------------------------------------------------
  // Final-review Fix 1 — curator ward-scope enforcement on the flag path.
  // -------------------------------------------------------------------------

  it('Fix 1(a): submitFlag DERIVES the ward from the target candidate, ignoring the client-supplied wardId', async () => {
    const targetRef = `candidate:${candidateBId}:cases`; // candidate B lives in WARD_ID_B

    // Client LIES about the ward (claims WARD_ID, the curator-A ward) — the
    // whole attack. The stored ward must be the candidate's REAL ward.
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

  it('Fix 1(b): a curator scoped ONLY to ward A cannot accept/publish a flag whose target candidate is in ward B — accept is rejected and B\'s field is unchanged', async () => {
    const targetRef = `candidate:${candidateBId}:track_record`;

    // Filed correctly under WARD_ID_B (fix 1a derives it), so ward-B's own
    // curator would see it — but scopedCuratorId has NO scope over WARD_ID_B.
    const { flagItemId } = await submitFlag(submitterAId, {
      targetType: 'candidate_field',
      targetRef,
      detail: 'Track record for a ward-B candidate.',
    });

    const [itemBefore] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, flagItemId));
    expect(itemBefore!.wardId).toBe(WARD_ID_B);

    await expect(
      resolveFlag({ userId: scopedCuratorId, role: 'curator' }, flagItemId, {
        accept: true,
        publish: {
          candidateId: candidateBId,
          fieldKey: 'track_record',
          valueEn: 'Malicious cross-ward edit that must not land.',
          sourceUrl: 'https://example.org/attacker-source',
          sourceType: 'curator',
          authoredLang: 'en',
        },
      }),
    ).rejects.toThrow('out_of_scope');

    // Candidate B's field was never written, and the item stays pending.
    const [field] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateBId), eq(schema.candidateFields.fieldKey, 'track_record')));
    expect(field).toBeUndefined();

    const [itemAfter] = await db.select().from(schema.flagItems).where(eq(schema.flagItems.id, flagItemId));
    expect(itemAfter!.status).toBe('pending');
  });

  it('Fix 1(b): admin (city-wide) CAN accept a cross-ward flag — scope re-check passes for admin', async () => {
    const targetRef = `candidate:${candidateBId}:assets`;

    const { flagItemId } = await submitFlag(submitterAId, {
      targetType: 'candidate_field',
      targetRef,
      detail: 'Assets for a ward-B candidate, resolved by an admin.',
    });

    await resolveFlag({ userId: 4299, role: 'admin' }, flagItemId, {
      accept: true,
      publish: {
        candidateId: candidateBId,
        fieldKey: 'assets',
        valueEn: 'Declared assets, admin-published.',
        sourceUrl: 'https://example.org/admin-source',
        sourceType: 'curator',
        authoredLang: 'en',
      },
    });

    const [field] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateBId), eq(schema.candidateFields.fieldKey, 'assets')));
    expect(field!.valueEn).toBe('Declared assets, admin-published.');
  });
});

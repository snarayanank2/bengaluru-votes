/**
 * Task 39 — src/lib/readiness.ts: the mechanical ward-readiness check
 * (PRD §9.1) and the curator sign-off/gate helpers built on top of it.
 *
 * READINESS RULES exercised here (PRD §9.1, exactly):
 *   - Only 'filed'/'contesting' candidates count — 'withdrawn'/'rejected'
 *     are excluded entirely (a withdrawn candidate's gaps never block the
 *     ward, and never appear in the gap list).
 *   - ZERO filed/contesting candidates -> NOT complete. This was a real
 *     prototype bug: a signed-off empty ward would send citizens to an
 *     empty report-card page. `gaps` stays empty in this case (there is no
 *     candidate to attach a gap to) — the caller distinguishes "no
 *     candidates yet" from "candidates with gaps" by checking
 *     `gaps.length === 0` alongside `complete === false`.
 *   - Missing name/party -> a gap.
 *   - Each of cases/assets/education must be EITHER populated (non-empty
 *     valueEn/valueKn) OR explicitly notDeclared=true — a field with
 *     NEITHER (no candidate_fields row at all, or a row that is neither
 *     populated nor notDeclared) is a gap.
 *   - notDeclared=true (with a source) is a COMPLETE, valid answer — not a
 *     gap.
 *   - Every PRESENT field (populated or notDeclared) must carry a source
 *     (sourceUrl non-empty) — a populated-but-sourceless field is a gap.
 *
 * SIGN-OFF: signOffWard is scope-checked (throws 'out_of_scope' for a
 * curator not covering the ward), snapshots the computed readiness, and
 * does NOT refuse on incompleteness — the curator's sign-off is a human
 * judgement layered on top of the mechanical check (design-system.md
 * §7.13: the readiness panel shows the gaps precisely so an incomplete
 * sign-off is an INFORMED judgement, not a reflex). The send-gate
 * (`isWardReadyForComms`, consumed by Task 54) is what actually enforces
 * completeness AND sign-off together.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

/** audit_log.entityId is text — filters the append-only log by the set of stringified ward ids this suite's fixtures touch. */
function auditEntityIdIn(wardIds: number[]) {
  return inArray(schema.auditLog.entityId, wardIds.map(String));
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

import { computeReadiness, signOffWard, isWardReadyForComms } from '../../src/lib/readiness';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward ids (Task 39 brief) — 99480-99499, a fresh block
// (task 36 owns 99420-99439, task 37 owns 99440-99451, task 38 owns
// 99470-99471).
const WARD_COMPLETE = {
  id: 99480,
  nameEn: 'Readiness Test Ward Complete',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎ',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-complete',
};
const WARD_MISSING_FIELD = {
  id: 99481,
  nameEn: 'Readiness Test Ward Missing Field',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಬಿ',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-missing-field',
};
const WARD_SOURCELESS = {
  id: 99482,
  nameEn: 'Readiness Test Ward Sourceless',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಸಿ',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-sourceless',
};
const WARD_NOT_DECLARED = {
  id: 99483,
  nameEn: 'Readiness Test Ward Not Declared',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಡಿ',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-not-declared',
};
const WARD_WITHDRAWN_ONLY_HAS_GAPS = {
  id: 99484,
  nameEn: 'Readiness Test Ward Withdrawn With Gaps',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಇ',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-withdrawn-gaps',
};
const WARD_EMPTY = {
  id: 99485,
  nameEn: 'Readiness Test Ward Empty',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎಫ್',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-empty',
};
const WARD_MISSING_NAME_PARTY = {
  id: 99486,
  nameEn: 'Readiness Test Ward Missing Name Party',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಜಿ',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-missing-name-party',
};
const WARD_SCOPE_IN = {
  id: 99487,
  nameEn: 'Readiness Test Ward Scope In',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎಚ್',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-scope-in',
};
const WARD_SCOPE_OUT = {
  id: 99488,
  nameEn: 'Readiness Test Ward Scope Out',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಐ',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-scope-out',
};
const WARD_GATE_INCOMPLETE_SIGNED = {
  id: 99489,
  nameEn: 'Readiness Test Ward Gate Incomplete Signed',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಜೆ',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-gate-incomplete-signed',
};
const WARD_GATE_COMPLETE_NOT_SIGNED = {
  id: 99490,
  nameEn: 'Readiness Test Ward Gate Complete Not Signed',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಕೆ',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-gate-complete-not-signed',
};
const WARD_GATE_COMPLETE_SIGNED = {
  id: 99491,
  nameEn: 'Readiness Test Ward Gate Complete Signed',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎಲ್',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-gate-complete-signed',
};
const WARD_GATE_OVERRIDE = {
  id: 99492,
  nameEn: 'Readiness Test Ward Gate Override',
  nameKn: 'ಸಿದ್ಧತೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್ ಎಮ್',
  corporation: 'south' as const,
  zone: 'Zone R',
  boundaryRef: 'readiness-test-ward-gate-override',
};

const ALL_WARDS = [
  WARD_COMPLETE,
  WARD_MISSING_FIELD,
  WARD_SOURCELESS,
  WARD_NOT_DECLARED,
  WARD_WITHDRAWN_ONLY_HAS_GAPS,
  WARD_EMPTY,
  WARD_MISSING_NAME_PARTY,
  WARD_SCOPE_IN,
  WARD_SCOPE_OUT,
  WARD_GATE_INCOMPLETE_SIGNED,
  WARD_GATE_COMPLETE_NOT_SIGNED,
  WARD_GATE_COMPLETE_SIGNED,
  WARD_GATE_OVERRIDE,
];
const ALL_WARD_IDS = ALL_WARDS.map((w) => w.id);

const EMAILS = { curator: 'readiness-test-curator@example.com' };
const SOURCE = 'https://example.org/readiness-test-source';

async function insertCandidate(
  wardId: number,
  overrides: Partial<typeof schema.candidates.$inferInsert> = {},
): Promise<number> {
  const [row] = await db
    .insert(schema.candidates)
    .values({
      slug: `readiness-test-${wardId}-${Math.random().toString(36).slice(2)}`,
      wardId,
      nameEn: 'Readiness Test Candidate',
      partyEn: 'Independent',
      status: 'contesting',
      ...overrides,
    })
    .returning({ id: schema.candidates.id });
  return row!.id;
}

async function insertField(
  candidateId: number,
  fieldKey: string,
  overrides: Partial<typeof schema.candidateFields.$inferInsert> = {},
): Promise<void> {
  await db.insert(schema.candidateFields).values({
    candidateId,
    fieldKey,
    sourceUrl: SOURCE,
    sourceType: 'curator',
    ...overrides,
  });
}

/** All three affidavit fields, populated + sourced, for a "fully complete" candidate. */
async function insertCompleteFields(candidateId: number): Promise<void> {
  await insertField(candidateId, 'cases', { valueEn: 'No pending cases.' });
  await insertField(candidateId, 'assets', { valueEn: 'Rs. 10 lakh declared.' });
  await insertField(candidateId, 'education', { valueEn: 'B.A.' });
}

async function resetFixtures(): Promise<void> {
  const candidateRows = await db
    .select({ id: schema.candidates.id })
    .from(schema.candidates)
    .where(inArray(schema.candidates.wardId, ALL_WARD_IDS));
  const candidateIds = candidateRows.map((r) => r.id);
  if (candidateIds.length > 0) {
    await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
  }
  await db.delete(schema.candidates).where(inArray(schema.candidates.wardId, ALL_WARD_IDS));
  await db.delete(schema.wardReadiness).where(inArray(schema.wardReadiness.wardId, ALL_WARD_IDS));
  await db.delete(schema.auditLog).where(auditEntityIdIn(ALL_WARD_IDS));
}

let curatorId: number;

describe('src/lib/readiness.ts (Task 39)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    for (const ward of ALL_WARDS) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }

    const [curator] = await db
      .insert(schema.users)
      .values({ email: EMAILS.curator, role: 'curator', status: 'active' })
      .onConflictDoUpdate({ target: schema.users.email, set: { role: 'curator', status: 'active' } })
      .returning({ id: schema.users.id });
    curatorId = curator!.id;

    await resetFixtures();
    await db.delete(schema.curatorScopes).where(eq(schema.curatorScopes.userId, curatorId));
    await db.insert(schema.curatorScopes).values({ userId: curatorId, wardId: WARD_SCOPE_IN.id });
  });

  afterAll(async () => {
    await resetFixtures();
    await db.delete(schema.curatorScopes).where(eq(schema.curatorScopes.userId, curatorId));
    await db.delete(schema.users).where(eq(schema.users.id, curatorId));
    await client.end();
  });

  describe('computeReadiness (PRD §9.1)', () => {
  it('two contesting candidates, all fields populated+sourced -> complete=true, gaps empty', async () => {
    const a = await insertCandidate(WARD_COMPLETE.id, { nameEn: 'Candidate A' });
    const b = await insertCandidate(WARD_COMPLETE.id, { nameEn: 'Candidate B' });
    await insertCompleteFields(a);
    await insertCompleteFields(b);

    const result = await computeReadiness(WARD_COMPLETE.id);
    expect(result.complete).toBe(true);
    expect(result.gaps).toEqual([]);
  });

  it('a candidate missing "cases" entirely -> complete=false, that candidate in gaps with "cases" in missing', async () => {
    const c = await insertCandidate(WARD_MISSING_FIELD.id, { nameEn: 'Missing Field Candidate' });
    await insertField(c, 'assets', { valueEn: 'Rs. 5 lakh.' });
    await insertField(c, 'education', { valueEn: 'B.Com.' });
    // 'cases' has NO candidate_fields row at all.

    const result = await computeReadiness(WARD_MISSING_FIELD.id);
    expect(result.complete).toBe(false);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]!.candidateId).toBe(c);
    expect(result.gaps[0]!.candidateName).toBe('Missing Field Candidate');
    expect(result.gaps[0]!.missing).toContain('cases');
  });

  it('a candidate with "assets" populated but NO source -> gap (sourceless)', async () => {
    const c = await insertCandidate(WARD_SOURCELESS.id, { nameEn: 'Sourceless Candidate' });
    await insertField(c, 'assets', { valueEn: 'Rs. 20 lakh.', sourceUrl: null });
    await insertField(c, 'cases', { valueEn: 'No cases.' });
    await insertField(c, 'education', { valueEn: 'M.A.' });

    const result = await computeReadiness(WARD_SOURCELESS.id);
    expect(result.complete).toBe(false);
    expect(result.gaps[0]!.missing).toContain('assets');
    expect(result.gaps[0]!.missing).not.toContain('cases');
    expect(result.gaps[0]!.missing).not.toContain('education');
  });

  it('a candidate with "education" notDeclared=true (with source) -> NOT a gap', async () => {
    const c = await insertCandidate(WARD_NOT_DECLARED.id, { nameEn: 'Not Declared Candidate' });
    await insertField(c, 'cases', { valueEn: 'No cases.' });
    await insertField(c, 'assets', { valueEn: 'Rs. 1 lakh.' });
    await insertField(c, 'education', { notDeclared: true, valueEn: null, valueKn: null });

    const result = await computeReadiness(WARD_NOT_DECLARED.id);
    expect(result.complete).toBe(true);
    expect(result.gaps).toEqual([]);
  });

  it('withdrawn/rejected candidates are EXCLUDED — a withdrawn candidate with gaps does not make the ward incomplete', async () => {
    const contesting = await insertCandidate(WARD_WITHDRAWN_ONLY_HAS_GAPS.id, {
      nameEn: 'Still Contesting',
      status: 'contesting',
    });
    await insertCompleteFields(contesting);

    const withdrawn = await insertCandidate(WARD_WITHDRAWN_ONLY_HAS_GAPS.id, {
      nameEn: 'Withdrew Candidate',
      status: 'withdrawn',
    });
    // withdrawn candidate has NO fields at all — would be a huge gap if counted.

    const rejected = await insertCandidate(WARD_WITHDRAWN_ONLY_HAS_GAPS.id, {
      nameEn: 'Rejected Candidate',
      status: 'rejected',
    });
    // rejected candidate also has no fields.
    void withdrawn;
    void rejected;

    const result = await computeReadiness(WARD_WITHDRAWN_ONLY_HAS_GAPS.id);
    expect(result.complete).toBe(true);
    expect(result.gaps).toEqual([]);
  });

  it('ZERO filed/contesting candidates -> complete=false (a signed-off empty ward must never happen)', async () => {
    const result = await computeReadiness(WARD_EMPTY.id);
    expect(result.complete).toBe(false);
    expect(result.gaps).toEqual([]);
  });

  it('a ward whose only candidates are withdrawn/rejected also counts as zero -> complete=false', async () => {
    await insertCandidate(WARD_EMPTY.id, { nameEn: 'Only Withdrawn', status: 'withdrawn' });
    const result = await computeReadiness(WARD_EMPTY.id);
    expect(result.complete).toBe(false);
    expect(result.gaps).toEqual([]);
  });

  it('missing name or party -> gap', async () => {
    const c = await insertCandidate(WARD_MISSING_NAME_PARTY.id, { nameEn: '   ', partyEn: '' });
    await insertCompleteFields(c);

    const result = await computeReadiness(WARD_MISSING_NAME_PARTY.id);
    expect(result.complete).toBe(false);
    expect(result.gaps[0]!.missing).toContain('name');
    expect(result.gaps[0]!.missing).toContain('party');
  });
});

  describe('signOffWard (scope + snapshot + audit)', () => {
  beforeAll(async () => {
    await db.delete(schema.curatorScopes).where(eq(schema.curatorScopes.userId, curatorId));
    await db.insert(schema.curatorScopes).values({ userId: curatorId, wardId: WARD_SCOPE_IN.id });
  });

  it('an out-of-scope curator throws out_of_scope', async () => {
    await expect(signOffWard({ userId: curatorId, role: 'curator' }, WARD_SCOPE_OUT.id)).rejects.toThrow(
      'out_of_scope',
    );
  });

  it('an in-scope curator signs off: snapshot + signedOffAt set + audit-logged, even when the ward is NOT mechanically complete', async () => {
    // WARD_SCOPE_IN has zero candidates -> mechanically incomplete. Signing
    // off anyway must succeed: the sign-off is a human judgement, not gated
    // on completeness (the gaps are shown to inform it, not block it).
    await signOffWard({ userId: curatorId, role: 'curator' }, WARD_SCOPE_IN.id);

    const [row] = await db.select().from(schema.wardReadiness).where(eq(schema.wardReadiness.wardId, WARD_SCOPE_IN.id));
    expect(row?.signedOffAt).not.toBeNull();
    expect(row?.signedOffBy).toBe(curatorId);
    expect(row?.clearedAt).toBeNull();
    expect(row?.completenessSnapshot).toMatchObject({ complete: false });

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(auditEntityIdIn([WARD_SCOPE_IN.id]));
    expect(auditRows.some((r) => r.action === 'sign_off' && r.actorUserId === curatorId)).toBe(true);
  });

  it('admin can sign off any ward regardless of scope', async () => {
    await signOffWard({ userId: 999999, role: 'admin' }, WARD_SCOPE_OUT.id);
    const [row] = await db.select().from(schema.wardReadiness).where(eq(schema.wardReadiness.wardId, WARD_SCOPE_OUT.id));
    expect(row?.signedOffAt).not.toBeNull();
  });
});

  describe('isWardReadyForComms (the send gate)', () => {
  it('complete + signed -> true', async () => {
    const c = await insertCandidate(WARD_GATE_COMPLETE_SIGNED.id, { nameEn: 'Gate Candidate' });
    await insertCompleteFields(c);
    await signOffWard({ userId: curatorId, role: 'admin' }, WARD_GATE_COMPLETE_SIGNED.id);

    expect(await isWardReadyForComms(WARD_GATE_COMPLETE_SIGNED.id)).toBe(true);
  });

  it('complete + NOT signed -> false', async () => {
    const c = await insertCandidate(WARD_GATE_COMPLETE_NOT_SIGNED.id, { nameEn: 'Gate Candidate Unsigned' });
    await insertCompleteFields(c);

    expect(await isWardReadyForComms(WARD_GATE_COMPLETE_NOT_SIGNED.id)).toBe(false);
  });

  it('incomplete + signed -> false (sign-off alone is not enough)', async () => {
    // Ward has zero candidates (incomplete) but a curator signed off anyway.
    await signOffWard({ userId: curatorId, role: 'admin' }, WARD_GATE_INCOMPLETE_SIGNED.id);

    expect(await isWardReadyForComms(WARD_GATE_INCOMPLETE_SIGNED.id)).toBe(false);
  });

  it('commsHoldOverride=true -> true regardless of completeness/sign-off', async () => {
    await db
      .insert(schema.wardReadiness)
      .values({ wardId: WARD_GATE_OVERRIDE.id, commsHoldOverride: true })
      .onConflictDoUpdate({ target: schema.wardReadiness.wardId, set: { commsHoldOverride: true } });

    expect(await isWardReadyForComms(WARD_GATE_OVERRIDE.id)).toBe(true);
  });

  it('no ward_readiness row at all -> false', async () => {
    const [row] = await db.select().from(schema.wardReadiness).where(eq(schema.wardReadiness.wardId, WARD_MISSING_FIELD.id));
    expect(row).toBeUndefined();
    expect(await isWardReadyForComms(WARD_MISSING_FIELD.id)).toBe(false);
  });
  });
});

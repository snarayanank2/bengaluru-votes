/**
 * src/lib/audit-restore.ts (Task 47; information-architecture.md §6.5;
 * architecture.md §7 "Audit ROLLBACK"; PRD §11).
 *
 * COVERAGE MAP:
 *   - RESTORE WRITES A NEW ENTRY, RESTORED VALUE LIVE, ORIGINALS UNTOUCHED
 *     (the load-bearing test): publish A then B, restore the entry that
 *     published B (whose oldValue is A) -> the field is A again, a NEW
 *     'restore' audit row is appended referencing the restored-from
 *     auditId, and BOTH original 'publish' rows are byte-identical
 *     before/after.
 *   - NOT RESTORABLE: a non-candidate_field entry (e.g. a 'ban' on a
 *     'user') and a candidate_field entry with a null oldValue (a
 *     first-ever publish) both throw 'not_restorable' — nothing published,
 *     no row appended.
 *   - translateFieldSoon RE-TRIGGERED: restoring a genuine content change
 *     fires translateFieldSoon for the restored field, same as any other
 *     publish.
 *   - APPEND-ONLY: restore only ever appends rows — never touches an
 *     existing one (covered by the load-bearing test's before/after
 *     equality check).
 *   - listAuditEntries: filters (entityType/entityId/wardId/actorUserId),
 *     pagination (limit/offset), newest-first ordering.
 *   - ADMIN-ONLY: a non-admin actor throws 'admin_only'.
 *
 * Every ward/user id here is scoped to THIS suite (Task 47 brief: "use high
 * dedicated ids") — the highest previously allocated block across the test
 * suite is 99850-99859 (tests/routes/admin-partners.test.ts); this suite
 * owns 99900-99901. audit_log is append-only across test RUNS too (can't be
 * cleaned between runs), so every test creates its OWN fresh candidate (a
 * unique slug via randomUUID) and scopes every assertion by that
 * candidate's entityId — same convention as tests/unit/audit.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/lib/translate-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/translate-runtime')>();
  return { ...actual, translateFieldSoon: vi.fn() };
});

import { translateFieldSoon } from '../../src/lib/translate-runtime';
import { publishCandidateField } from '../../src/lib/publish';
import { writeAudit } from '../../src/lib/audit';
import { restoreAuditEntry, listAuditEntries, isRestorable } from '../../src/lib/audit-restore';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 5 });
const db = drizzle(client, { schema });

const WARD_ID = 99900;
const ADMIN_EMAIL = 'audit-restore-test-admin@example.com';

let adminId: number;

async function makeCandidate(slugPrefix: string): Promise<number> {
  const [candidate] = await db
    .insert(schema.candidates)
    .values({
      slug: `${slugPrefix}-${randomUUID()}`,
      wardId: WARD_ID,
      nameEn: 'Test Candidate',
      partyEn: 'Independent',
    })
    .returning();
  return candidate!.id;
}

describe('audit log forward-write rollback (Task 47)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    await db
      .insert(schema.wards)
      .values({
        id: WARD_ID,
        nameEn: 'Audit Restore Test Ward',
        nameKn: 'ಆಡಿಟ್ ಪುನಃಸ್ಥಾಪನೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
        corporation: 'south',
        zone: 'Zone Audit Restore',
        boundaryRef: 'ward-audit-restore-test',
      })
      .onConflictDoNothing();

    const [admin] = await db
      .insert(schema.users)
      .values({ email: ADMIN_EMAIL, role: 'admin', status: 'active' })
      .onConflictDoUpdate({ target: schema.users.email, set: { role: 'admin', status: 'active' } })
      .returning();
    adminId = admin!.id;
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(() => {
    vi.mocked(translateFieldSoon).mockClear();
  });

  it('restore writes a NEW entry, the restored value is live, and the ORIGINAL entries are byte-identical / untouched', async () => {
    const candidateId = await makeCandidate('audit-restore-load-bearing');
    const fieldKey = 'track_record';
    const entityId = `${candidateId}:${fieldKey}`;

    await publishCandidateField(
      { userId: adminId, role: 'admin' },
      { candidateId, fieldKey, valueEn: 'Value A', sourceUrl: 'https://example.org/a', sourceType: 'curator', authoredLang: 'en' },
    );
    await publishCandidateField(
      { userId: adminId, role: 'admin' },
      { candidateId, fieldKey, valueEn: 'Value B', sourceUrl: 'https://example.org/b', sourceType: 'curator', authoredLang: 'en' },
    );

    const publishEntries = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.entityId, entityId), eq(schema.auditLog.action, 'publish')))
      .orderBy(schema.auditLog.id);
    expect(publishEntries.length).toBe(2);
    const [entry1, entry2] = publishEntries;
    expect((entry1!.newValue as { valueEn: string }).valueEn).toBe('Value A');
    expect((entry2!.newValue as { valueEn: string }).valueEn).toBe('Value B');
    expect(entry2!.oldValue).toEqual(entry1!.newValue);

    // Snapshot both originals verbatim, BEFORE the restore.
    const before1 = { ...entry1 };
    const before2 = { ...entry2 };

    vi.mocked(translateFieldSoon).mockClear();
    await restoreAuditEntry({ userId: adminId, role: 'admin' }, entry2!.id);

    // The restored value is LIVE.
    const [field] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, fieldKey)));
    expect(field!.valueEn).toBe('Value A');
    expect(field!.translationStatus).toBe('pending');

    // A NEW 'restore' entry was appended, referencing entry2.
    const [restoreEntry] = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.entityId, entityId), eq(schema.auditLog.action, 'restore')));
    expect(restoreEntry).toBeDefined();
    expect(restoreEntry!.actorRole).toBe('admin');
    expect(restoreEntry!.actorUserId).toBe(adminId);
    expect((restoreEntry!.newValue as { restoredFromAuditId: number }).restoredFromAuditId).toBe(entry2!.id);
    expect((restoreEntry!.newValue as { valueEn: string }).valueEn).toBe('Value A');
    expect((restoreEntry!.oldValue as { valueEn: string }).valueEn).toBe('Value B');

    // translateFieldSoon RE-TRIGGERED for the restored field.
    expect(vi.mocked(translateFieldSoon)).toHaveBeenCalledWith({ table: 'candidate_fields', id: field!.id });

    // ORIGINAL entries 1 & 2 are BYTE-IDENTICAL / untouched — history never edited.
    const [after1] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, entry1!.id));
    const [after2] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, entry2!.id));
    expect(after1).toEqual(before1);
    expect(after2).toEqual(before2);

    // APPEND-ONLY: exactly two new rows landed (publishCandidateFieldTx's
    // own 'publish' entry for the republish, plus the 'restore' entry) —
    // the two originals are still there, untouched, alongside them.
    const allForEntity = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId));
    expect(allForEntity.length).toBe(4);
    const publishCount = allForEntity.filter((r) => r.action === 'publish').length;
    const restoreCount = allForEntity.filter((r) => r.action === 'restore').length;
    expect(publishCount).toBe(3);
    expect(restoreCount).toBe(1);
  });

  it('NOT RESTORABLE: a non-candidate_field entry (e.g. a user "ban") throws, nothing published, no new row', async () => {
    const targetEntityId = `audit-restore-test-user-${randomUUID()}`;

    const banEntryId = await db.transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { userId: adminId, role: 'admin' },
        action: 'ban',
        entityType: 'user',
        entityId: targetEntityId,
        oldValue: { status: 'active' },
        newValue: { status: 'banned', reason: 'test fixture' },
      });
      const [row] = await tx.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, targetEntityId));
      return row!.id;
    });

    const before = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, targetEntityId));
    expect(before.length).toBe(1);

    await expect(restoreAuditEntry({ userId: adminId, role: 'admin' }, banEntryId)).rejects.toThrow('not_restorable');

    const after = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, targetEntityId));
    expect(after).toEqual(before);
    expect(vi.mocked(translateFieldSoon)).not.toHaveBeenCalled();
  });

  it('NOT RESTORABLE: a candidate_field entry with a null oldValue (first-ever publish) throws, nothing published, no new row', async () => {
    const candidateId = await makeCandidate('audit-restore-first-publish');
    const fieldKey = 'assets';
    const entityId = `${candidateId}:${fieldKey}`;

    await publishCandidateField(
      { userId: adminId, role: 'admin' },
      { candidateId, fieldKey, valueEn: 'Only value.', sourceUrl: null, sourceType: 'curator', authoredLang: 'en' },
    );

    const [firstEntry] = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'candidate_field'), eq(schema.auditLog.entityId, entityId)));
    expect(firstEntry!.oldValue).toBeNull();

    const before = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId));

    vi.mocked(translateFieldSoon).mockClear();
    await expect(restoreAuditEntry({ userId: adminId, role: 'admin' }, firstEntry!.id)).rejects.toThrow('not_restorable');

    const after = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId));
    expect(after).toEqual(before);

    const [field] = await db
      .select()
      .from(schema.candidateFields)
      .where(and(eq(schema.candidateFields.candidateId, candidateId), eq(schema.candidateFields.fieldKey, fieldKey)));
    expect(field!.valueEn).toBe('Only value.'); // untouched

    expect(vi.mocked(translateFieldSoon)).not.toHaveBeenCalled();
  });

  it('audit_entry_not_found: a non-existent auditId throws, nothing published', async () => {
    await expect(restoreAuditEntry({ userId: adminId, role: 'admin' }, 999_999_999)).rejects.toThrow('audit_entry_not_found');
    expect(vi.mocked(translateFieldSoon)).not.toHaveBeenCalled();
  });

  it('ADMIN-ONLY: a non-admin actor throws admin_only', async () => {
    await expect(restoreAuditEntry({ userId: adminId, role: 'curator' } as never, 1)).rejects.toThrow('admin_only');
  });

  it('isRestorable: true only for candidate_field with a non-null oldValue', () => {
    expect(isRestorable({ entityType: 'candidate_field', oldValue: { valueEn: 'x' } })).toBe(true);
    expect(isRestorable({ entityType: 'candidate_field', oldValue: null })).toBe(false);
    expect(isRestorable({ entityType: 'user', oldValue: { role: 'admin' } })).toBe(false);
  });

  describe('listAuditEntries', () => {
    it('filters by entityType/entityId/wardId/actorUserId; paginates; orders newest-first', async () => {
      const candidateId = await makeCandidate('audit-restore-list');
      const fieldKey = 'track_record';
      const entityId = `${candidateId}:${fieldKey}`;

      await publishCandidateField(
        { userId: adminId, role: 'admin' },
        { candidateId, fieldKey, valueEn: 'V1', sourceUrl: null, sourceType: 'curator', authoredLang: 'en' },
      );
      await publishCandidateField(
        { userId: adminId, role: 'admin' },
        { candidateId, fieldKey, valueEn: 'V2', sourceUrl: null, sourceType: 'curator', authoredLang: 'en' },
      );
      await publishCandidateField(
        { userId: adminId, role: 'admin' },
        { candidateId, fieldKey, valueEn: 'V3', sourceUrl: null, sourceType: 'curator', authoredLang: 'en' },
      );

      // Scoped to entityId (deterministic across repeated runs against
      // the same append-only table — see suite docstring).
      const scoped = await listAuditEntries({ entityType: 'candidate_field', entityId });
      expect(scoped.total).toBe(3);
      expect(scoped.entries.length).toBe(3);
      // Newest first.
      expect((scoped.entries[0]!.newValue as { valueEn: string }).valueEn).toBe('V3');
      expect((scoped.entries[1]!.newValue as { valueEn: string }).valueEn).toBe('V2');
      expect((scoped.entries[2]!.newValue as { valueEn: string }).valueEn).toBe('V1');

      const byWard = await listAuditEntries({ wardId: WARD_ID, entityId });
      expect(byWard.total).toBe(3);

      const byActor = await listAuditEntries({ actorUserId: adminId, entityId });
      expect(byActor.total).toBe(3);

      const wrongWard = await listAuditEntries({ wardId: WARD_ID + 123_456, entityId });
      expect(wrongWard.total).toBe(0);

      // Pagination.
      const page1 = await listAuditEntries({ entityId, limit: 2, offset: 0 });
      const page2 = await listAuditEntries({ entityId, limit: 2, offset: 2 });
      expect(page1.total).toBe(3);
      expect(page2.total).toBe(3);
      expect(page1.entries.length).toBe(2);
      expect(page2.entries.length).toBe(1);
      expect((page1.entries[0]!.newValue as { valueEn: string }).valueEn).toBe('V3');
      expect((page1.entries[1]!.newValue as { valueEn: string }).valueEn).toBe('V2');
      expect((page2.entries[0]!.newValue as { valueEn: string }).valueEn).toBe('V1');
    });
  });
});

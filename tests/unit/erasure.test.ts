/**
 * Task 45 — src/lib/erasure.ts: the DPDP erasure routine + ban/reactivate
 * user moderation behind `/admin/users` (information-architecture.md §6.3;
 * PRD §5.16, §4/§7; architecture.md §7 "Erasure (DPDP data-principal
 * rights)"). Exercises the lib functions directly against a real DB (no
 * HTTP/middleware layer — that's tests/routes/admin-users.test.ts).
 *
 * COVERAGE MAP:
 *   - ERASURE SEVERS IDENTITY, AGGREGATES SURVIVE (the load-bearing test):
 *     otp_codes + sessions deleted, users row's contact/consent nulled and
 *     status -> 'erased', homeWardId KEPT, and issue_vote_sets/selections,
 *     flag_submissions, and audit_log rows all SURVIVE untouched — the
 *     erased user's id stays as an opaque tombstone everywhere it's
 *     referenced. The erase_user audit row itself carries no PII.
 *   - IDEMPOTENT: erasing an already-erased user doesn't throw or corrupt
 *     anything.
 *   - BAN: sessions killed, readSession blocks the old cookie. REACTIVATE:
 *     restores 'active'. An erased user can never be reactivated or
 *     re-banned.
 *   - SELF / LAST-ADMIN GUARDS: mirrors src/lib/admin.ts's guard, with this
 *     module's own ban_/erase_ error codes.
 *   - ADMIN-ONLY: every mutator rejects a non-admin actor.
 *   - searchUsers: by id, by email/phone substring, empty query -> [].
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { and, eq, inArray, ne } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

import { eraseUser, banUser, reactivateUser, searchUsers, type AdminActor } from '../../src/lib/erasure';
import { createSession, readSession } from '../../src/lib/session';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ids (Task 45 brief: "use high dedicated ids").
// tests/unit/admin.test.ts owns 99600-99609/99700-99799,
// tests/routes/admin-roles.test.ts owns 99610-99619; this suite owns
// 99800-99819 (ward id + user ids are separate id spaces, but kept in the
// same numeric neighborhood for readability). tests/routes/admin-users.test.ts
// owns its own disjoint email/ward fixtures.
const WARD = {
  id: 99800,
  nameEn: 'Erasure Test Ward',
  nameKn: 'ಇ',
  corporation: 'south' as const,
  zone: 'Erasure Test Zone',
  boundaryRef: 'erasure-test-ward',
};

const EMAILS = {
  admin: 'erasure-test-admin@example.com',
  extraAdmin: 'erasure-test-extra-admin@example.com',
  bannedAdmin: 'erasure-test-banned-admin@example.com',
  bannedAdmin2: 'erasure-test-banned-admin-2@example.com',
  citizen: 'erasure-test-citizen@example.com',
  eraseTarget: 'erasure-test-erase-target@example.com',
  banTarget: 'erasure-test-ban-target@example.com',
  reactivateTarget: 'erasure-test-reactivate-target@example.com',
  banErasedTarget: 'erasure-test-ban-erased-target@example.com',
  reactivateErasedTarget: 'erasure-test-reactivate-erased-target@example.com',
  searchByEmail: 'erasure-test-search-alpha@example.com',
};
const ERASE_TARGET_PHONE = '+919900011122';
const SEARCH_PHONE = '+919900099887';

type UserInsert = typeof schema.users.$inferInsert;

async function upsertUser(email: string, fields: Partial<UserInsert> = {}): Promise<number> {
  const values: UserInsert = { email, role: 'citizen', status: 'active', ...fields };
  const [row] = await db
    .insert(schema.users)
    .values(values)
    .onConflictDoUpdate({ target: schema.users.email, set: values })
    .returning({ id: schema.users.id });
  return row!.id;
}

function auditEntityIdIn(userIds: number[]) {
  return inArray(schema.auditLog.entityId, userIds.map(String));
}

let adminId: number;
let citizenId: number;
let eraseTargetId: number;
let banTargetId: number;
let reactivateTargetId: number;
let banErasedTargetId: number;
let reactivateErasedTargetId: number;
let searchByEmailId: number;
let admin: AdminActor;
const extraFixtureIds: number[] = [];

describe('src/lib/erasure.ts (Task 45)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    await db.insert(schema.wards).values(WARD).onConflictDoUpdate({ target: schema.wards.id, set: WARD });

    adminId = await upsertUser(EMAILS.admin, { role: 'admin' });
    citizenId = await upsertUser(EMAILS.citizen);
    eraseTargetId = await upsertUser(EMAILS.eraseTarget, {
      phone: ERASE_TARGET_PHONE,
      homeWardId: WARD.id,
      srcAttribution: 'rwa-flyer',
      consentAt: new Date(),
      consentVersion: 'v1',
      futureToolsOptIn: true,
    });
    banTargetId = await upsertUser(EMAILS.banTarget);
    reactivateTargetId = await upsertUser(EMAILS.reactivateTarget, { status: 'banned' });
    banErasedTargetId = await upsertUser(EMAILS.banErasedTarget);
    reactivateErasedTargetId = await upsertUser(EMAILS.reactivateErasedTarget);
    searchByEmailId = await upsertUser(EMAILS.searchByEmail, { phone: SEARCH_PHONE, homeWardId: WARD.id });

    admin = { userId: adminId, role: 'admin' };
  });

  afterAll(async () => {
    const userIds = [
      citizenId,
      eraseTargetId,
      banTargetId,
      reactivateTargetId,
      banErasedTargetId,
      reactivateErasedTargetId,
      searchByEmailId,
      ...extraFixtureIds,
    ];
    await db.delete(schema.issueVoteSelections).where(
      inArray(
        schema.issueVoteSelections.setId,
        db.select({ id: schema.issueVoteSets.id }).from(schema.issueVoteSets).where(inArray(schema.issueVoteSets.userId, userIds)),
      ),
    );
    await db.delete(schema.issueVoteSets).where(inArray(schema.issueVoteSets.userId, userIds));
    await db.delete(schema.flagSubmissions).where(inArray(schema.flagSubmissions.userId, userIds));
    await db.delete(schema.flagItems).where(eq(schema.flagItems.wardId, WARD.id));
    await db.delete(schema.wardIssues).where(eq(schema.wardIssues.wardId, WARD.id));
    await db.delete(schema.otpCodes).where(inArray(schema.otpCodes.userId, userIds));
    await db.delete(schema.otpCodes).where(inArray(schema.otpCodes.destination, [ERASE_TARGET_PHONE, EMAILS.eraseTarget]));
    await db.delete(schema.sessions).where(inArray(schema.sessions.userId, [adminId, ...userIds]));
    await db.delete(schema.auditLog).where(auditEntityIdIn([adminId, ...userIds])); // no-op: audit_log is append-only
    await db.delete(schema.users).where(inArray(schema.users.id, [adminId, ...userIds]));
    await db.delete(schema.wards).where(eq(schema.wards.id, WARD.id));
    await client.end();
  });

  describe('eraseUser: severs identity, aggregates survive', () => {
    it('nulls contact/consent, sets status erased, deletes otp/sessions, but KEEPS votes/flags/audit', async () => {
      // Contact/consent/attribution present before erasure.
      const [before] = await db.select().from(schema.users).where(eq(schema.users.id, eraseTargetId));
      expect(before?.email).toBe(EMAILS.eraseTarget);
      expect(before?.phone).toBe(ERASE_TARGET_PHONE);

      // Session + OTP code (the 'auth' purpose has no userId — looked up by
      // destination, src/lib/otp.ts — so this specifically exercises the
      // destination-based delete).
      const { id: sessionId } = await createSession(eraseTargetId);
      await db.insert(schema.otpCodes).values({
        destination: EMAILS.eraseTarget,
        channel: 'email',
        purpose: 'auth',
        codeHash: 'deadbeef',
        expiresAt: new Date(Date.now() + 60_000),
      });

      // An issue-vote aggregate (ward-level) tied to this user.
      const [wardIssue] = await db
        .insert(schema.wardIssues)
        .values({ wardId: WARD.id, titleEn: 'Erasure test issue', authoredLang: 'en', translationStatus: 'done', position: 0 })
        .returning({ id: schema.wardIssues.id });
      const [voteSet] = await db
        .insert(schema.issueVoteSets)
        .values({ userId: eraseTargetId, wardId: WARD.id, active: true })
        .returning({ id: schema.issueVoteSets.id });
      await db.insert(schema.issueVoteSelections).values({ setId: voteSet!.id, wardIssueId: wardIssue!.id });

      // A flag submission (provenance of a contribution).
      const [flagItem] = await db
        .insert(schema.flagItems)
        .values({ wardId: WARD.id, targetType: 'ward_issue', targetRef: `ward_issue:${wardIssue!.id}`, status: 'pending' })
        .returning({ id: schema.flagItems.id });
      await db.insert(schema.flagSubmissions).values({
        flagItemId: flagItem!.id,
        userId: eraseTargetId,
        detail: 'Erasure test flag detail',
      });

      // A pre-existing audit_log row referencing this user as the actor
      // (e.g. from that flag submission) — must survive erasure unchanged.
      await db.insert(schema.auditLog).values({
        actorUserId: eraseTargetId,
        actorRole: 'citizen',
        action: 'flag_submit',
        entityType: 'flag_item',
        entityId: String(flagItem!.id),
      });

      await eraseUser(admin, eraseTargetId);

      const [after] = await db.select().from(schema.users).where(eq(schema.users.id, eraseTargetId));
      expect(after?.status).toBe('erased');
      expect(after?.email).toBeNull();
      expect(after?.phone).toBeNull();
      expect(after?.srcAttribution).toBeNull();
      expect(after?.consentAt).toBeNull();
      expect(after?.consentVersion).toBeNull();
      expect(after?.futureToolsOptIn).toBe(false);
      // KEPT: homeWardId — not contact data; keeps the vote aggregate
      // meaningful as a ward-level fact.
      expect(after?.homeWardId).toBe(WARD.id);

      // DELETED: otp_codes (both the destination-keyed 'auth' row and any
      // userId-keyed row) and sessions.
      const otpRows = await db
        .select()
        .from(schema.otpCodes)
        .where(inArray(schema.otpCodes.destination, [EMAILS.eraseTarget, ERASE_TARGET_PHONE]));
      expect(otpRows).toEqual([]);
      const sessionRows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
      expect(sessionRows).toEqual([]);

      // KEPT: the vote aggregate.
      const voteSetRows = await db.select().from(schema.issueVoteSets).where(eq(schema.issueVoteSets.id, voteSet!.id));
      expect(voteSetRows.length).toBe(1);
      expect(voteSetRows[0]?.userId).toBe(eraseTargetId);
      const selectionRows = await db
        .select()
        .from(schema.issueVoteSelections)
        .where(eq(schema.issueVoteSelections.setId, voteSet!.id));
      expect(selectionRows.length).toBe(1);

      // KEPT: the flag submission's provenance.
      const flagSubRows = await db.select().from(schema.flagSubmissions).where(eq(schema.flagSubmissions.flagItemId, flagItem!.id));
      expect(flagSubRows.length).toBe(1);
      expect(flagSubRows[0]?.userId).toBe(eraseTargetId);

      // KEPT: the pre-existing audit_log row, actorUserId unchanged (now an
      // opaque tombstone id).
      const [priorAudit] = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.action, 'flag_submit'), eq(schema.auditLog.entityId, String(flagItem!.id))));
      expect(priorAudit).toBeDefined();
      expect(priorAudit!.actorUserId).toBe(eraseTargetId);

      // The erasure ITSELF is audited, with NO PII.
      const [eraseAudit] = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.action, 'erase_user'), eq(schema.auditLog.entityId, String(eraseTargetId))));
      expect(eraseAudit).toBeDefined();
      expect(eraseAudit!.entityType).toBe('user');
      expect(eraseAudit!.actorUserId).toBe(adminId);
      expect(eraseAudit!.actorRole).toBe('admin');
      const auditJson = JSON.stringify([eraseAudit!.oldValue, eraseAudit!.newValue]);
      expect(auditJson).not.toContain(EMAILS.eraseTarget);
      expect(auditJson).not.toContain(ERASE_TARGET_PHONE);
    });

    it('is idempotent: erasing an already-erased user does not throw or change anything further', async () => {
      const [before] = await db.select().from(schema.users).where(eq(schema.users.id, eraseTargetId));
      expect(before?.status).toBe('erased');

      await expect(eraseUser(admin, eraseTargetId)).resolves.toBeUndefined();

      const [after] = await db.select().from(schema.users).where(eq(schema.users.id, eraseTargetId));
      expect(after?.status).toBe('erased');
      expect(after?.email).toBeNull();
      expect(after?.homeWardId).toBe(WARD.id);
    });

    it('rejects a non-admin actor without touching the DB', async () => {
      const citizenActor = { userId: citizenId, role: 'citizen' } as unknown as AdminActor;
      await expect(eraseUser(citizenActor, banTargetId)).rejects.toThrow();
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, banTargetId));
      expect(row?.status).toBe('active');
    });

    it('user_not_found for a non-existent id', async () => {
      await expect(eraseUser(admin, 900_000_001)).rejects.toThrow('user_not_found');
    });
  });

  describe('banUser / reactivateUser', () => {
    it('banUser sets status banned and kills the session (readSession -> null)', async () => {
      const { cookieValue } = await createSession(banTargetId);
      expect(await readSession(cookieValue)).not.toBeNull();

      await banUser(admin, banTargetId, 'spam');

      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, banTargetId));
      expect(row?.status).toBe('banned');
      expect(await readSession(cookieValue)).toBeNull();

      const [audit] = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.action, 'ban_user'), eq(schema.auditLog.entityId, String(banTargetId))));
      expect(audit).toBeDefined();
      expect(audit!.actorRole).toBe('admin');
      expect(JSON.stringify(audit!.newValue)).toContain('spam');
    });

    it('reactivateUser restores status active', async () => {
      await reactivateUser(admin, reactivateTargetId);
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, reactivateTargetId));
      expect(row?.status).toBe('active');

      const [audit] = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.action, 'reactivate_user'), eq(schema.auditLog.entityId, String(reactivateTargetId))));
      expect(audit).toBeDefined();
    });

    it('banUser rejects an erased target (cannot_ban_erased) — erasure is terminal', async () => {
      await db.update(schema.users).set({ status: 'erased' }).where(eq(schema.users.id, banErasedTargetId));
      await expect(banUser(admin, banErasedTargetId)).rejects.toThrow('cannot_ban_erased');
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, banErasedTargetId));
      expect(row?.status).toBe('erased');
    });

    it('reactivateUser rejects an erased target (cannot_reactivate_erased) — never un-erased', async () => {
      await db.update(schema.users).set({ status: 'erased' }).where(eq(schema.users.id, reactivateErasedTargetId));
      await expect(reactivateUser(admin, reactivateErasedTargetId)).rejects.toThrow('cannot_reactivate_erased');
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, reactivateErasedTargetId));
      expect(row?.status).toBe('erased');
    });

    it('rejects a non-admin actor for both banUser and reactivateUser', async () => {
      const citizenActor = { userId: citizenId, role: 'citizen' } as unknown as AdminActor;
      await expect(banUser(citizenActor, reactivateTargetId)).rejects.toThrow();
      await expect(reactivateUser(citizenActor, reactivateTargetId)).rejects.toThrow();
    });
  });

  describe('self / last-admin guards', () => {
    it('banUser: an admin banning THEMSELVES is rejected, status unchanged', async () => {
      await expect(banUser(admin, adminId)).rejects.toThrow('cannot_ban_self');
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.status).toBe('active');
    });

    it('eraseUser: an admin erasing THEMSELVES is rejected, status unchanged', async () => {
      await expect(eraseUser(admin, adminId)).rejects.toThrow('cannot_erase_self');
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.status).toBe('active');
    });

    it('banUser: banning a DIFFERENT, non-last admin succeeds', async () => {
      const extraAdminId = await upsertUser(EMAILS.extraAdmin, { role: 'admin' });
      extraFixtureIds.push(extraAdminId);

      await banUser(admin, extraAdminId);

      const [extra] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, extraAdminId));
      expect(extra?.status).toBe('banned');
      const [primary] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(primary?.status).toBe('active');
    });

    it('banUser: banning the LAST active admin is rejected by a distinct (non-self) admin-typed caller', async () => {
      const others = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.role, 'admin'), eq(schema.users.status, 'active'), ne(schema.users.id, adminId)));
      for (const row of others) {
        await db.update(schema.users).set({ role: 'citizen' }).where(eq(schema.users.id, row.id));
      }

      const bannedAdminId = await upsertUser(EMAILS.bannedAdmin, { role: 'admin', status: 'banned' });
      extraFixtureIds.push(bannedAdminId);
      const bannedActor = { userId: bannedAdminId, role: 'admin' } as unknown as AdminActor;

      await expect(banUser(bannedActor, adminId)).rejects.toThrow('cannot_ban_last_admin');
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.status).toBe('active');
    });

    it('eraseUser: erasing the LAST active admin is rejected by a distinct (non-self) admin-typed caller', async () => {
      const bannedAdminId2 = await upsertUser(EMAILS.bannedAdmin2, { role: 'admin', status: 'banned' });
      extraFixtureIds.push(bannedAdminId2);
      const bannedActor = { userId: bannedAdminId2, role: 'admin' } as unknown as AdminActor;

      await expect(eraseUser(bannedActor, adminId)).rejects.toThrow('cannot_erase_last_admin');
      const [row] = await db.select({ status: schema.users.status }).from(schema.users).where(eq(schema.users.id, adminId));
      expect(row?.status).toBe('active');
    });
  });

  describe('searchUsers', () => {
    it('returns [] for an empty/whitespace query', async () => {
      expect(await searchUsers('')).toEqual([]);
      expect(await searchUsers('   ')).toEqual([]);
    });

    it('matches by exact numeric id', async () => {
      // Scoped to this test's OWN fixture row rather than asserting the
      // result array is exactly [searchByEmailId] / reading rows[0]: per
      // searchUsers' docstring, a numeric query is unioned with substring
      // matches on email/phone BY DESIGN ("an admin typing digits gets
      // every row that could plausibly mean"), so other users elsewhere
      // in the shared test DB whose email/phone happens to contain this
      // id's digits as a substring can legitimately also match and sort
      // ahead of it — that's not a bug in searchUsers, so this assertion
      // must not depend on being the only/first match.
      const rows = await searchUsers(String(searchByEmailId));
      const row = rows.find((r) => r.id === searchByEmailId);
      expect(row).toBeDefined();
      expect(row?.homeWardNameEn).toBe(WARD.nameEn);
    });

    it('matches by email substring, case-insensitively', async () => {
      const rows = await searchUsers('SEARCH-ALPHA');
      expect(rows.some((r) => r.id === searchByEmailId)).toBe(true);
    });

    it('matches by phone substring', async () => {
      const rows = await searchUsers('99887');
      expect(rows.some((r) => r.id === searchByEmailId)).toBe(true);
    });

    it('includes a flagSubmissionCount (0 for a user with no flags)', async () => {
      // Same scoping rationale as the "matches by exact numeric id" test
      // above: find this test's own fixture row rather than assuming it's
      // rows[0] — an unrelated user elsewhere in the shared test DB whose
      // email/phone substring-matches this numeric query can legitimately
      // sort first without affecting THIS user's (correctly zero) count.
      const rows = await searchUsers(String(searchByEmailId));
      const row = rows.find((r) => r.id === searchByEmailId);
      expect(row?.flagSubmissionCount).toBe(0);
    });

    it('returns [] for no match', async () => {
      expect(await searchUsers('nobody-erasure-test-search@example.com')).toEqual([]);
    });

    it('escapes ilike wildcards: literal % in search does not match broadly', async () => {
      // Create two users: one with % in email, one without
      const userId1 = await upsertUser('search-with-percent%@example.com');
      const userId2 = await upsertUser('search-without-percent@example.com');
      extraFixtureIds.push(userId1, userId2);

      // Searching for literal '%' should only match the user with % in their email
      const results = await searchUsers('%');
      const matchedIds = results.map((r) => r.id);
      expect(matchedIds).toContain(userId1);
      expect(matchedIds).not.toContain(userId2);
    });

    it('escapes ilike wildcards: literal _ in search does not match broadly', async () => {
      // Create two users: one with _ in email, one without
      const userId1 = await upsertUser('search_with_underscore@example.com');
      const userId2 = await upsertUser('searchwithoutunderscore@example.com');
      extraFixtureIds.push(userId1, userId2);

      // Searching for literal '_' should only match the user with _ in their email
      const results = await searchUsers('_');
      const matchedIds = results.map((r) => r.id);
      expect(matchedIds).toContain(userId1);
      expect(matchedIds).not.toContain(userId2);
    });

    it('escapes ilike wildcards: literal backslash in search is handled correctly', async () => {
      // Create a user with backslash in email (unlikely but test defensively)
      const userId1 = await upsertUser('search\\backslash@example.com');
      extraFixtureIds.push(userId1);

      // Searching for literal backslash should match that user
      const results = await searchUsers('\\');
      const matchedIds = results.map((r) => r.id);
      expect(matchedIds).toContain(userId1);
    });
  });
});

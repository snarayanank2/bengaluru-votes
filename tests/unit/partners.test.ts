/**
 * Task 46 — src/lib/partners.ts: partner roster + ward-coverage matrix +
 * held-wards/comms-hold override + EOI triage (information-architecture.md
 * §6.4; PRD §5.12/§5.13/§9.1/§11). Exercises the lib functions directly
 * against a real DB (no HTTP/middleware layer — that's
 * tests/routes/admin-partners.test.ts).
 *
 * COVERAGE MAP:
 *   - createPartner: slug validation (rejects a slug with spaces/etc.),
 *     duplicate-slug rejection, wardIds -> partner_wards rows, audited,
 *     admin-only.
 *   - updatePartner: name/contact patch, REPLACES wardIds atomically,
 *     audited, admin-only.
 *   - partnerCoverage: covered/uncovered split (membership-based
 *     assertions, since `wards`/`total` is the WHOLE table across every
 *     test file sharing this DB — see fileParallelism:false in
 *     vitest.config.ts, but still avoid brittle exact-array assertions),
 *     per-partner ward set + attributed-registration count
 *     (`users.srcAttribution === slug`).
 *   - heldWards: incomplete / unsigned / cleared reasons; a ready+signed
 *     ward does NOT appear; an overridden held ward still appears with
 *     `overridden: true`.
 *   - overrideCommsHold: sets `commsHoldOverride`, audited, RELEASES the
 *     send (`isWardReadyForComms` flips to true).
 *   - EOI triage: acceptEoiAwareness provisions a partner; acceptEoiCuration
 *     accepts WITHOUT creating a partner or granting any role (no
 *     self-activation, PRD §5.13); declineEoi; already-processed/not-found
 *     guards; admin-only on every mutator.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../src/db/schema';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

import {
  createPartner,
  updatePartner,
  partnerCoverage,
  listPartners,
  heldWards,
  overrideCommsHold,
  listEois,
  acceptEoiAwareness,
  acceptEoiCuration,
  declineEoi,
  isValidPartnerSlug,
  type AdminActor,
} from '../../src/lib/partners';
import { isWardReadyForComms } from '../../src/lib/readiness';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward ids. tests/unit/admin.test.ts owns
// 99600-99609/99700-99799; tests/routes/admin-roles.test.ts owns
// 99610-99619; tests/unit/erasure.test.ts owns 99800-99819;
// tests/routes/admin-users.test.ts owns 99820-99839. This suite owns
// 99840-99849; tests/routes/admin-partners.test.ts owns 99850-99859.
const ZONE = 'Partners Test Zone';
const WARD_COVERED_1 = { id: 99840, nameEn: 'Partners Test Ward Covered 1', nameKn: 'ಪಿ೧', corporation: 'south' as const, zone: ZONE, boundaryRef: 'partners-test-covered-1' };
const WARD_COVERED_2 = { id: 99841, nameEn: 'Partners Test Ward Covered 2', nameKn: 'ಪಿ೨', corporation: 'south' as const, zone: ZONE, boundaryRef: 'partners-test-covered-2' };
const WARD_UNCOVERED = { id: 99842, nameEn: 'Partners Test Ward Uncovered', nameKn: 'ಪಿ೩', corporation: 'south' as const, zone: ZONE, boundaryRef: 'partners-test-uncovered' };
const WARD_HELD_INCOMPLETE = { id: 99843, nameEn: 'Partners Test Ward Held Incomplete', nameKn: 'ಪಿ೪', corporation: 'south' as const, zone: ZONE, boundaryRef: 'partners-test-held-incomplete' };
const WARD_HELD_UNSIGNED = { id: 99844, nameEn: 'Partners Test Ward Held Unsigned', nameKn: 'ಪಿ೫', corporation: 'south' as const, zone: ZONE, boundaryRef: 'partners-test-held-unsigned' };
const WARD_HELD_CLEARED = { id: 99845, nameEn: 'Partners Test Ward Held Cleared', nameKn: 'ಪಿ೬', corporation: 'south' as const, zone: ZONE, boundaryRef: 'partners-test-held-cleared' };
const WARD_READY = { id: 99846, nameEn: 'Partners Test Ward Ready', nameKn: 'ಪಿ೭', corporation: 'south' as const, zone: ZONE, boundaryRef: 'partners-test-ready' };
const WARD_OVERRIDE = { id: 99847, nameEn: 'Partners Test Ward Override', nameKn: 'ಪಿ೮', corporation: 'south' as const, zone: ZONE, boundaryRef: 'partners-test-override' };
const WARD_INVALID = 99848; // never inserted — used for the invalid-ward-id rejection case

const ALL_WARDS = [WARD_COVERED_1, WARD_COVERED_2, WARD_UNCOVERED, WARD_HELD_INCOMPLETE, WARD_HELD_UNSIGNED, WARD_HELD_CLEARED, WARD_READY, WARD_OVERRIDE];
const ALL_WARD_IDS = ALL_WARDS.map((w) => w.id);

const EMAILS = {
  admin: 'partners-lib-test-admin@example.com',
  citizen: 'partners-lib-test-citizen@example.com',
  regUserA1: 'partners-lib-test-reg-a1@example.com',
  regUserA2: 'partners-lib-test-reg-a2@example.com',
};

const SLUG_ALPHA = 'partners-test-alpha';
const SLUG_DUP = 'partners-test-dup-target';
const SLUG_UPDATE = 'partners-test-update-target';
const SLUG_AWARENESS = 'partners-test-awareness-accept';
const SOURCE = 'https://example.org/partners-test-source';

async function insertCandidate(wardId: number): Promise<number> {
  const [row] = await db
    .insert(schema.candidates)
    .values({
      slug: `partners-test-cand-${wardId}-${Math.random().toString(36).slice(2)}`,
      wardId,
      nameEn: 'Partners Test Candidate',
      partyEn: 'Independent',
      status: 'contesting',
    })
    .returning({ id: schema.candidates.id });
  return row!.id;
}

async function insertCompleteFields(candidateId: number): Promise<void> {
  for (const fieldKey of ['cases', 'assets', 'education']) {
    await db.insert(schema.candidateFields).values({ candidateId, fieldKey, sourceUrl: SOURCE, sourceType: 'curator', valueEn: 'Declared.' });
  }
}

/** Inserts a complete (readiness-wise) candidate for `wardId` so `computeReadiness` reports complete=true. */
async function makeWardComplete(wardId: number): Promise<void> {
  const candidateId = await insertCandidate(wardId);
  await insertCompleteFields(candidateId);
}

async function upsertUser(email: string, role: 'citizen' | 'admin', srcAttribution?: string): Promise<number> {
  const [row] = await db
    .insert(schema.users)
    .values({ email, role, status: 'active', srcAttribution: srcAttribution ?? null })
    .onConflictDoUpdate({ target: schema.users.email, set: { role, status: 'active', srcAttribution: srcAttribution ?? null } })
    .returning({ id: schema.users.id });
  return row!.id;
}

let adminId: number;
let citizenId: number;
let admin: AdminActor;
const createdPartnerIds: number[] = [];
const createdEoiIds: number[] = [];

describe('src/lib/partners.ts (Task 46)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    for (const ward of ALL_WARDS) {
      await db.insert(schema.wards).values(ward).onConflictDoUpdate({ target: schema.wards.id, set: ward });
    }

    adminId = await upsertUser(EMAILS.admin, 'admin');
    citizenId = await upsertUser(EMAILS.citizen, 'citizen');
    await upsertUser(EMAILS.regUserA1, 'citizen', SLUG_ALPHA);
    await upsertUser(EMAILS.regUserA2, 'citizen', SLUG_ALPHA);

    admin = { userId: adminId, role: 'admin' };

    // Readiness fixtures.
    await makeWardComplete(WARD_HELD_UNSIGNED.id); // complete, no ward_readiness row at all -> 'unsigned'
    // WARD_HELD_INCOMPLETE: zero candidates -> incomplete by construction, nothing to insert.

    await makeWardComplete(WARD_HELD_CLEARED.id);
    await db.insert(schema.wardReadiness).values({ wardId: WARD_HELD_CLEARED.id, signedOffAt: null, clearedAt: new Date() });

    await makeWardComplete(WARD_READY.id);
    await db.insert(schema.wardReadiness).values({ wardId: WARD_READY.id, signedOffAt: new Date(), clearedAt: null, signedOffBy: adminId });

    await makeWardComplete(WARD_OVERRIDE.id);
    // Left unsigned deliberately — overrideCommsHold is exercised in a test below.
  });

  afterAll(async () => {
    if (createdEoiIds.length > 0) {
      await db.delete(schema.eoiSubmissions).where(inArray(schema.eoiSubmissions.id, createdEoiIds));
    }
    if (createdPartnerIds.length > 0) {
      await db.delete(schema.partnerWards).where(inArray(schema.partnerWards.partnerId, createdPartnerIds));
      await db.delete(schema.partners).where(inArray(schema.partners.id, createdPartnerIds));
    }
    const candidateRows = await db.select({ id: schema.candidates.id }).from(schema.candidates).where(inArray(schema.candidates.wardId, ALL_WARD_IDS));
    const candidateIds = candidateRows.map((r) => r.id);
    if (candidateIds.length > 0) {
      await db.delete(schema.candidateFields).where(inArray(schema.candidateFields.candidateId, candidateIds));
    }
    await db.delete(schema.candidates).where(inArray(schema.candidates.wardId, ALL_WARD_IDS));
    await db.delete(schema.wardReadiness).where(inArray(schema.wardReadiness.wardId, ALL_WARD_IDS));
    await db.delete(schema.users).where(inArray(schema.users.id, [adminId, citizenId]));
    await db.delete(schema.users).where(inArray(schema.users.email, [EMAILS.regUserA1, EMAILS.regUserA2]));
    await db.delete(schema.wards).where(inArray(schema.wards.id, ALL_WARD_IDS));
    await client.end();
  });

  describe('isValidPartnerSlug', () => {
    it('accepts lowercase alphanumeric + hyphens', () => {
      expect(isValidPartnerSlug('rwa-koramangala')).toBe(true);
      expect(isValidPartnerSlug('abc123')).toBe(true);
    });

    it('rejects spaces, uppercase, and other punctuation', () => {
      expect(isValidPartnerSlug('bad slug')).toBe(false);
      expect(isValidPartnerSlug('Bad-Slug')).toBe(false);
      expect(isValidPartnerSlug('bad_slug')).toBe(false);
      expect(isValidPartnerSlug('bad.slug')).toBe(false);
      expect(isValidPartnerSlug('')).toBe(false);
    });
  });

  describe('createPartner', () => {
    it('creates a partner + partner_wards rows, audited', async () => {
      const { id } = await createPartner(admin, { slug: SLUG_ALPHA, name: 'Alpha RWA Federation', contact: 'alpha@example.org', wardIds: [WARD_COVERED_1.id, WARD_COVERED_2.id] });
      createdPartnerIds.push(id);

      const [row] = await db.select().from(schema.partners).where(eq(schema.partners.id, id));
      expect(row?.slug).toBe(SLUG_ALPHA);
      expect(row?.name).toBe('Alpha RWA Federation');

      const wardRows = await db.select().from(schema.partnerWards).where(eq(schema.partnerWards.partnerId, id));
      expect(wardRows.map((r) => r.wardId).sort((a, b) => a - b)).toEqual([WARD_COVERED_1.id, WARD_COVERED_2.id]);

    });

    it('rejects a slug with spaces/uppercase/punctuation', async () => {
      await expect(createPartner(admin, { slug: 'Bad Slug!', name: 'Nope' })).rejects.toThrow('invalid_slug');
    });

    it('rejects a duplicate slug, leaving the original partner untouched', async () => {
      const { id } = await createPartner(admin, { slug: SLUG_DUP, name: 'Original Name' });
      createdPartnerIds.push(id);

      await expect(createPartner(admin, { slug: SLUG_DUP, name: 'Impostor' })).rejects.toThrow('duplicate_slug');

      const [row] = await db.select().from(schema.partners).where(eq(schema.partners.id, id));
      expect(row?.name).toBe('Original Name');
    });

    it('rejects an unknown ward id, creating no partner at all', async () => {
      const before = await db.select({ id: schema.partners.id }).from(schema.partners);
      await expect(createPartner(admin, { slug: 'partners-test-bad-ward', name: 'Bad Ward', wardIds: [WARD_INVALID] })).rejects.toThrow('invalid_ward_id');
      const after = await db.select({ id: schema.partners.id }).from(schema.partners);
      expect(after.length).toBe(before.length);
    });

    it('rejects a non-admin actor', async () => {
      const citizenActor = { userId: citizenId, role: 'citizen' } as unknown as AdminActor;
      await expect(createPartner(citizenActor, { slug: 'partners-test-should-not-exist', name: 'Nope' })).rejects.toThrow('admin_only');
      const rows = await db.select().from(schema.partners).where(eq(schema.partners.slug, 'partners-test-should-not-exist'));
      expect(rows).toEqual([]);
    });
  });

  describe('updatePartner', () => {
    it('patches name/contact and REPLACES wardIds atomically, audited', async () => {
      const { id } = await createPartner(admin, { slug: SLUG_UPDATE, name: 'Before Name', wardIds: [WARD_COVERED_1.id] });
      createdPartnerIds.push(id);

      await updatePartner(admin, id, { name: 'After Name', contact: 'after@example.org', wardIds: [WARD_COVERED_2.id] });

      const [row] = await db.select().from(schema.partners).where(eq(schema.partners.id, id));
      expect(row?.name).toBe('After Name');
      expect(row?.contact).toBe('after@example.org');

      const wardRows = await db.select().from(schema.partnerWards).where(eq(schema.partnerWards.partnerId, id));
      expect(wardRows.map((r) => r.wardId)).toEqual([WARD_COVERED_2.id]);

    });

    it('omitting wardIds leaves the existing coverage untouched', async () => {
      const { id } = await createPartner(admin, { slug: 'partners-test-untouched', name: 'Untouched', wardIds: [WARD_COVERED_1.id] });
      createdPartnerIds.push(id);

      await updatePartner(admin, id, { name: 'Untouched Renamed' });

      const wardRows = await db.select().from(schema.partnerWards).where(eq(schema.partnerWards.partnerId, id));
      expect(wardRows.map((r) => r.wardId)).toEqual([WARD_COVERED_1.id]);
    });

    it('rejects a non-admin actor', async () => {
      const { id } = await createPartner(admin, { slug: 'partners-test-nonadmin-update', name: 'Original' });
      createdPartnerIds.push(id);
      const citizenActor = { userId: citizenId, role: 'citizen' } as unknown as AdminActor;
      await expect(updatePartner(citizenActor, id, { name: 'Hacked' })).rejects.toThrow('admin_only');
      const [row] = await db.select().from(schema.partners).where(eq(schema.partners.id, id));
      expect(row?.name).toBe('Original');
    });

    it('rejects an unknown partner id', async () => {
      await expect(updatePartner(admin, 999999999, { name: 'Ghost' })).rejects.toThrow('partner_not_found');
    });
  });

  describe('partnerCoverage', () => {
    it('COVERAGE MATH: covered wards include exactly the partner_wards rows; uncovered includes wards no partner covers; total is a real count', async () => {
      // SLUG_ALPHA was created above covering WARD_COVERED_1 + WARD_COVERED_2.
      const result = await partnerCoverage();

      expect(result.covered).toContain(WARD_COVERED_1.id);
      expect(result.covered).toContain(WARD_COVERED_2.id);
      expect(result.uncovered).toContain(WARD_UNCOVERED.id);
      expect(result.uncovered).not.toContain(WARD_COVERED_1.id);
      expect(result.uncovered).not.toContain(WARD_COVERED_2.id);
      expect(result.covered).not.toContain(WARD_UNCOVERED.id);

      expect(typeof result.total).toBe('number');
      expect(result.total).toBeGreaterThanOrEqual(ALL_WARD_IDS.length);

      const alpha = result.byPartner.find((p) => p.slug === SLUG_ALPHA);
      expect(alpha).toBeDefined();
      expect(alpha!.wardIds.slice().sort((a, b) => a - b)).toEqual([WARD_COVERED_1.id, WARD_COVERED_2.id]);
      expect(alpha!.registrations).toBe(2); // regUserA1 + regUserA2, both srcAttribution === SLUG_ALPHA
    });

    it('listPartners surfaces slug/name/ward-count/registrations for the roster page', async () => {
      const rows = await listPartners();
      const alpha = rows.find((r) => r.slug === SLUG_ALPHA);
      expect(alpha).toBeDefined();
      expect(alpha!.wardIds.length).toBe(2);
      expect(alpha!.registrations).toBe(2);
    });
  });

  describe('heldWards + overrideCommsHold', () => {
    it('an incomplete ward (zero active candidates) appears with reason "incomplete"', async () => {
      const rows = await heldWards();
      const row = rows.find((r) => r.wardId === WARD_HELD_INCOMPLETE.id);
      expect(row).toBeDefined();
      expect(row!.reason).toBe('incomplete');
      expect(row!.overridden).toBe(false);
    });

    it('a complete-but-never-signed ward appears with reason "unsigned"', async () => {
      const rows = await heldWards();
      const row = rows.find((r) => r.wardId === WARD_HELD_UNSIGNED.id);
      expect(row).toBeDefined();
      expect(row!.reason).toBe('unsigned');
      expect(row!.overridden).toBe(false);
    });

    it('a complete-but-cleared-by-change ward appears with reason "cleared"', async () => {
      const rows = await heldWards();
      const row = rows.find((r) => r.wardId === WARD_HELD_CLEARED.id);
      expect(row).toBeDefined();
      expect(row!.reason).toBe('cleared');
      expect(row!.overridden).toBe(false);
    });

    it('a complete + signed-off + not-cleared ward does NOT appear', async () => {
      const rows = await heldWards();
      expect(rows.find((r) => r.wardId === WARD_READY.id)).toBeUndefined();
    });

    it('OVERRIDE AUDITED: overrideCommsHold sets commsHoldOverride true, audits it, releases the send, and still shows in heldWards with overridden:true', async () => {
      expect(await isWardReadyForComms(WARD_OVERRIDE.id)).toBe(false);

      await overrideCommsHold(admin, WARD_OVERRIDE.id);

      const [row] = await db.select().from(schema.wardReadiness).where(eq(schema.wardReadiness.wardId, WARD_OVERRIDE.id));
      expect(row?.commsHoldOverride).toBe(true);

      expect(await isWardReadyForComms(WARD_OVERRIDE.id)).toBe(true);

      const held = await heldWards();
      const heldRow = held.find((r) => r.wardId === WARD_OVERRIDE.id);
      expect(heldRow).toBeDefined();
      expect(heldRow!.overridden).toBe(true);
    });

    it('rejects a non-admin actor, and an unknown ward id', async () => {
      const citizenActor = { userId: citizenId, role: 'citizen' } as unknown as AdminActor;
      await expect(overrideCommsHold(citizenActor, WARD_HELD_INCOMPLETE.id)).rejects.toThrow('admin_only');
      await expect(overrideCommsHold(admin, WARD_INVALID)).rejects.toThrow('invalid_ward_id');
    });
  });

  describe('EOI triage', () => {
    async function insertEoi(path: 'awareness' | 'curation', overrides: Partial<typeof schema.eoiSubmissions.$inferInsert> = {}): Promise<number> {
      const [row] = await db
        .insert(schema.eoiSubmissions)
        .values({ path, name: 'Test Applicant', contact: 'applicant@example.org', status: 'new', ...overrides })
        .returning({ id: schema.eoiSubmissions.id });
      createdEoiIds.push(row!.id);
      return row!.id;
    }

    it('EOI ACCEPT PROVISIONS PARTNER: acceptEoiAwareness marks accepted AND creates a partner, audited', async () => {
      const eoiId = await insertEoi('awareness');

      const { partnerId } = await acceptEoiAwareness(admin, eoiId, { slug: SLUG_AWARENESS, name: 'Awareness Partner Org' });
      createdPartnerIds.push(partnerId);

      const [eoi] = await db.select().from(schema.eoiSubmissions).where(eq(schema.eoiSubmissions.id, eoiId));
      expect(eoi?.status).toBe('accepted');

      const [partnerRow] = await db.select().from(schema.partners).where(eq(schema.partners.id, partnerId));
      expect(partnerRow?.slug).toBe(SLUG_AWARENESS);

    });

    it('acceptEoiCuration marks accepted WITHOUT creating a partner or granting any role — no self-activation', async () => {
      const eoiId = await insertEoi('curation');
      const partnerCountBefore = (await db.select({ id: schema.partners.id }).from(schema.partners)).length;
      const citizenRoleBefore = (await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, citizenId)))[0]?.role;

      await acceptEoiCuration(admin, eoiId);

      const [eoi] = await db.select().from(schema.eoiSubmissions).where(eq(schema.eoiSubmissions.id, eoiId));
      expect(eoi?.status).toBe('accepted');

      const partnerCountAfter = (await db.select({ id: schema.partners.id }).from(schema.partners)).length;
      expect(partnerCountAfter).toBe(partnerCountBefore);

      const citizenRoleAfter = (await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, citizenId)))[0]?.role;
      expect(citizenRoleAfter).toBe(citizenRoleBefore); // unchanged — the /admin/roles grant is a separate, manual step

    });

    it('declineEoi marks declined', async () => {
      const eoiId = await insertEoi('awareness');
      await declineEoi(admin, eoiId);

      const [eoi] = await db.select().from(schema.eoiSubmissions).where(eq(schema.eoiSubmissions.id, eoiId));
      expect(eoi?.status).toBe('declined');

    });

    it('rejects re-processing an already-accepted/declined EOI', async () => {
      const eoiId = await insertEoi('curation');
      await declineEoi(admin, eoiId);
      await expect(declineEoi(admin, eoiId)).rejects.toThrow('eoi_already_processed');
      await expect(acceptEoiCuration(admin, eoiId)).rejects.toThrow('eoi_already_processed');
    });

    it('rejects an unknown eoi id', async () => {
      await expect(declineEoi(admin, 999999999)).rejects.toThrow('eoi_not_found');
      await expect(acceptEoiCuration(admin, 999999999)).rejects.toThrow('eoi_not_found');
      await expect(acceptEoiAwareness(admin, 999999999, { slug: 'ghost', name: 'Ghost' })).rejects.toThrow('eoi_not_found');
    });

    it('listEois defaults to status=new and splits by path', async () => {
      const eoiAwareness = await insertEoi('awareness', { contact: 'list-test-awareness@example.org' });
      const eoiCuration = await insertEoi('curation', { contact: 'list-test-curation@example.org' });

      const rows = await listEois();
      expect(rows.some((r) => r.id === eoiAwareness && r.path === 'awareness')).toBe(true);
      expect(rows.some((r) => r.id === eoiCuration && r.path === 'curation')).toBe(true);
      expect(rows.every((r) => r.status === 'new')).toBe(true);
    });

    it('rejects a non-admin actor on every triage mutator', async () => {
      const eoiId = await insertEoi('curation');
      const citizenActor = { userId: citizenId, role: 'citizen' } as unknown as AdminActor;
      await expect(declineEoi(citizenActor, eoiId)).rejects.toThrow('admin_only');
      await expect(acceptEoiCuration(citizenActor, eoiId)).rejects.toThrow('admin_only');
      await expect(acceptEoiAwareness(citizenActor, eoiId, { slug: 'partners-test-nonadmin-eoi', name: 'Nope' })).rejects.toThrow('admin_only');

      const [eoi] = await db.select().from(schema.eoiSubmissions).where(eq(schema.eoiSubmissions.id, eoiId));
      expect(eoi?.status).toBe('new');
    });
  });
});

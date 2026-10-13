/**
 * Business logic behind the admin console's partners, ward-coverage,
 * and EOI triage (Task 46, information-architecture.md
 * §6.4; PRD §5.12/§5.13/§9.1/§11).
 *
 * PARTNERS ARE NOT A ROLE (PRD §5.12): a `partners` row is purely a
 * distribution/reach concept — a slug used in outbound links (`?src=` query
 * param, persisted onto `users.srcAttribution` at registration — see
 * src/lib/account-flow.ts/auth-flow.ts's registration path) and in the
 * partner kit page `/partner/{slug}` (Task 48). It carries no permissions
 * of its own and is entirely separate from `users.role`
 * (src/lib/admin.ts) — a partner is not a user account.
 *
 * TWO WORK QUEUES this module surfaces for the admin console:
 *   1. COVERAGE (`partnerCoverage`) — which of the 369 wards have >=1
 *      partner covering them, and which don't (the UNCOVERED set — the
 *      early-warning signal for central-Bengaluru distribution skew, IA
 *      §6.4). Per-partner attributed registrations let an admin see which
 *      partnerships are actually converting sign-ups.
 *   2. EOI QUEUE (`listEois` + the triage actions) — expressions of
 *      interest split by path. Accepting the 'awareness' path PROVISIONS a
 *      partner (slug + kit page). Accepting the 'curation' path does NOT
 *      grant the curator role itself — PRD §5.13 is explicit that there is
 *      NO SELF-ACTIVATION; accepting here only records admin intent, and a
 *      separate, deliberate action on `/admin/roles` (`grantRole`,
 *      src/lib/admin.ts) is what actually elevates the person. Keeping
 *      these two steps apart means an EOI acceptance alone can never grant
 *      any permission.
 *
 * ADMIN-ONLY, using the same defense-in-depth convention as
 * src/lib/admin.ts: `src/middleware.ts` already 403s any non-admin session
 * on `/admin/*`, and every mutator here re-asserts `actor.role === 'admin'`
 * anyway.
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client';
import { eoiSubmissions, partners, partnerWards, users, wards } from '../db/schema';
import { isUniqueViolation } from './db-errors';
import type { AdminActor } from './admin';

export type { AdminActor };

/** Re-asserts admin, throwing `'admin_only'` otherwise — see src/lib/admin.ts's module docstring for why every mutator repeats this check. */
function assertAdmin(actor: { role: string }): void {
  if (actor.role !== 'admin') {
    throw new Error('admin_only');
  }
}

// ---------------------------------------------------------------------------
// Partner CRUD (IA §6.4)
// ---------------------------------------------------------------------------

/**
 * URL-safe slug shape: lowercase letters/digits, hyphen-separated, no
 * leading/trailing/doubled hyphens. This slug is used verbatim in
 * `/partner/{slug}` (Task 48's kit page URL) and in the `?src={slug}`
 * attribution query param, so anything that isn't safe in a URL path
 * segment (spaces, `/`, uppercase, punctuation) is rejected outright
 * rather than silently encoded.
 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidPartnerSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/** Validates `wardIds` against the real `wards` table inside `tx` — throws `'invalid_ward_id'` for any id that doesn't exist, BEFORE any write. */
async function assertValidWardIds(tx: Tx, wardIds: number[]): Promise<void> {
  if (wardIds.length === 0) return;
  const rows = await tx.select({ id: wards.id }).from(wards).where(inArray(wards.id, wardIds));
  if (rows.length !== wardIds.length) {
    throw new Error('invalid_ward_id');
  }
}

export interface CreatePartnerInput {
  slug: string;
  name: string;
  contact?: string;
  wardIds?: number[];
}

/**
 * Creates a partner row + its initial `partner_wards` coverage set, in one
 * transaction. Throws `'invalid_slug'` for a slug that fails
 * `isValidPartnerSlug`, `'invalid_ward_id'` for any unknown ward id (the
 * whole insert is rejected — no partial partner-with-bad-wards state), and
 * `'duplicate_slug'` for a slug that collides with an existing partner
 * (the DB's own unique index is the actual guard — see
 * `src/lib/db-errors.ts`'s `isUniqueViolation` — this just gives callers a
 * friendly, recognizable error instead of a raw Postgres code).
 */
export async function createPartner(actor: AdminActor, input: CreatePartnerInput): Promise<{ id: number }> {
  assertAdmin(actor);

  const { slug, name, contact, wardIds = [] } = input;
  if (!isValidPartnerSlug(slug)) {
    throw new Error('invalid_slug');
  }
  const uniqueWardIds = [...new Set(wardIds)];

  try {
    return await db.transaction(async (tx) => {
      await assertValidWardIds(tx, uniqueWardIds);

      const [row] = await tx
        .insert(partners)
        .values({ slug, name, contact: contact ?? null })
        .returning({ id: partners.id });
      const partnerId = row!.id;

      if (uniqueWardIds.length > 0) {
        await tx.insert(partnerWards).values(uniqueWardIds.map((wardId) => ({ partnerId, wardId })));
      }

      return { id: partnerId };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error('duplicate_slug');
    }
    throw err;
  }
}

export interface UpdatePartnerInput {
  name?: string;
  contact?: string;
  wardIds?: number[];
}

/**
 * Updates `name`/`contact` (only fields actually present in `input` are
 * touched) and, if `wardIds` is given, REPLACES the partner's entire
 * `partner_wards` set (delete + insert in the same transaction —
 * replace, not merge).
 * Omitting `wardIds` entirely leaves the existing coverage untouched.
 * Audited. Throws `'partner_not_found'` / `'invalid_ward_id'`.
 */
export async function updatePartner(actor: AdminActor, partnerId: number, input: UpdatePartnerInput): Promise<void> {
  assertAdmin(actor);

  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(partners).where(eq(partners.id, partnerId));
    if (!existing) {
      throw new Error('partner_not_found');
    }

    const patch: { name?: string; contact?: string | null } = {};
    if (input.name !== undefined) patch.name = input.name;
    // An empty string clears contact to NULL (not stored as ''), so display
    // code that falls back on `contact ?? '—'` (the Partners page's roster
    // table) behaves the same whether contact was never set or was cleared.
    if (input.contact !== undefined) patch.contact = input.contact.length > 0 ? input.contact : null;
    if (Object.keys(patch).length > 0) {
      await tx.update(partners).set(patch).where(eq(partners.id, partnerId));
    }

    let newWardIds: number[] | undefined;
    if (input.wardIds !== undefined) {
      newWardIds = [...new Set(input.wardIds)];
      await assertValidWardIds(tx, newWardIds);

      await tx.delete(partnerWards).where(eq(partnerWards.partnerId, partnerId));
      if (newWardIds.length > 0) {
        await tx.insert(partnerWards).values(newWardIds.map((wardId) => ({ partnerId, wardId })));
      }
    }

  });
}

// ---------------------------------------------------------------------------
// Coverage matrix (IA §6.4)
// ---------------------------------------------------------------------------

export interface PartnerCoverageRow {
  partnerId: number;
  slug: string;
  wardIds: number[];
  /** Count of `users` whose `srcAttribution` equals this partner's slug (PRD §5.12's `?src=` attribution, persisted at registration). */
  registrations: number;
}

export interface PartnerCoverage {
  /** Ward ids covered by >=1 partner, sorted ascending. */
  covered: number[];
  /**
   * Ward ids covered by NO partner — the work queue IA §6.4 calls out as
   * the early-warning signal for central-Bengaluru distribution skew.
   */
  uncovered: number[];
  /** Total ward count — 369 in production; computed live from `wards` rather than hardcoded so this stays correct against whatever ward set is actually seeded (tests use a small dedicated set, not all 369). */
  total: number;
  byPartner: PartnerCoverageRow[];
}

/**
 * The coverage matrix: every ward's covered/uncovered status, plus every
 * partner's own ward set and attributed-registration count. Read-only.
 */
export async function partnerCoverage(): Promise<PartnerCoverage> {
  const [allWards, allPartners, allPartnerWards] = await Promise.all([
    db.select({ id: wards.id }).from(wards),
    db.select({ id: partners.id, slug: partners.slug }).from(partners),
    db.select().from(partnerWards),
  ]);

  const wardIdsByPartner = new Map<number, number[]>();
  const coveredSet = new Set<number>();
  for (const row of allPartnerWards) {
    coveredSet.add(row.wardId);
    const list = wardIdsByPartner.get(row.partnerId) ?? [];
    list.push(row.wardId);
    wardIdsByPartner.set(row.partnerId, list);
  }

  const allWardIds = allWards.map((w) => w.id);
  const covered = allWardIds.filter((id) => coveredSet.has(id)).sort((a, b) => a - b);
  const uncovered = allWardIds.filter((id) => !coveredSet.has(id)).sort((a, b) => a - b);

  const slugs = allPartners.map((p) => p.slug);
  const regCountRows = slugs.length
    ? await db
        .select({ srcAttribution: users.srcAttribution, count: sql<number>`count(*)::int` })
        .from(users)
        .where(inArray(users.srcAttribution, slugs))
        .groupBy(users.srcAttribution)
    : [];
  const regCountBySlug = new Map(regCountRows.map((r) => [r.srcAttribution, Number(r.count)]));

  const byPartner: PartnerCoverageRow[] = allPartners.map((partner) => ({
    partnerId: partner.id,
    slug: partner.slug,
    wardIds: (wardIdsByPartner.get(partner.id) ?? []).sort((a, b) => a - b),
    registrations: regCountBySlug.get(partner.slug) ?? 0,
  }));

  return { covered, uncovered, total: allWardIds.length, byPartner };
}

export interface PartnerRosterRow {
  id: number;
  slug: string;
  name: string;
  contact: string | null;
  createdAt: Date;
  wardIds: number[];
  registrations: number;
}

/** The partner roster (IA §6.4): every partner with its ward set + attributed registrations, for the admin page's list/edit forms. */
export async function listPartners(): Promise<PartnerRosterRow[]> {
  const [allPartners, coverage] = await Promise.all([db.select().from(partners).orderBy(partners.id), partnerCoverage()]);
  const coverageByPartnerId = new Map(coverage.byPartner.map((row) => [row.partnerId, row]));

  return allPartners.map((partner) => ({
    id: partner.id,
    slug: partner.slug,
    name: partner.name,
    contact: partner.contact,
    createdAt: partner.createdAt,
    wardIds: coverageByPartnerId.get(partner.id)?.wardIds ?? [],
    registrations: coverageByPartnerId.get(partner.id)?.registrations ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// EOI triage (PRD §5.13 — no self-activation)
// ---------------------------------------------------------------------------

export interface EoiRow {
  id: number;
  path: 'awareness' | 'curation';
  name: string;
  organisation: string | null;
  contact: string;
  wardsText: string | null;
  message: string | null;
  status: 'new' | 'accepted' | 'declined';
  createdAt: Date;
}

/** The EOI queue, optionally filtered by `status` (default `'new'` — the actual triage work queue; pass `undefined` for every status). Ordered oldest-first so the queue drains fairly. */
export async function listEois(status: 'new' | 'accepted' | 'declined' | undefined = 'new'): Promise<EoiRow[]> {
  const rows = status
    ? await db.select().from(eoiSubmissions).where(eq(eoiSubmissions.status, status)).orderBy(eoiSubmissions.createdAt)
    : await db.select().from(eoiSubmissions).orderBy(eoiSubmissions.createdAt);
  return rows as EoiRow[];
}

/** Loads and validates a still-pending EOI row, or throws `'eoi_not_found'` / `'eoi_already_processed'`. Shared by all three triage actions below. */
async function loadPendingEoi(tx: Tx, eoiId: number) {
  const [eoi] = await tx.select().from(eoiSubmissions).where(eq(eoiSubmissions.id, eoiId));
  if (!eoi) {
    throw new Error('eoi_not_found');
  }
  if (eoi.status !== 'new') {
    throw new Error('eoi_already_processed');
  }
  return eoi;
}

export interface AcceptEoiAwarenessInput {
  slug: string;
  name: string;
}

/**
 * Accepts an 'awareness'-path EOI and PROVISIONS a partner for it (the
 * partner slug + kit page `/partner/{slug}`, Task 48) via `createPartner`
 * — the whole point of the awareness path (IA §6.4: "accepting awareness
 * -> provisions a partner slug + kit page"). Runs as two separate
 * transactions (partner creation, then the EOI status flip) rather
 * than one nested transaction — simpler, and a failure between the two
 * leaves the EOI merely un-marked-accepted with a real partner already
 * created, which is a safe, visibly-recoverable state (an admin can
 * re-run/mark it manually) rather than a silent inconsistency.
 *
 * Throws `'eoi_not_found'` / `'eoi_already_processed'` before creating
 * anything, and whatever `createPartner` throws (`'invalid_slug'` /
 * `'duplicate_slug'` / `'invalid_ward_id'`) if partner creation itself
 * fails — in which case the EOI is left untouched (still `'new'`).
 */
export async function acceptEoiAwareness(actor: AdminActor, eoiId: number, input: AcceptEoiAwarenessInput): Promise<{ partnerId: number }> {
  assertAdmin(actor);

  const [eoi] = await db.select().from(eoiSubmissions).where(eq(eoiSubmissions.id, eoiId));
  if (!eoi) {
    throw new Error('eoi_not_found');
  }
  if (eoi.status !== 'new') {
    throw new Error('eoi_already_processed');
  }

  const { id: partnerId } = await createPartner(actor, { slug: input.slug, name: input.name });

  await db.transaction(async (tx) => {
    await tx.update(eoiSubmissions).set({ status: 'accepted' }).where(eq(eoiSubmissions.id, eoiId));
  });

  return { partnerId };
}

/**
 * Accepts a 'curation'-path EOI — marks it accepted and
 * NOTHING ELSE. Deliberately does NOT grant the curator role
 * (PRD §5.13: "no self-activation") — this only records
 * that an admin has decided this person should become a curator; the
 * actual elevation is a SEPARATE, deliberate action on `/admin/roles`
 * (`grantRole`, src/lib/admin.ts). Keeping the two steps apart means
 * accepting an EOI, by itself, can never grant any permission.
 */
export async function acceptEoiCuration(actor: AdminActor, eoiId: number): Promise<void> {
  assertAdmin(actor);

  await db.transaction(async (tx) => {
    await loadPendingEoi(tx, eoiId);
    await tx.update(eoiSubmissions).set({ status: 'accepted' }).where(eq(eoiSubmissions.id, eoiId));
  });
}

/** Declines an EOI (either path). Throws `'eoi_not_found'` / `'eoi_already_processed'`. */
export async function declineEoi(actor: AdminActor, eoiId: number): Promise<void> {
  assertAdmin(actor);

  await db.transaction(async (tx) => {
    await loadPendingEoi(tx, eoiId);
    await tx.update(eoiSubmissions).set({ status: 'declined' }).where(eq(eoiSubmissions.id, eoiId));
  });
}

/**
 * src/lib/news.ts — candidate news links (Task 38; PRD §5.2; architecture
 * §7). Lib-level coverage: write-time http(s) validation, curator-added
 * (direct-approved) vs. auto-suggested lifecycles, the unique-url
 * collision, the approve audit trail, and — the load-bearing test —
 * `listNewsLinks({ approvedOnly: true })` structurally excluding a
 * `suggested` row. This is the DATA boundary the public report card
 * (Task 42) relies on; it is proven here at the lib level and re-asserted
 * at the route level in tests/routes/news-links.test.ts.
 *
 * Route-level coverage (curator scope 403, CSRF, editor wiring) lives in
 * tests/routes/news-links.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';
import { addNewsLink, approveNewsLink, listNewsLinks } from '../../src/lib/news';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward id (Task 38 brief) — the route suite
// (tests/routes/news-links.test.ts) owns 99470-99471; this lib-level suite
// owns 99460.
const WARD_ID = 99460;

const CURATOR_ACTOR = { userId: 88460, role: 'curator' as const };

let candidateId: number;

describe('news.ts — candidate news links (Task 38)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    await db
      .insert(schema.wards)
      .values({
        id: WARD_ID,
        nameEn: 'News Links Test Ward',
        nameKn: 'ಸುದ್ದಿ ಲಿಂಕ್ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
        corporation: 'south',
        zone: 'Zone N',
        boundaryRef: 'news-links-test-ward',
      })
      .onConflictDoUpdate({ target: schema.wards.id, set: { nameEn: 'News Links Test Ward' } });

    // audit_log is append-only (can't be cleaned between runs), so — like
    // tests/unit/audit.test.ts / tests/unit/flags.test.ts — this suite
    // creates a fresh candidate (and hence fresh entityIds) every run via a
    // unique slug.
    const [candidate] = await db
      .insert(schema.candidates)
      .values({
        slug: `news-links-test-candidate-${randomUUID()}`,
        wardId: WARD_ID,
        nameEn: 'News Links Test Candidate',
        partyEn: 'Independent',
      })
      .returning();
    candidateId = candidate!.id;
  });

  afterAll(async () => {
    await client.end();
  });

  it('addNewsLink: an http(s) url inserts status "approved", origin "curator", derived domain, and writes an audit row', async () => {
    const url = `https://news.example.org/story-${randomUUID()}`;
    const { id } = await addNewsLink(CURATOR_ACTOR, candidateId, url, 'A neutral news story');

    const [row] = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.id, id));
    expect(row).toBeDefined();
    expect(row!.candidateId).toBe(candidateId);
    expect(row!.url).toBe(url);
    expect(row!.title).toBe('A neutral news story');
    expect(row!.domain).toBe('news.example.org');
    expect(row!.origin).toBe('curator');
    expect(row!.status).toBe('approved');
    expect(row!.approvedBy).toBe(CURATOR_ACTOR.userId);

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'candidate_news_link'), eq(schema.auditLog.entityId, String(id))));
    const addRow = auditRows.find((r) => r.action === 'news_link_add');
    expect(addRow).toBeDefined();
    expect(addRow!.actorUserId).toBe(CURATOR_ACTOR.userId);
    expect(addRow!.actorRole).toBe('curator');
    expect(addRow!.wardId).toBe(WARD_ID);
  });

  it('addNewsLink: a javascript: url throws "invalid_url" and inserts nothing', async () => {
    const before = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateId));

    await expect(addNewsLink(CURATOR_ACTOR, candidateId, 'javascript:alert(1)', 'Evil link')).rejects.toThrow('invalid_url');

    const after = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateId));
    expect(after.length).toBe(before.length);
  });

  it('addNewsLink: a data: url throws "invalid_url" and inserts nothing', async () => {
    const before = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateId));

    await expect(
      addNewsLink(CURATOR_ACTOR, candidateId, 'data:text/html,<script>alert(1)</script>', 'Evil link'),
    ).rejects.toThrow('invalid_url');

    const after = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateId));
    expect(after.length).toBe(before.length);
  });

  it('addNewsLink: an empty title throws "title_required" and inserts nothing', async () => {
    const url = `https://news.example.org/story-${randomUUID()}`;
    const before = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateId));

    await expect(addNewsLink(CURATOR_ACTOR, candidateId, url, '   ')).rejects.toThrow('title_required');

    const after = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateId));
    expect(after.length).toBe(before.length);
  });

  it('addNewsLink: a duplicate (candidateId, url) throws "duplicate_url"', async () => {
    const url = `https://news.example.org/story-${randomUUID()}`;
    await addNewsLink(CURATOR_ACTOR, candidateId, url, 'First add');

    await expect(addNewsLink(CURATOR_ACTOR, candidateId, url, 'Second add, same url')).rejects.toThrow('duplicate_url');

    const rows = await db
      .select()
      .from(schema.candidateNewsLinks)
      .where(and(eq(schema.candidateNewsLinks.candidateId, candidateId), eq(schema.candidateNewsLinks.url, url)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('First add');
  });

  it('approveNewsLink: flips a "suggested" link to "approved", sets approvedBy, writes an audit row', async () => {
    const url = `https://auto-suggested.example.org/story-${randomUUID()}`;
    const [suggested] = await db
      .insert(schema.candidateNewsLinks)
      .values({
        candidateId,
        url,
        title: 'Auto-suggested story',
        domain: 'auto-suggested.example.org',
        origin: 'auto',
        status: 'suggested',
      })
      .returning();

    await approveNewsLink(CURATOR_ACTOR, suggested!.id);

    const [after] = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.id, suggested!.id));
    expect(after!.status).toBe('approved');
    expect(after!.approvedBy).toBe(CURATOR_ACTOR.userId);

    const auditRows = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, 'candidate_news_link'), eq(schema.auditLog.entityId, String(suggested!.id))));
    const approveRow = auditRows.find((r) => r.action === 'news_link_approve');
    expect(approveRow).toBeDefined();
    expect(approveRow!.actorUserId).toBe(CURATOR_ACTOR.userId);
    expect(approveRow!.wardId).toBe(WARD_ID);
  });

  it('approveNewsLink: re-approving an already-approved link is an idempotent no-op', async () => {
    const url = `https://auto-suggested.example.org/story-${randomUUID()}`;
    const [suggested] = await db
      .insert(schema.candidateNewsLinks)
      .values({
        candidateId,
        url,
        title: 'Auto-suggested story two',
        domain: 'auto-suggested.example.org',
        origin: 'auto',
        status: 'suggested',
      })
      .returning();

    await approveNewsLink(CURATOR_ACTOR, suggested!.id);
    await expect(approveNewsLink({ userId: 88461, role: 'curator' }, suggested!.id)).resolves.toBeUndefined();

    const [after] = await db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.id, suggested!.id));
    expect(after!.status).toBe('approved');
    // approvedBy stays the FIRST approver — a no-op re-approve must not
    // overwrite the accountable curator with whoever double-clicked later.
    expect(after!.approvedBy).toBe(CURATOR_ACTOR.userId);
  });

  it('listNewsLinks default returns BOTH suggested and approved links', async () => {
    const suffix = randomUUID();
    const [approved] = await db
      .insert(schema.candidateNewsLinks)
      .values({
        candidateId,
        url: `https://list-default.example.org/approved-${suffix}`,
        title: 'Approved story',
        domain: 'list-default.example.org',
        origin: 'curator',
        status: 'approved',
        approvedBy: CURATOR_ACTOR.userId,
      })
      .returning();
    const [suggested] = await db
      .insert(schema.candidateNewsLinks)
      .values({
        candidateId,
        url: `https://list-default.example.org/suggested-${suffix}`,
        title: 'Suggested story',
        domain: 'list-default.example.org',
        origin: 'auto',
        status: 'suggested',
      })
      .returning();

    const all = await listNewsLinks(candidateId);
    const ids = all.map((l) => l.id);
    expect(ids).toContain(approved!.id);
    expect(ids).toContain(suggested!.id);
  });

  it('THE PUBLIC GUARD: listNewsLinks({ approvedOnly: true }) returns ONLY the approved link — the suggested link/url/title never appears', async () => {
    const suffix = randomUUID();
    const approvedUrl = `https://public-guard.example.org/approved-${suffix}`;
    const suggestedUrl = `https://public-guard.example.org/suggested-${suffix}`;

    const [approved] = await db
      .insert(schema.candidateNewsLinks)
      .values({
        candidateId,
        url: approvedUrl,
        title: 'Public guard approved story',
        domain: 'public-guard.example.org',
        origin: 'curator',
        status: 'approved',
        approvedBy: CURATOR_ACTOR.userId,
      })
      .returning();
    const [suggested] = await db
      .insert(schema.candidateNewsLinks)
      .values({
        candidateId,
        url: suggestedUrl,
        title: 'Public guard suggested story — must stay curator-only',
        domain: 'public-guard.example.org',
        origin: 'auto',
        status: 'suggested',
      })
      .returning();

    const publicView = await listNewsLinks(candidateId, { approvedOnly: true });
    const publicIds = publicView.map((l) => l.id);
    const publicUrls = publicView.map((l) => l.url);
    const publicTitles = publicView.map((l) => l.title);

    expect(publicIds).toContain(approved!.id);
    expect(publicIds).not.toContain(suggested!.id);
    expect(publicUrls).not.toContain(suggestedUrl);
    expect(publicTitles).not.toContain('Public guard suggested story — must stay curator-only');
    expect(publicView.every((l) => l.status === 'approved')).toBe(true);
  });
});

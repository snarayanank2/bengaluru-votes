/**
 * src/lib/news-suggest.ts — the news-link suggestion pipeline (Task 55;
 * PRD §5.2; architecture §7). Proves the three load-bearing guarantees
 * the module docstring promises:
 *   1. the domain allowlist is enforced, including the anchored-suffix
 *      attack cases (`notthehindu.com`, `thehindu.com.evil.com`) —
 *      neither may be accepted as `thehindu.com`;
 *   2. the injected `search` function is the ONLY network-shaped call —
 *      nothing ever fetches an article page;
 *   3. `consumeBudget('news_query', ...)` is consulted before every
 *      query, and a budget of 0 stops the whole run before any query or
 *      store happens.
 * Plus a dedupe regression (re-running never duplicates a stored link).
 *
 * SCOPING NOTE: `suggestNews` iterates every filed/contesting candidate
 * in the WHOLE `candidates` table (by design — there is no ward/candidate
 * filter param), and this suite shares one Postgres database with every
 * other test file (vitest.config.ts: `fileParallelism: false`). To stay
 * "scoped so you don't clobber other suites" despite that, the injected
 * `search` below is QUERY-AWARE: it returns real results only for a query
 * containing this file's own distinctively-named fixture candidate, and
 * `[]` for every other candidate's query (other suites' fixture
 * candidates included) — so this suite never writes rows into another
 * suite's candidate. Budget-exhaustion assertions use `budgetLimit: 0`,
 * which fails on the very FIRST `consumeBudget` call regardless of which
 * candidate happens to be processed first, so they don't depend on how
 * many other active candidates already exist in the shared DB.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as schema from '../../src/db/schema';
import { suggestNews, isAllowedDomain, type NewsSearchResult } from '../../src/lib/news-suggest';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a Postgres database of their ' +
      'own — see CLAUDE.md ("Tests need a database") for how to get one.',
  );
}

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });

// High, task-specific ward id — distinct from every other suite's fixture
// range (see this file's module docstring; news.test.ts owns 99460).
const WARD_ID = 99550;

const ALLOWLIST = ['thehindu.com', 'deccanherald.com'];

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

let candidateId: number;
let candidateNameEn: string;

/** Builds a search fn that only "sees" this suite's own fixture candidate — see module docstring's SCOPING NOTE. */
function scopedSearch(results: NewsSearchResult[]) {
  return vi.fn(async (query: string): Promise<NewsSearchResult[]> => {
    return query.includes(candidateNameEn) ? results : [];
  });
}

async function resetBudget(): Promise<void> {
  await db
    .delete(schema.budgetCounters)
    .where(and(eq(schema.budgetCounters.day, todayUtc()), eq(schema.budgetCounters.kind, 'news_query')));
}

async function ownRows() {
  return db.select().from(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateId));
}

describe('suggestNews (Task 55)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });

    await db
      .insert(schema.wards)
      .values({
        id: WARD_ID,
        nameEn: 'News Suggest Test Ward',
        nameKn: 'ಸುದ್ದಿ ಸಲಹೆ ಪರೀಕ್ಷಾ ವಾರ್ಡ್',
        corporation: 'south',
        zone: 'Zone NS',
        boundaryRef: 'news-suggest-test-ward',
      })
      .onConflictDoUpdate({ target: schema.wards.id, set: { nameEn: 'News Suggest Test Ward' } });

    candidateNameEn = `News Suggest Test Candidate ${randomUUID()}`;
    const [candidate] = await db
      .insert(schema.candidates)
      .values({
        slug: `news-suggest-test-candidate-${randomUUID()}`,
        wardId: WARD_ID,
        nameEn: candidateNameEn,
        partyEn: 'Independent',
        status: 'contesting',
      })
      .returning();
    candidateId = candidate!.id;
  });

  afterAll(async () => {
    await db.delete(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateId));
    await resetBudget();
    await client.end();
  });

  beforeEach(async () => {
    await resetBudget();
    await db.delete(schema.candidateNewsLinks).where(eq(schema.candidateNewsLinks.candidateId, candidateId));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps only allowlisted domains — including rejecting anchored-suffix lookalikes', async () => {
    const search = scopedSearch([
      { title: 'Real story', link: `https://www.thehindu.com/news/story-${randomUUID()}.html` },
      { title: 'Another real story', link: `https://deccanherald.com/state/story-${randomUUID()}` },
      { title: 'Off-allowlist blog', link: `https://random-blog.example.com/post-${randomUUID()}` },
      // Anchored-suffix attacks: neither may be accepted as thehindu.com.
      { title: 'Lookalike domain (prefix trick)', link: `https://notthehindu.com/fake-${randomUUID()}` },
      { title: 'Lookalike domain (suffix trick)', link: `https://thehindu.com.evil.com/fake-${randomUUID()}` },
    ]);

    await suggestNews({ search, allowlist: ALLOWLIST, budgetLimit: 100_000 });

    const rows = await ownRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.domain).sort()).toEqual(['deccanherald.com', 'thehindu.com']);
    expect(rows.every((r) => r.origin === 'auto' && r.status === 'suggested')).toBe(true);
  });

  it('makes no network call other than the injected search — never fetches the article page', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const search = scopedSearch([{ title: 'Real story', link: `https://www.thehindu.com/story-${randomUUID()}` }]);

    const summary = await suggestNews({ search, allowlist: ALLOWLIST, budgetLimit: 100_000 });

    expect(fetchSpy).not.toHaveBeenCalled();
    // search itself was invoked exactly once per query the run made —
    // i.e. every query this run performed went through the injected fn,
    // never a bare fetch.
    expect(search.mock.calls.length).toBe(summary.queriesRun);

    const rows = await ownRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.domain).toBe('thehindu.com');
  });

  it('respects the daily budget: a budget already at 0 stops the run before any query or store', async () => {
    const search = scopedSearch([{ title: 'Should never be stored', link: `https://www.thehindu.com/x-${randomUUID()}` }]);

    const summary = await suggestNews({ search, allowlist: ALLOWLIST, budgetLimit: 0 });

    expect(summary.budgetExhausted).toBe(true);
    expect(summary.queriesRun).toBe(0);
    expect(summary.resultsInserted).toBe(0);
    expect(search).not.toHaveBeenCalled();

    const rows = await ownRows();
    expect(rows).toHaveLength(0);
  });

  it('dedupes on re-run: the same (candidate, url) is never inserted twice', async () => {
    const fixedUrl = `https://www.thehindu.com/dedupe-${randomUUID()}`;
    const search = scopedSearch([{ title: 'Dedupe test story', link: fixedUrl }]);

    const first = await suggestNews({ search, allowlist: ALLOWLIST, budgetLimit: 100_000 });
    expect(first.resultsInserted).toBe(1);
    expect(await ownRows()).toHaveLength(1);

    const second = await suggestNews({ search, allowlist: ALLOWLIST, budgetLimit: 100_000 });
    expect(second.resultsInserted).toBe(0); // onConflictDoNothing — already present
    expect(await ownRows()).toHaveLength(1); // still just one row, not two
  });
});

describe('isAllowedDomain (Task 55) — anchored suffix match', () => {
  const allowlist = ['thehindu.com', 'deccanherald.com'];

  it('accepts an exact allowlisted domain', () => {
    expect(isAllowedDomain('thehindu.com', allowlist)).toBe(true);
  });

  it('accepts a genuine dot-anchored subdomain', () => {
    expect(isAllowedDomain('epaper.thehindu.com', allowlist)).toBe(true);
  });

  it('rejects a prefix lookalike', () => {
    expect(isAllowedDomain('notthehindu.com', allowlist)).toBe(false);
  });

  it('rejects a suffix-trick lookalike', () => {
    expect(isAllowedDomain('thehindu.com.evil.com', allowlist)).toBe(false);
  });

  it('rejects an unrelated domain', () => {
    expect(isAllowedDomain('random-blog.example.com', allowlist)).toBe(false);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/db/schema';
import { and, eq, like } from 'drizzle-orm';
import { ANONYMOUS_VOTE_COOKIE } from '../../src/lib/anonymous-votes';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; see AGENTS.md');
const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client, { schema });
const WARD_ID = 99331;
let issueIds: number[] = [];

vi.mock('../../src/lib/recaptcha', () => ({ verifyRecaptcha: vi.fn() }));
vi.mock('../../src/lib/budgets', () => ({ consumeBudget: vi.fn() }));
import { verifyRecaptcha } from '../../src/lib/recaptcha';
import { consumeBudget } from '../../src/lib/budgets';
import { GET, PUT } from '../../src/pages/api/issue-votes';

function jar(token?: string) {
  let value = token;
  return {
    get: vi.fn((name: string) => name === ANONYMOUS_VOTE_COOKIE && value ? { value } : undefined),
    set: vi.fn((_name: string, next: string) => { value = next; }),
    token: () => value,
  };
}
function put(cookies: ReturnType<typeof jar>, body: unknown) {
  return PUT({ request: new Request('http://localhost/api/issue-votes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), cookies } as any);
}
function get(cookies: ReturnType<typeof jar>, suffix = '') {
  return GET({ url: new URL(`http://localhost/api/issue-votes?wardId=${WARD_ID}${suffix}`), cookies } as any);
}

describe('anonymous issue vote API', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: './drizzle' });
    await db.insert(schema.wards).values({ id: WARD_ID, nameEn: 'Vote Test Ward', nameKn: 'ಮತ ಪರೀಕ್ಷಾ ವಾರ್ಡ್', corporation: 'south', zone: 'Test', boundaryRef: 'vote-test' }).onConflictDoNothing();
    const rows = await db.insert(schema.wardIssues).values([1, 2, 3, 4].map((position) => ({ wardId: WARD_ID, catalogKey: `route-test-${position}`, titleEn: `Issue ${position}`, titleKn: `ಸಮಸ್ಯೆ ${position}`, position, translationStatus: 'done' as const }))).onConflictDoNothing().returning({ id: schema.wardIssues.id });
    issueIds = rows.length ? rows.map((r) => r.id) : (await db.select({ id: schema.wardIssues.id }).from(schema.wardIssues).where(and(eq(schema.wardIssues.wardId, WARD_ID), like(schema.wardIssues.catalogKey, 'route-test-%')))).map((r) => r.id);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyRecaptcha).mockResolvedValue({ ok: true, score: 0.9 });
    vi.mocked(consumeBudget).mockResolvedValue(true);
  });
  afterAll(() => client.end());

  it('accepts an anonymous exactly-three vote and sets an opaque HttpOnly receipt', async () => {
    const cookies = jar();
    const res = await put(cookies, { wardId: WARD_ID, issueIds: issueIds.slice(0, 3), recaptchaToken: 'captcha' });
    expect(res.status).toBe(200);
    expect(cookies.set).toHaveBeenCalledWith(ANONYMOUS_VOTE_COOKIE, expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/' }));
    expect(verifyRecaptcha).toHaveBeenCalledWith('captcha', { expectedAction: 'issue_vote' });
  });

  it('rejects duplicate or non-three selections before CAPTCHA', async () => {
    const res = await put(jar(), { wardId: WARD_ID, issueIds: [issueIds[0], issueIds[0], issueIds[1]], recaptchaToken: 'captcha' });
    expect(res.status).toBe(400);
    expect(verifyRecaptcha).not.toHaveBeenCalled();
  });

  it('fails closed when CAPTCHA fails and when the daily circuit breaker is exhausted', async () => {
    vi.mocked(verifyRecaptcha).mockResolvedValueOnce({ ok: false, reason: 'wrong_action' });
    expect((await put(jar(), { wardId: WARD_ID, issueIds: issueIds.slice(0, 3), recaptchaToken: 'bad' })).status).toBe(403);
    vi.mocked(consumeBudget).mockResolvedValueOnce(false);
    expect((await put(jar(), { wardId: WARD_ID, issueIds: issueIds.slice(0, 3), recaptchaToken: 'captcha' })).status).toBe(429);
  });

  it('does not reveal results before voting; reveals descending counts and percentages afterward', async () => {
    const cookies = jar();
    expect((await get(cookies, '&results=1')).status).toBe(403);
    await put(cookies, { wardId: WARD_ID, issueIds: issueIds.slice(0, 3), recaptchaToken: 'captcha' });
    const status = await get(cookies);
    expect(await status.json()).toEqual({ status: 'voted_here' });
    const resultsRes = await get(cookies, '&results=1');
    expect(resultsRes.status).toBe(200);
    const body = await resultsRes.json() as any;
    expect(body.results[0]).toEqual(expect.objectContaining({ count: expect.any(Number), sharePct: expect.any(Number) }));
    expect(body.results.map((r: any) => r.count)).toEqual([...body.results.map((r: any) => r.count)].sort((a, b) => b - a));
  });

  it('prevents a second ballot from the same receipt', async () => {
    const cookies = jar();
    expect((await put(cookies, { wardId: WARD_ID, issueIds: issueIds.slice(0, 3), recaptchaToken: 'captcha' })).status).toBe(200);
    expect((await put(cookies, { wardId: WARD_ID, issueIds: issueIds.slice(1, 4), recaptchaToken: 'captcha' })).status).toBe(409);
  });
});

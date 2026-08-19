/** Anonymous, one-browser, one-ward top-three issue voting. */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  ANONYMOUS_VOTE_COOKIE,
  ANONYMOUS_VOTE_COOKIE_MAX_AGE,
  anonymousIssueResults,
  anonymousVoteStatus,
  castAnonymousVote,
  newAnonymousVoteToken,
  type AnonymousVoteErrorCode,
} from '../../lib/anonymous-votes';
import { consumeBudget } from '../../lib/budgets';
import { verifyRecaptcha } from '../../lib/recaptcha';
import { logEvent } from '../../lib/log';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' } as const;
const wardIdSchema = z.coerce.number().int().positive();
const bodySchema = z.object({
  wardId: z.number().int().positive(),
  issueIds: z.array(z.number().int().positive()).length(3),
  recaptchaToken: z.string().min(1).max(4096),
}).strict();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function dailyLimit(): number {
  const configured = Number(process.env.ANONYMOUS_VOTE_DAILY_BUDGET ?? 50_000);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 50_000;
}

function isVoteError(message: string): message is AnonymousVoteErrorCode {
  return message === 'invalid_selection_count' || message === 'issue_not_in_ward' || message === 'already_voted';
}

export const PUT: APIRoute = async ({ request, cookies }) => {
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success || new Set(parsed.data?.issueIds ?? []).size !== 3) {
    return json({ error: 'invalid vote payload' }, 400);
  }

  const existingToken = cookies.get(ANONYMOUS_VOTE_COOKIE)?.value;
  if (existingToken && (await anonymousVoteStatus(existingToken, parsed.data.wardId)).status !== 'not_voted') {
    return json({ error: 'already_voted' }, 409);
  }

  const captcha = await verifyRecaptcha(parsed.data.recaptchaToken, { expectedAction: 'issue_vote' });
  if (!captcha.ok) return json({ error: 'verification failed' }, 403);
  if (!await consumeBudget('anonymous_vote', dailyLimit())) {
    return json({ error: 'daily voting limit reached' }, 429);
  }

  const token = existingToken ?? newAnonymousVoteToken();
  try {
    await castAnonymousVote(token, parsed.data.wardId, parsed.data.issueIds);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (isVoteError(message)) return json({ error: message }, message === 'already_voted' ? 409 : 400);
    throw error;
  }

  cookies.set(ANONYMOUS_VOTE_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'strict', secure: new URL(request.url).protocol === 'https:',
    maxAge: ANONYMOUS_VOTE_COOKIE_MAX_AGE,
  });
  // Deliberately excludes the receipt and selected issue ids.
  logEvent('anonymous_vote_cast', { wardId: parsed.data.wardId });
  return json({ ok: true });
};

export const GET: APIRoute = async ({ url, cookies }) => {
  const parsedWardId = wardIdSchema.safeParse(url.searchParams.get('wardId'));
  if (!parsedWardId.success) return json({ error: 'invalid wardId' }, 400);

  const token = cookies.get(ANONYMOUS_VOTE_COOKIE)?.value;
  const status = await anonymousVoteStatus(token, parsedWardId.data);
  if (url.searchParams.get('results') !== '1') return json(status);
  if (status.status !== 'voted_here') return json({ error: 'vote required' }, 403);
  return json({ status: status.status, results: await anonymousIssueResults(parsedWardId.data) });
};

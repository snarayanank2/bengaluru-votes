/**
 * `/llms.txt` (Task 57) — a concise, AEO-friendly plain-text index of this
 * platform's public content, following the llms.txt convention: a title +
 * one-line description, then sections linking the key public content
 * (voting guides, wards, candidates) as ABSOLUTE URLs.
 *
 * Deliberately NOT an exhaustive dump: with 369 wards and hundreds of
 * candidates, this stays a genuine navigable index — a handful of
 * representative ward links plus a pointer at the full machine-readable
 * `sitemap-en.xml` (which enumerates every ward/candidate URL with
 * `lastmod`) rather than inlining every row.
 *
 * FACTUAL ONLY (this is a non-partisan election-information site, same
 * neutrality rule as src/lib/seo.ts): no marketing superlatives, no
 * rankings, no evaluative claims — just what exists and where to find it.
 *
 * CACHE-SAFE (architecture §5): no cookie/session read, identical output
 * for every visitor at a given moment — a plain public, cacheable
 * response. Deliberately does NOT set `cache-control: no-store`.
 */
import type { APIRoute } from 'astro';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { wards } from '../db/schema';

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://bengaluruvotes.opencity.in';

const SAMPLE_SIZE = 5;

function abs(path: string): string {
  return new URL(path, SITE_ORIGIN).href;
}

export const GET: APIRoute = async () => {
  const sampleWards = await db
    .select({ id: wards.id, nameEn: wards.nameEn })
    .from(wards)
    .orderBy(wards.id)
    .limit(SAMPLE_SIZE);

  const [{ count: wardCount }] = await db.select({ count: sql<number>`count(*)::int` }).from(wards);

  const sampleWardLines = sampleWards.map((ward) => `- ${abs(`/ward/${ward.id}`)} — ${ward.nameEn}`).join('\n');

  const lines = [
    '# Bengaluru Votes',
    '',
    'A ward-level information platform for Bengaluru\'s GBA (corporator) ward elections: find your ward, read neutral sourced candidate report cards, compare candidates, vote on the top local issues, and access voting logistics. Bilingual — English at the root, Kannada under /kn/.',
    '',
    '## Voting guides',
    `- Voting guide hub: ${abs('/voting-guide')}`,
    `- Check your registration / eligibility: ${abs('/check-registration')}`,
    `- Voter ID issuance & update: ${abs('/voting-guide/voter-id')}`,
    `- How to vote: ${abs('/voting-guide/how-to-vote')}`,
    `- Find your polling booth: ${abs('/voting-guide/find-booth')}`,
    `- Election info / explainer: ${abs('/about-election')}`,
    '',
    '## Wards',
    `Every one of Bengaluru's ${wardCount} GBA wards has its own page at ${abs('/ward/{id}')}, with that ward's candidate list, side-by-side candidate comparison (${abs('/ward/{id}/compare')}), and issue voting. A sample:`,
    sampleWardLines,
    '',
    '## Candidates',
    `Each candidate has a neutral, sourced report card at ${abs('/candidate/{slug}')} — name, party, ward track record, criminal cases, declared assets, education, and linked news coverage, each field marked with its source. Browse from any ward's candidate list, or see the complete machine-readable index (every ward and candidate URL, with lastmod) at ${abs('/sitemap-en.xml')} (Kannada: ${abs('/sitemap-kn.xml')}).`,
    '',
    '## About this platform',
    `- About us, funding & how we source data: ${abs('/about')}`,
    `- Data & key metrics: ${abs('/data')}`,
    `- Donate to support the platform: ${abs('/donate')}`,
    `- Privacy policy: ${abs('/privacy')}`,
    `- Terms & conditions: ${abs('/terms')}`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};

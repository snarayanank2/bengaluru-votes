/**
 * `/.well-known/security.txt` (RFC 9116). Contact is the operator's
 * enquiries address (AGENTS.md "Citizen privacy scope"). `Expires` is
 * required by the RFC and must be under a year out, so it is derived per
 * response; identical for every visitor, hence cache-safe.
 */
import type { APIRoute } from 'astro';

const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://bengaluruvotes.opencity.in';

export const GET: APIRoute = () => {
  const expires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
  const body = [
    'Contact: mailto:sivaramakrishnan.n@oorvani.in',
    `Expires: ${expires}`,
    'Preferred-Languages: en, kn',
    `Canonical: ${SITE_ORIGIN}/.well-known/security.txt`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};

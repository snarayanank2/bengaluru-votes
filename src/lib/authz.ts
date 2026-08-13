/**
 * Authorization helpers used by src/middleware.ts (route-class guards) and
 * by the curator/admin write actions themselves (Task 34/36/39, PRD §7/§10)
 * for per-ward scope checks the middleware can't make on its own — the
 * middleware only knows the route CLASS (`/curator/*`), not the ward id
 * embedded in a specific edit's payload/params.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { curatorScopes } from '../db/schema';
import type { Role } from './session';

/**
 * Whether `userId` (with `role`) may edit ward `wardId`'s data. Admin: always
 * true (city-wide, PRD §7/§10). Curator: true iff a `curator_scopes` row
 * (userId, wardId) exists — a curator's edits are scoped to their assigned
 * wards/zone. Citizen: always false (citizens never edit ward/candidate
 * data at all).
 */
export async function canEditWard(userId: number, role: Role, wardId: number): Promise<boolean> {
  if (role === 'admin') return true;
  if (role !== 'curator') return false;

  const [row] = await db
    .select()
    .from(curatorScopes)
    .where(and(eq(curatorScopes.userId, userId), eq(curatorScopes.wardId, wardId)));
  return row !== undefined;
}

/** Same default used by src/middleware.ts's `passesOriginCheck` fallback. */
const DEFAULT_SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

/**
 * Validates a post-login (or any other) return-target as a same-origin
 * RELATIVE path (architecture.md §7: "the `/login` fallback's post-login
 * return target is validated as a same-origin relative path — a
 * user-supplied absolute URL is discarded in favour of `/`" — closing the
 * open-redirect vector).
 *
 * Fixed 2026-07 (Task 26 review, CRITICAL): the original implementation was
 * a set of string-prefix checks (`startsWith('/')`, not `//`, not a leading
 * backslash) and MISSED ASCII control characters. `/\t/evil.example`,
 * `/\n/evil.example`, and `/\r/evil.example` all pass those string checks
 * (they start with a single `/`), but the WHATWG URL parser strips
 * `\t`/`\r`/`\n` from the input as its very first parsing step — so the
 * browser (and our own `new URL()` calls elsewhere) resolves
 * `/\t/evil.example` to the protocol-relative `//evil.example`, i.e.
 * `https://evil.example/`. Because the consumer of this value
 * (`/login?next=`, Task 27) reads `next` back out via `URLSearchParams`,
 * which decodes `%09`/`%0A`/`%0D` into those same raw control bytes, the
 * bypass was live end-to-end.
 *
 * The fix is CANONICALIZE-THEN-COMPARE rather than another round of
 * string-trick enumeration:
 *   1. Reject outright (`'/'`) anything that isn't a non-empty string, or
 *      that contains any C0 control character (0x00–0x1F) or DEL (0x7F) —
 *      this alone closes the tab/CR/LF bypass, and any future control-char
 *      trick in the same family.
 *   2. Cheaply reject the obvious non-relative shapes before ever parsing:
 *      must start with exactly one `/` (not `//`, a protocol-relative URL —
 *      `//evil.example` is parsed by browsers as `https://evil.example`;
 *      not `/\`, since some browsers normalize a leading `\` to `/`, making
 *      `/\evil.example` protocol-relative too).
 *   3. THEN parse it with `new URL(next, SITE_ORIGIN)` — the same
 *      canonicalizing parser the browser/consumer will eventually use —
 *      and require the *resulting* origin to equal our own origin. This is
 *      the real defense: it doesn't matter how `next` is spelled or
 *      encoded, only where it actually resolves to. Return the
 *      RECONSTRUCTED `pathname + search + hash` from that parsed URL, never
 *      the raw input, so nothing attacker-controlled survives the trip —
 *      only a canonical same-origin path/query/hash ever comes back.
 * Fixed 2026-07 (Task 26 re-review, residual bypass): dot-segment
 * normalization performed BY the URL parser itself (step 3 above) can turn a
 * same-origin input into a pathname that starts with `//` — e.g.
 * `new URL('/.//evil.example', SITE_ORIGIN).pathname` collapses to
 * `//evil.example`. `u.origin` is still our own origin (the parser resolved
 * the whole thing against SITE_ORIGIN first), so the origin check passes —
 * but the RECONSTRUCTED string we hand back is protocol-relative. `/login`'s
 * consumer (Task 27) uses that string as a raw redirect target, and a
 * browser re-parsing `//evil.example` in isolation resolves it to
 * `https://evil.example`. So the origin check alone is not sufficient; the
 * reconstructed `pathname + search + hash` must ALSO be re-validated as a
 * genuine single-`/`-rooted relative path (not `//`, not `/\`) after
 * canonicalization — the same shape check as step 2, but applied to the
 * parser's OUTPUT instead of the raw input. This is the backstop: no matter
 * what dot-segment or backslash trick produces the final pathname, it can't
 * leave this function unless it starts with exactly one `/`.
 *
 * Anything that doesn't parse, resolves off-origin, or reconstructs to a
 * non-relative shape, falls back to `/`.
 */
export function isSameOriginRelative(next: unknown): string {
  if (typeof next !== 'string' || next === '' || /[\x00-\x1f\x7f]/.test(next)) return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';

  const siteOrigin = process.env.SITE_ORIGIN ?? DEFAULT_SITE_ORIGIN;
  try {
    const u = new URL(next, siteOrigin);
    if (u.origin !== new URL(siteOrigin).origin) return '/';
    const rel = u.pathname + u.search + u.hash;
    // Post-canonicalization backstop: dot-segment collapse inside the URL
    // parser (e.g. `/.//evil.example` -> pathname `//evil.example`) can
    // produce a same-origin parse whose RECONSTRUCTED string is itself
    // protocol-relative. Re-validate the output, not just the input.
    if (!rel.startsWith('/') || rel.startsWith('//') || rel.startsWith('/\\')) return '/';
    return rel;
  } catch {
    return '/';
  }
}

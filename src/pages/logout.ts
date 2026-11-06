/**
 * `POST /logout` — ends the signed-in staff member's session.
 *
 * src/middleware.ts has already required a session (any role), the
 * same-origin check and the CSRF token (the sign-out form carries it as a
 * hidden field). The middleware never touches cookies, so this handler does
 * both halves itself: it deletes the `sessions` row server-side (the cookie
 * alone ending would leave a stolen copy valid for up to an hour) and
 * answers with the cookie-clearing header, then sends the person to /login.
 *
 * POST only: a GET (a link, a prefetch, an image tag) must never sign anyone
 * out. There is no /kn/ twin; staff routes have none.
 */
import type { APIRoute } from 'astro';
import { clearSessionCookie, destroySession, SESSION_COOKIE } from '../lib/session';

export const POST: APIRoute = async ({ cookies }) => {
  const cookieValue = cookies.get(SESSION_COOKIE)?.value;
  if (cookieValue) await destroySession(cookieValue);
  return new Response(null, {
    status: 303,
    headers: { Location: '/login', 'Set-Cookie': clearSessionCookie(), 'cache-control': 'no-store' },
  });
};

export const ALL: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: 'POST', 'cache-control': 'no-store' } });

/**
 * `/login` — staff sign-in. Both page twins (src/pages/login.astro,
 * src/pages/kn/login.astro) call `handleLoginPost` with the submitted
 * `FormData` and render `src/features/pages/Login.astro` with the returned
 * state — this module owns the orchestration, the page twins own the HTTP
 * concerns a plain module cannot (redirect Response, Set-Cookie, no-store).
 *
 * `next` (the post-login redirect target) is re-validated with
 * `isSameOriginRelative` on every POST rather than trusted from the form.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { isSameOriginRelative } from './authz';
import { loginWithMasterPassword, normalizeEmail } from './master-login';

export interface LoginRenderState {
  /** Already-validated (isSameOriginRelative) same-origin relative path. */
  next: string;
  /** The email the visitor typed, echoed back after a failed attempt. */
  destination?: string;
  /** An i18n key (src/i18n/en.json), not literal text — Login.astro resolves it via t(). */
  error?: string;
}

export type LoginPostOutcome =
  | { kind: 'redirect'; location: string; setCookie: string }
  | { kind: 'render'; state: LoginRenderState };

/** GET /login. */
export function initialLoginState(nextRaw: unknown, error?: string): LoginRenderState {
  return { next: isSameOriginRelative(nextRaw), error };
}

/**
 * Where a successful sign-in goes. A caller who asked for a page gets it;
 * one who asked for nothing in particular (`next` is `/`) is taken to their
 * own area (transcriber, curator or admin) instead of the public home page.
 */
async function landingFor(destinationRaw: string, next: string): Promise<string> {
  if (next !== '/') return next;
  const email = normalizeEmail(destinationRaw);
  if (email === '') return next;
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.email, email));
  if (user?.role === 'transcriber') return '/transcribe';
  if (user?.role === 'curator') return '/curator';
  if (user?.role === 'admin') return '/admin';
  return next;
}

export async function handleLoginPost(form: FormData): Promise<LoginPostOutcome> {
  const next = isSameOriginRelative(form.get('next'));
  const destination = String(form.get('destination') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const result = await loginWithMasterPassword(destination, password);
  if (result.ok) {
    return { kind: 'redirect', location: await landingFor(destination, next), setCookie: result.setCookie };
  }
  return { kind: 'render', state: { next, destination, error: 'auth.password.error.invalid' } };
}

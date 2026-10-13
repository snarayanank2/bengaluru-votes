/**
 * `/login` — the no-JS / deep-link server-rendered fallback for the
 * Register/Login flow (Task 27, information-architecture.md §7.1). The
 * Register/Login MODAL (src/islands/RegisterLoginModal.ts) is a progressive
 * enhancement over this exact same flow — both call
 * `resolveOrRegister`/`requestOtp` directly (never fetch their own API),
 * so the account-resolution logic can never diverge between the two.
 *
 * Both page twins (src/pages/login.astro, src/pages/kn/login.astro) call
 * `handleLoginPost` with the submitted `FormData` and render
 * `src/features/pages/Login.astro` with the returned state — this module
 * owns the step-dispatch/orchestration, the page twins own the HTTP
 * concerns a plain module cannot (redirect Response, Set-Cookie, no-store).
 *
 * STATE ACROSS NO-JS STEPS: each step's `<form>` carries the values needed
 * by the NEXT step as hidden fields (destination, channel, and — for step
 * 3 — the OTP code itself, reused per `resolveOrRegister`'s
 * peek-then-consume contract, src/lib/auth-flow.ts). `next` (the validated
 * post-login redirect target) is threaded the same way, re-validated with
 * `isSameOriginRelative` on every step rather than trusted once and carried
 * forward blindly.
 */
import { requestOtp, type OtpChannel } from './otp';
import { resolveOrRegister, type RegisterPayload } from './auth-flow';
import { isSameOriginRelative } from './authz';
import { loginWithMasterPassword, masterLoginEnabled } from './master-login';

export type LoginStep = 1 | 2 | 3;

export interface LoginRenderState {
  step: LoginStep;
  /** Already-validated (isSameOriginRelative) same-origin relative path. */
  next: string;
  /** TEMPORARY (until email works for OTP): render the master-password form instead of the OTP steps. */
  passwordMode?: boolean;
  destination?: string;
  channel?: OtpChannel;
  /** Step 3 only — the OTP code carried forward from step 2, reused on submit. */
  code?: string;
  /** An i18n key (src/i18n/en.json), not literal text — Login.astro resolves it via t(). */
  error?: string;
}

export type LoginPostOutcome =
  | { kind: 'redirect'; location: string; setCookie: string }
  | { kind: 'render'; state: LoginRenderState };

/** Same inference rule as the Register/Login modal (src/islands/RegisterLoginModal.ts). */
function inferChannel(destination: string): OtpChannel {
  return destination.includes('@') ? 'email' : 'whatsapp';
}

/** GET /login (or any error path that restarts the flow) — always step 1. */
export function initialLoginState(nextRaw: unknown, error?: string): LoginRenderState {
  return { step: 1, next: isSameOriginRelative(nextRaw), error, passwordMode: masterLoginEnabled() };
}

async function handleStep1(form: FormData, next: string): Promise<LoginPostOutcome> {
  const destination = String(form.get('destination') ?? '').trim();
  if (!destination) {
    return { kind: 'render', state: { step: 1, next, error: 'auth.step1.error.required' } };
  }

  const channel = inferChannel(destination);
  const status = await requestOtp(destination, channel, 'auth');

  // Every status except a WhatsApp send failure advances to step 2 without
  // disclosing which — same non-disclosure invariant src/pages/api/otp/
  // request.ts documents (a cooldown/budget/suppression state is not a
  // contact-existence leak, and the client can't act on the distinction
  // anyway; a WhatsApp send failure specifically needs to nudge toward
  // email, since there is no code to enter otherwise).
  if (channel === 'whatsapp' && status === 'send_failed') {
    return { kind: 'render', state: { step: 1, next, error: 'auth.step1.whatsappNudge' } };
  }

  return { kind: 'render', state: { step: 2, next, destination, channel } };
}

async function handleStep2(form: FormData, next: string, srcAttribution: string | null): Promise<LoginPostOutcome> {
  const destination = String(form.get('destination') ?? '').trim();
  const channel = String(form.get('channel') ?? 'email') === 'whatsapp' ? 'whatsapp' : 'email';
  const code = String(form.get('code') ?? '').trim();

  const result = await resolveOrRegister(destination, code, undefined, srcAttribution);
  if (result.ok) {
    return { kind: 'redirect', location: next, setCookie: result.setCookie };
  }
  if (result.reason === 'registration_required') {
    return { kind: 'render', state: { step: 3, next, destination, channel, code } };
  }
  return {
    kind: 'render',
    state: { step: 2, next, destination, channel, error: `auth.step2.error.${result.reason}` },
  };
}

async function handleStep3(form: FormData, next: string, srcAttribution: string | null): Promise<LoginPostOutcome> {
  const destination = String(form.get('destination') ?? '').trim();
  const channel = String(form.get('channel') ?? 'email') === 'whatsapp' ? 'whatsapp' : 'email';
  const code = String(form.get('code') ?? '').trim();
  const wardIdRaw = Number(form.get('wardId'));
  const language = String(form.get('language') ?? 'en') === 'kn' ? 'kn' : 'en';
  const futureTools = form.get('futureTools') != null;

  if (!Number.isInteger(wardIdRaw)) {
    return {
      kind: 'render',
      state: { step: 3, next, destination, channel, code, error: 'auth.step3.error.ward' },
    };
  }

  const register: RegisterPayload = { wardId: wardIdRaw, language, futureTools };
  const result = await resolveOrRegister(destination, code, register, srcAttribution);
  if (result.ok) {
    return { kind: 'redirect', location: next, setCookie: result.setCookie };
  }
  if (result.reason === 'expired') {
    // The code expired between step 2 and step 3 — there is nothing left to
    // resubmit; send the visitor back to the start to request a fresh one.
    return { kind: 'render', state: { step: 1, next, error: 'auth.step3.codeExpired' } };
  }
  // 'invalid' | 'locked' | (defensively) 'registration_required' — the
  // register payload was supplied, so the last case should not occur; treat
  // it the same as 'invalid' rather than fail closed with no explanation.
  const errorReason = result.reason === 'registration_required' ? 'invalid' : result.reason;
  return {
    kind: 'render',
    state: { step: 2, next, destination, channel, error: `auth.step2.error.${errorReason}` },
  };
}

/** TEMPORARY master-password path (src/lib/master-login.ts) — deleted when email works for OTP. */
async function handlePasswordLogin(form: FormData, next: string): Promise<LoginPostOutcome> {
  const destination = String(form.get('destination') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const result = await loginWithMasterPassword(destination, password);
  if (result.ok) {
    return { kind: 'redirect', location: next, setCookie: result.setCookie };
  }
  return {
    kind: 'render',
    state: { step: 1, next, passwordMode: true, destination, error: 'auth.password.error.invalid' },
  };
}

/** Dispatches a `/login` POST by its hidden `step` field (defaults to '1' if absent/tampered). */
export async function handleLoginPost(form: FormData, srcAttribution: string | null): Promise<LoginPostOutcome> {
  const next = isSameOriginRelative(form.get('next'));
  if (masterLoginEnabled()) return handlePasswordLogin(form, next);
  const step = String(form.get('step') ?? '1');

  if (step === '2') return handleStep2(form, next, srcAttribution);
  if (step === '3') return handleStep3(form, next, srcAttribution);
  return handleStep1(form, next);
}

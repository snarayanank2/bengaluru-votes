/**
 * Register/Login modal — the client-side half of Task 27 (IA §7.1). Built
 * on `ModalController` (src/islands/ModalShell.ts) over the `<dialog>`
 * markup `src/components/RegisterLoginModal.astro` renders once per page
 * (from Base.astro, so it's present everywhere).
 *
 * GLOBAL OPENER (core concept 2 — "gated at submit, resumes in place"):
 * `openRegisterLogin` is exported AND attached to `window.bvOpenRegisterLogin`
 * so any other island (this file's own register-slot/sign-in wiring below,
 * and later the Flag/Vote modals, Tasks 32/33) can open this SAME modal with
 * its own `onSuccess` callback — the attempted action resumes exactly where
 * it left off, with NO page reload and NO URL change, when `onSuccess` is
 * given. A plain "Sign in" (no attempted action, so no `onSuccess`) falls
 * back to `location.reload()` so the app bar picks up the signed-in state —
 * a reload re-runs Task 28's MeSlot island from scratch, which is simpler
 * and just as correct as trying to trigger an in-place re-swap from here.
 *
 * STEPS (design-system.md §7.9 — single input per step):
 *   1. contact (email or WhatsApp number; channel inferred from the value)
 *      -> POST /api/otp/request.
 *   2. the ONE 6-digit OTP input -> POST /api/otp/verify {destination,code}.
 *      {ok:true} -> resume/close. {ok:false, reason:'registration_required'}
 *      -> step 3. Any other {ok:false} -> inline error, stay on step 2.
 *   3. (unknown contact only) ward + language + consent + optional
 *      future-tools checkbox -> POST /api/otp/verify {destination, code,
 *      register} — REUSES the code from step 2 (src/lib/auth-flow.ts's
 *      peek-then-consume contract keeps it valid across these two calls).
 *      {ok:true} -> resume/close. reason:'expired' -> the code died in the
 *      gap between steps 2 and 3; reset to step 1 with a "request a new
 *      one" notice. Any other failure -> back to step 2 with an error.
 *
 * The dialog is never destroyed/rebuilt between opens — `openRegisterLogin`
 * just resets it to step 1 (or step 3 pre-filled read-only, when opened
 * with `prefillWardId`) and stores the new `onSuccess` for THIS open.
 */
import { ModalController, type ModalDialogLike } from './ModalShell';

export interface OpenRegisterLoginOptions {
  prefillWardId?: number;
  onSuccess?: () => void;
}

interface RequestOtpResponse {
  status: 'sent' | 'already_sent' | 'cooldown_daily' | 'budget_exhausted' | 'suppressed' | 'send_failed';
}

type VerifyOtpResponse =
  | { ok: true; registered: boolean }
  | { ok: false; reason: 'expired' | 'invalid' | 'locked' | 'registration_required' };

interface Elements {
  dialog: HTMLDialogElement;
  controller: ModalController;
  banner: HTMLElement;
  form1: HTMLFormElement;
  destinationInput: HTMLInputElement;
  form2: HTMLFormElement;
  codeInput: HTMLInputElement;
  otpError: HTMLElement;
  backTo1: HTMLButtonElement;
  form3: HTMLFormElement;
  wardEditableWrap: HTMLElement;
  wardInput: HTMLInputElement;
  wardReadonlyWrap: HTMLElement;
  wardReadonlyValue: HTMLElement;
  languageSelect: HTMLSelectElement;
  futureToolsCheckbox: HTMLInputElement;
  msgWhatsappNudge: string;
  msgSendFailed: string;
  msgErrorInvalid: string;
  msgErrorExpired: string;
  msgErrorLocked: string;
  msgCodeExpiredResend: string;
}

let els: Elements | null = null;
let onSuccess: (() => void) | undefined;
let currentDestination = '';
let currentCode = '';

function text(root: ParentNode, selector: string): string {
  return root.querySelector(selector)?.textContent ?? '';
}

function findElements(root: ParentNode): Elements | null {
  const dialog = root.querySelector<HTMLDialogElement>('[data-register-login-modal]');
  const form1 = dialog?.querySelector<HTMLFormElement>('[data-rl-form="1"]');
  const form2 = dialog?.querySelector<HTMLFormElement>('[data-rl-form="2"]');
  const form3 = dialog?.querySelector<HTMLFormElement>('[data-rl-form="3"]');
  const destinationInput = form1?.querySelector<HTMLInputElement>('input[name="destination"]');
  const codeInput = form2?.querySelector<HTMLInputElement>('input[name="code"]');
  const banner = dialog?.querySelector<HTMLElement>('[data-rl-banner]');
  const otpError = form2?.querySelector<HTMLElement>('[data-rl-otp-error]');
  const backTo1 = form2?.querySelector<HTMLButtonElement>('[data-rl-back-to-1]');
  const wardEditableWrap = form3?.querySelector<HTMLElement>('[data-rl-ward-editable]');
  const wardInput = form3?.querySelector<HTMLInputElement>('input[name="wardId"]');
  const wardReadonlyWrap = form3?.querySelector<HTMLElement>('[data-rl-ward-readonly]');
  const wardReadonlyValue = form3?.querySelector<HTMLElement>('[data-rl-ward-readonly-value]');
  const languageSelect = form3?.querySelector<HTMLSelectElement>('select[name="language"]');
  const futureToolsCheckbox = form3?.querySelector<HTMLInputElement>('input[name="futureTools"]');

  if (
    !dialog ||
    !form1 ||
    !form2 ||
    !form3 ||
    !destinationInput ||
    !codeInput ||
    !banner ||
    !otpError ||
    !backTo1 ||
    !wardEditableWrap ||
    !wardInput ||
    !wardReadonlyWrap ||
    !wardReadonlyValue ||
    !languageSelect ||
    !futureToolsCheckbox
  ) {
    return null;
  }

  return {
    dialog,
    controller: new ModalController(dialog as unknown as ModalDialogLike),
    banner,
    form1,
    destinationInput,
    form2,
    codeInput,
    otpError,
    backTo1,
    form3,
    wardEditableWrap,
    wardInput,
    wardReadonlyWrap,
    wardReadonlyValue,
    languageSelect,
    futureToolsCheckbox,
    msgWhatsappNudge: text(dialog, '[data-msg-whatsapp-nudge]'),
    msgSendFailed: text(dialog, '[data-msg-send-failed]'),
    msgErrorInvalid: text(dialog, '[data-msg-error-invalid]'),
    msgErrorExpired: text(dialog, '[data-msg-error-expired]'),
    msgErrorLocked: text(dialog, '[data-msg-error-locked]'),
    msgCodeExpiredResend: text(dialog, '[data-msg-code-expired-resend]'),
  };
}

function inferChannel(destination: string): 'email' | 'whatsapp' {
  return destination.includes('@') ? 'email' : 'whatsapp';
}

function showStep(step: 1 | 2 | 3): void {
  if (!els) return;
  els.form1.hidden = step !== 1;
  els.form2.hidden = step !== 2;
  els.form3.hidden = step !== 3;
}

function clearBanner(): void {
  if (!els) return;
  els.banner.hidden = true;
  els.banner.textContent = '';
}

function showBanner(message: string): void {
  if (!els) return;
  els.banner.hidden = false;
  els.banner.textContent = message;
}

function clearOtpError(): void {
  if (!els) return;
  els.otpError.hidden = true;
  els.otpError.textContent = '';
}

function showOtpError(message: string): void {
  if (!els) return;
  els.otpError.hidden = false;
  els.otpError.textContent = message;
}

function errorMessageFor(reason: 'expired' | 'invalid' | 'locked'): string {
  if (!els) return '';
  if (reason === 'expired') return els.msgErrorExpired;
  if (reason === 'locked') return els.msgErrorLocked;
  return els.msgErrorInvalid;
}

function setSubmitDisabled(form: HTMLFormElement, disabled: boolean): void {
  const button = form.querySelector<HTMLButtonElement>('[data-rl-submit]');
  if (button) button.disabled = disabled;
}

function finishSuccess(): void {
  els?.controller.close();
  if (onSuccess) {
    onSuccess();
  } else {
    location.reload();
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

async function onSubmitContact(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!els) return;

  const destination = els.destinationInput.value.trim();
  if (!destination) return; // native `required` handles the empty case

  currentDestination = destination;
  const channel = inferChannel(destination);

  setSubmitDisabled(els.form1, true);
  try {
    const data = await postJson<RequestOtpResponse>('/api/otp/request', { destination, channel });
    if (data.status === 'send_failed') {
      if (channel === 'whatsapp') {
        showBanner(els.msgWhatsappNudge);
      } else {
        showBanner(els.msgSendFailed);
      }
      return;
    }
    clearBanner();
    els.codeInput.value = '';
    showStep(2);
  } finally {
    setSubmitDisabled(els.form1, false);
  }
}

async function onSubmitOtp(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!els) return;

  const code = els.codeInput.value.trim();
  clearOtpError();
  setSubmitDisabled(els.form2, true);
  try {
    const data = await postJson<VerifyOtpResponse>('/api/otp/verify', { destination: currentDestination, code });
    if (data.ok) {
      finishSuccess();
      return;
    }
    if (data.reason === 'registration_required') {
      currentCode = code;
      showStep(3);
      return;
    }
    showOtpError(errorMessageFor(data.reason));
  } finally {
    setSubmitDisabled(els.form2, false);
  }
}

async function onSubmitRegister(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!els) return;

  const wardId = els.wardEditableWrap.hidden ? Number(els.wardReadonlyValue.textContent) : Number(els.wardInput.value);
  const language = els.languageSelect.value === 'kn' ? 'kn' : 'en';
  const futureTools = els.futureToolsCheckbox.checked;

  setSubmitDisabled(els.form3, true);
  try {
    const data = await postJson<VerifyOtpResponse>('/api/otp/verify', {
      destination: currentDestination,
      code: currentCode,
      register: { wardId, language, futureTools },
    });
    if (data.ok) {
      finishSuccess();
      return;
    }
    if (data.reason === 'expired') {
      showStep(1);
      showBanner(els.msgCodeExpiredResend);
      return;
    }
    // invalid/locked/registration_required (defensive — should not occur
    // with a register payload already supplied): surface on step 2, where
    // the code input lives, and let the visitor retry or go back.
    showStep(2);
    showOtpError(errorMessageFor(data.reason === 'registration_required' ? 'invalid' : data.reason));
  } finally {
    setSubmitDisabled(els.form3, false);
  }
}

function resetToStep1(): void {
  if (!els) return;
  els.form1.reset();
  els.form2.reset();
  els.form3.reset();
  clearBanner();
  clearOtpError();
  showStep(1);
}

function wireForms(e: Elements): void {
  e.form1.addEventListener('submit', onSubmitContact);
  e.form2.addEventListener('submit', onSubmitOtp);
  e.form3.addEventListener('submit', onSubmitRegister);
  e.backTo1.addEventListener('click', () => {
    showStep(1);
    clearOtpError();
  });
}

/**
 * Opens the Register/Login modal, resetting it to step 1 (or, when
 * `prefillWardId` is given, priming step 3's ward field read-only for once
 * step 2 succeeds and the flow lands there). Safe no-op if the modal markup
 * isn't present on this page (defensive — mirrors src/islands/WardLookup.ts).
 */
export function openRegisterLogin(opts: OpenRegisterLoginOptions = {}, opener?: { focus(): void } | null): void {
  if (!els) {
    els = findElements(document);
    if (!els) return;
    wireForms(els);
  }

  onSuccess = opts.onSuccess;
  currentDestination = '';
  currentCode = '';
  resetToStep1();

  if (typeof opts.prefillWardId === 'number') {
    els.wardEditableWrap.hidden = true;
    els.wardInput.required = false;
    els.wardReadonlyWrap.hidden = false;
    els.wardReadonlyValue.textContent = String(opts.prefillWardId);
  } else {
    els.wardEditableWrap.hidden = false;
    els.wardInput.required = true;
    els.wardReadonlyWrap.hidden = true;
  }

  els.controller.open(opener ?? undefined);
}

declare global {
  interface Window {
    bvOpenRegisterLogin?: typeof openRegisterLogin;
  }
}

/**
 * Wires the two entry points every page can render (design-system.md
 * §7.8 "gated actions render in their full enabled style for anonymous
 * users — the gate is the Register/Login modal at tap"):
 *   - `[data-me-slot]` (AppBar's "Sign in" control) -> no prefill, no
 *     `onSuccess` (plain sign-in; see `finishSuccess`'s `location.reload()`
 *     fallback).
 *   - `[data-register-slot]` (a ward page's "Register for updates" button,
 *     src/features/pages/Ward.astro) -> prefills the
 *     ward from that element's `data-ward-id`, and reloads on success so
 *     the slot picks up the "Receiving updates" state via Task 28's
 *     MeSlot island (src/islands/MeSlot.ts), which runs again on the
 *     reloaded page.
 *
 * Also exposes `window.bvOpenRegisterLogin` so any OTHER island (the
 * Flag/Vote modals, Tasks 32/33) can open this exact modal with its own
 * `onSuccess` to resume its own gated action in place.
 */
export function initRegisterLoginModal(root: ParentNode = document): void {
  window.bvOpenRegisterLogin = openRegisterLogin;

  for (const el of root.querySelectorAll<HTMLElement>('[data-me-slot]')) {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      openRegisterLogin({}, el);
    });
  }

  for (const el of root.querySelectorAll<HTMLElement>('[data-register-slot]')) {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      const wardId = Number(el.dataset.wardId);
      openRegisterLogin(
        {
          prefillWardId: Number.isFinite(wardId) ? wardId : undefined,
          onSuccess: () => location.reload(),
        },
        el,
      );
    });
  }
}

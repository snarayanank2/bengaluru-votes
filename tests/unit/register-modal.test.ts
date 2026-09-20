// @vitest-environment jsdom
/**
 * Direct coverage for the Register/Login modal island
 * (src/islands/RegisterLoginModal.ts) — Task 27. Builds a DOM fixture
 * mirroring the exact markup src/components/RegisterLoginModal.astro
 * renders (same `data-rl-*`/`data-msg-*` hooks) and drives it via jsdom,
 * mocking `fetch` for /api/otp/request and /api/otp/verify.
 *
 * jsdom (this repo's version) does not implement
 * `HTMLDialogElement.prototype.showModal`/`close` at all (see
 * src/islands/ModalShell.ts's own header — its tests use a hand-rolled fake
 * dialog for exactly this reason). This file polyfills both with the
 * minimal real behavior `ModalController` depends on (toggling the `open`
 * attribute, firing a `close` event) so a REAL `<dialog>` element can be
 * exercised end-to-end here.
 *
 * MODULE STATE, PER TEST: the island caches the DOM elements it finds on
 * its FIRST `openRegisterLogin`/`initRegisterLoginModal` call (module-level
 * `els`, matching production — the dialog is built once per page and
 * reused for every open). Since each test below rebuilds a fresh DOM
 * fixture, the module itself is reset (`vi.resetModules()` + a fresh
 * dynamic import) in every `beforeEach` so it never holds onto elements
 * from a previous test's now-replaced DOM.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

type RegisterLoginModalModule = typeof import('../../src/islands/RegisterLoginModal');

const MSGS = {
  contactRequired: 'Enter an email address or WhatsApp number.',
  whatsappNudge: 'We could not reach you on WhatsApp — try email instead.',
  sendFailed: "We couldn't send a code to that address. Please try again.",
  errorInvalid: 'That code is incorrect. Try again.',
  errorExpired: 'That code has expired. Request a new one.',
  errorLocked: 'Too many incorrect attempts. Request a new code.',
  codeExpiredResend: 'That code expired while you were registering.',
};

/** Mirrors src/components/RegisterLoginModal.astro's rendered markup (the data-rl- / data-msg- hooks the island depends on). */
const MODAL_HTML = `
  <dialog data-register-login-modal aria-labelledby="rl-modal-title">
    <div class="rl-modal-inner">
      <button type="button" data-modal-close aria-label="Close">&times;</button>
      <h2 id="rl-modal-title">Sign in or register</h2>
      <p data-rl-banner hidden></p>

      <form data-rl-form="1" novalidate>
        <label for="rl-destination">Email or WhatsApp number</label>
        <input id="rl-destination" name="destination" type="text" required aria-describedby="rl-contact-helper rl-contact-error" />
        <p id="rl-contact-helper">We will send a code.</p>
        <p id="rl-contact-error" data-rl-contact-error hidden></p>
        <button type="submit" data-rl-submit>Send code</button>
      </form>

      <form data-rl-form="2" hidden novalidate>
        <label for="rl-code">6-digit code</label>
        <input id="rl-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required />
        <p data-rl-otp-error hidden></p>
        <button type="submit" data-rl-submit>Verify</button>
        <button type="button" data-rl-back-to-1>Use a different contact</button>
      </form>

      <form data-rl-form="3" hidden novalidate>
        <div data-rl-ward-editable>
          <label for="rl-ward">Your ward number</label>
          <input id="rl-ward" name="wardId" type="number" />
        </div>
        <p data-rl-ward-readonly hidden>
          <span>Your ward number</span> <span data-rl-ward-readonly-value></span>
        </p>
        <select id="rl-language" name="language">
          <option value="en">English</option>
          <option value="kn">Kannada</option>
        </select>
        <label>
          <input type="checkbox" name="futureTools" />
          Tell me about future civic tools
        </label>
        <button type="submit" data-rl-submit>Complete registration</button>
      </form>
    </div>

    <span hidden data-msg-contact-required>${MSGS.contactRequired}</span>
    <span hidden data-msg-whatsapp-nudge>${MSGS.whatsappNudge}</span>
    <span hidden data-msg-send-failed>${MSGS.sendFailed}</span>
    <span hidden data-msg-error-invalid>${MSGS.errorInvalid}</span>
    <span hidden data-msg-error-expired>${MSGS.errorExpired}</span>
    <span hidden data-msg-error-locked>${MSGS.errorLocked}</span>
    <span hidden data-msg-code-expired-resend>${MSGS.codeExpiredResend}</span>
  </dialog>
`;

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

/** Flushes the microtask queue so the island's async fetch chain settles. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

function jsonResponse(body: unknown): { ok: true; json: () => Promise<unknown> } {
  return { ok: true, json: async () => body };
}

beforeAll(() => {
  // jsdom does not implement these at all (see file header) — minimal
  // polyfill so ModalController's showModal()/close() calls work.
  if (!('showModal' in HTMLDialogElement.prototype)) {
    Object.assign(HTMLDialogElement.prototype, {
      showModal(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
      close(this: HTMLDialogElement) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      },
    });
  }
});

describe('RegisterLoginModal island (src/islands/RegisterLoginModal.ts)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let reloadSpy: ReturnType<typeof vi.fn>;
  let openRegisterLogin: RegisterLoginModalModule['openRegisterLogin'];

  beforeEach(async () => {
    document.body.innerHTML = MODAL_HTML;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });

    vi.resetModules();
    ({ openRegisterLogin } = await import('../../src/islands/RegisterLoginModal'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function dialog(): HTMLDialogElement {
    return document.querySelector('[data-register-login-modal]')!;
  }

  function formStep(step: 1 | 2 | 3): HTMLFormElement {
    return document.querySelector(`[data-rl-form="${step}"]`)!;
  }

  it('opens the dialog', () => {
    openRegisterLogin({});
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(formStep(1).hidden).toBe(false);
    expect(formStep(2).hidden).toBe(true);
    expect(formStep(3).hidden).toBe(true);
  });

  it('the single OTP input has inputmode=numeric, autocomplete=one-time-code, maxlength=6 — not six boxes', () => {
    openRegisterLogin({});
    const otpInputs = formStep(2).querySelectorAll('input[name="code"]');
    expect(otpInputs).toHaveLength(1);
    const input = otpInputs[0] as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('maxlength')).toBe('6');
  });

  it('ward pre-fill renders the ward field read-only when prefillWardId is given', () => {
    openRegisterLogin({ prefillWardId: 57 });
    const editable = document.querySelector('[data-rl-ward-editable]') as HTMLElement;
    const readonly = document.querySelector('[data-rl-ward-readonly]') as HTMLElement;
    const readonlyValue = document.querySelector('[data-rl-ward-readonly-value]') as HTMLElement;
    expect(editable.hidden).toBe(true);
    expect(readonly.hidden).toBe(false);
    expect(readonlyValue.textContent).toBe('57');
  });

  it('without prefillWardId, the ward field is editable (not read-only)', () => {
    openRegisterLogin({});
    const editable = document.querySelector('[data-rl-ward-editable]') as HTMLElement;
    const readonly = document.querySelector('[data-rl-ward-readonly]') as HTMLElement;
    expect(editable.hidden).toBe(false);
    expect(readonly.hidden).toBe(true);
  });

  it.each(['', '   '])('shows and associates an error for empty contact %j without sending a request', async (value) => {
    openRegisterLogin({});
    const input = document.querySelector<HTMLInputElement>('#rl-destination')!;
    input.value = value;
    submit(formStep(1));
    await flush();
    const error = document.querySelector<HTMLElement>('[data-rl-contact-error]')!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe(MSGS.contactRequired);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
    expect(document.activeElement).toBe(input);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears the contact error when corrected and when the dialog is reopened', async () => {
    openRegisterLogin({});
    const input = document.querySelector<HTMLInputElement>('#rl-destination')!;
    const error = document.querySelector<HTMLElement>('[data-rl-contact-error]')!;
    submit(formStep(1));
    expect(error.hidden).toBe(false);
    input.value = 'citizen@example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(error.hidden).toBe(true);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    input.value = '';
    submit(formStep(1));
    openRegisterLogin({});
    expect(error.hidden).toBe(true);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  describe('step transitions over mocked fetch', () => {
    it('step 1 submit -> POST /api/otp/request -> advances to step 2 ("sent")', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'sent' }));
      openRegisterLogin({});

      const destinationInput = document.querySelector<HTMLInputElement>('input[name="destination"]')!;
      destinationInput.value = 'citizen@example.com';
      submit(formStep(1));
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/otp/request');
      expect(JSON.parse(init.body)).toEqual({ destination: 'citizen@example.com', channel: 'email' });

      expect(formStep(1).hidden).toBe(true);
      expect(formStep(2).hidden).toBe(false);
    });

    it('a WhatsApp destination that gets send_failed shows the WhatsApp nudge and stays on step 1', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'send_failed' }));
      openRegisterLogin({});

      const destinationInput = document.querySelector<HTMLInputElement>('input[name="destination"]')!;
      destinationInput.value = '+919000000001';
      submit(formStep(1));
      await flush();

      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init.body).channel).toBe('whatsapp');
      expect(formStep(1).hidden).toBe(false);
      expect(formStep(2).hidden).toBe(true);
      const banner = document.querySelector('[data-rl-banner]') as HTMLElement;
      expect(banner.hidden).toBe(false);
      expect(banner.textContent).toBe(MSGS.whatsappNudge);
    });

    it('an email destination that gets send_failed shows a generic send_failed message and stays on step 1', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'send_failed' }));
      openRegisterLogin({});

      const destinationInput = document.querySelector<HTMLInputElement>('input[name="destination"]')!;
      destinationInput.value = 'citizen@example.com';
      submit(formStep(1));
      await flush();

      const [, init] = fetchMock.mock.calls[0]!;
      expect(JSON.parse(init.body).channel).toBe('email');
      expect(formStep(1).hidden).toBe(false);
      expect(formStep(2).hidden).toBe(true);
      const banner = document.querySelector('[data-rl-banner]') as HTMLElement;
      expect(banner.hidden).toBe(false);
      expect(banner.textContent).toBe(MSGS.sendFailed);
    });

    it('verify -> {ok:true, registered:false} calls onSuccess and does NOT reload (gated-action resume-in-place)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'sent' }));
      const onSuccess = vi.fn();
      openRegisterLogin({ onSuccess });

      document.querySelector<HTMLInputElement>('input[name="destination"]')!.value = 'known@example.com';
      submit(formStep(1));
      await flush();

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, registered: false }));
      document.querySelector<HTMLInputElement>('input[name="code"]')!.value = '123456';
      submit(formStep(2));
      await flush();

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(reloadSpy).not.toHaveBeenCalled();
      expect(dialog().hasAttribute('open')).toBe(false); // controller.close() ran
    });

    it('a plain sign-in (no onSuccess) falls back to location.reload() on success', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'sent' }));
      openRegisterLogin({});

      document.querySelector<HTMLInputElement>('input[name="destination"]')!.value = 'known@example.com';
      submit(formStep(1));
      await flush();

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, registered: false }));
      document.querySelector<HTMLInputElement>('input[name="code"]')!.value = '123456';
      submit(formStep(2));
      await flush();

      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('verify -> {ok:false, reason:"registration_required"} shows step 3', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'sent' }));
      openRegisterLogin({});

      document.querySelector<HTMLInputElement>('input[name="destination"]')!.value = 'new@example.com';
      submit(formStep(1));
      await flush();

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, reason: 'registration_required' }));
      document.querySelector<HTMLInputElement>('input[name="code"]')!.value = '654321';
      submit(formStep(2));
      await flush();

      expect(formStep(2).hidden).toBe(true);
      expect(formStep(3).hidden).toBe(false);
    });

    it('an invalid/expired/locked verify result shows an inline error and stays on step 2', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'sent' }));
      openRegisterLogin({});
      document.querySelector<HTMLInputElement>('input[name="destination"]')!.value = 'known@example.com';
      submit(formStep(1));
      await flush();

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, reason: 'invalid' }));
      document.querySelector<HTMLInputElement>('input[name="code"]')!.value = '000000';
      submit(formStep(2));
      await flush();

      expect(formStep(2).hidden).toBe(false);
      const otpError = document.querySelector('[data-rl-otp-error]') as HTMLElement;
      expect(otpError.hidden).toBe(false);
      expect(otpError.textContent).toBe(MSGS.errorInvalid);
    });

    it('step 3 submit -> {ok:true, registered:true} calls onSuccess, reusing the destination+code from steps 1-2', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'sent' }));
      const onSuccess = vi.fn();
      openRegisterLogin({ onSuccess });

      document.querySelector<HTMLInputElement>('input[name="destination"]')!.value = 'new@example.com';
      submit(formStep(1));
      await flush();

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, reason: 'registration_required' }));
      document.querySelector<HTMLInputElement>('input[name="code"]')!.value = '654321';
      submit(formStep(2));
      await flush();

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, registered: true }));
      (document.querySelector('#rl-ward') as HTMLInputElement).value = '57';
      (document.querySelector('#rl-language') as HTMLSelectElement).value = 'kn';
      (document.querySelector('input[name="futureTools"]') as HTMLInputElement).checked = true;
      submit(formStep(3));
      await flush();

      expect(onSuccess).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[2]!;
      expect(url).toBe('/api/otp/verify');
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        destination: 'new@example.com',
        code: '654321',
        register: { wardId: 57, language: 'kn', futureTools: true },
      });
    });

    it('step 3 submit with a prefilled read-only ward sends that wardId, not the (hidden) editable input', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'sent' }));
      const onSuccess = vi.fn();
      openRegisterLogin({ prefillWardId: 99, onSuccess });

      document.querySelector<HTMLInputElement>('input[name="destination"]')!.value = 'new-ward@example.com';
      submit(formStep(1));
      await flush();

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, reason: 'registration_required' }));
      document.querySelector<HTMLInputElement>('input[name="code"]')!.value = '111222';
      submit(formStep(2));
      await flush();

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, registered: true }));
      submit(formStep(3));
      await flush();

      const [, init] = fetchMock.mock.calls[2]!;
      expect(JSON.parse(init.body).register.wardId).toBe(99);
    });

    it('step 3 -> {ok:false, reason:"expired"} resets to step 1 with a resend notice', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'sent' }));
      openRegisterLogin({});
      document.querySelector<HTMLInputElement>('input[name="destination"]')!.value = 'new@example.com';
      submit(formStep(1));
      await flush();

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, reason: 'registration_required' }));
      document.querySelector<HTMLInputElement>('input[name="code"]')!.value = '111222';
      submit(formStep(2));
      await flush();

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, reason: 'expired' }));
      submit(formStep(3));
      await flush();

      expect(formStep(1).hidden).toBe(false);
      expect(formStep(3).hidden).toBe(true);
      const banner = document.querySelector('[data-rl-banner]') as HTMLElement;
      expect(banner.hidden).toBe(false);
      expect(banner.textContent).toBe(MSGS.codeExpiredResend);
    });
  });
});

describe('initRegisterLoginModal wiring ([data-me-slot], [data-register-slot], window.bvOpenRegisterLogin)', () => {
  let initRegisterLoginModal: RegisterLoginModalModule['initRegisterLoginModal'];

  beforeEach(async () => {
    document.body.innerHTML = `
      <a href="/login" data-me-slot>Sign in</a>
      <a href="/login" data-register-slot data-ward-id="42">Register for updates</a>
      ${MODAL_HTML}
    `;
    vi.stubGlobal('fetch', vi.fn());

    vi.resetModules();
    ({ initRegisterLoginModal } = await import('../../src/islands/RegisterLoginModal'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { bvOpenRegisterLogin?: unknown }).bvOpenRegisterLogin;
  });

  it('exposes window.bvOpenRegisterLogin', () => {
    initRegisterLoginModal();
    expect(typeof window.bvOpenRegisterLogin).toBe('function');
  });

  it('clicking [data-me-slot] prevents navigation and opens the modal with no ward pre-fill', () => {
    initRegisterLoginModal();
    const link = document.querySelector('[data-me-slot]') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    const dialog = document.querySelector('[data-register-login-modal]') as HTMLDialogElement;
    expect(dialog.hasAttribute('open')).toBe(true);
    const readonly = document.querySelector('[data-rl-ward-readonly]') as HTMLElement;
    expect(readonly.hidden).toBe(true); // no prefill for a plain sign-in
  });

  it('clicking [data-register-slot] prevents navigation and opens the modal pre-filled with its data-ward-id', () => {
    initRegisterLoginModal();
    const link = document.querySelector('[data-register-slot]') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    const readonlyValue = document.querySelector('[data-rl-ward-readonly-value]') as HTMLElement;
    expect(readonlyValue.textContent).toBe('42');
  });
});

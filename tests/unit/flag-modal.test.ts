// @vitest-environment jsdom
/**
 * Direct coverage for the Flag misinformation modal island
 * (src/islands/FlagModal.ts) — Task 32, IA §7.2, PRD §6.1/§6.3. Builds a
 * DOM fixture mirroring the exact markup src/components/FlagModal.astro
 * renders (same `data-flag-*`/`data-msg-*` hooks) and drives it via jsdom,
 * mocking `fetch` for /api/me and /api/flags, and `window.bvOpenRegisterLogin`
 * (the Register/Login modal's own global opener, Task 27) so the auth
 * gating + resume handoff can be exercised without that modal's own markup.
 *
 * jsdom does not implement `HTMLDialogElement.prototype.showModal`/`close`
 * at all — same polyfill as tests/unit/register-modal.test.ts.
 *
 * MODULE STATE, PER TEST: the island caches the DOM elements it finds on
 * its first `openFlagModal`/`initFlagModal` call (module-level `els`), so
 * every test resets modules (`vi.resetModules()` + a fresh dynamic import)
 * against a freshly-built DOM fixture.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// jsdom (this repo's version) does not implement
// `HTMLDialogElement.prototype.showModal`/`close` at all — same minimal
// polyfill as tests/unit/register-modal.test.ts, applied once at file scope
// (not inside a single `describe`'s `beforeAll`) so BOTH describe blocks
// below get it.
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

type FlagModalModule = typeof import('../../src/islands/FlagModal');
type FlagTarget = import('../../src/islands/FlagModal').FlagTarget;

const MSGS = {
  rateLimit: "You've submitted a lot of flags recently. Please try again later.",
  sourceInvalid: 'Enter a valid web link, starting with http:// or https://.',
  genericError: 'Something went wrong. Please try again.',
  success: "Thanks — this has been sent to the ward's curators.",
};

/** Mirrors src/components/FlagModal.astro's rendered markup. */
const MODAL_HTML = `
  <dialog data-flag-modal aria-labelledby="flag-modal-title">
    <div class="flag-modal-inner">
      <button type="button" data-modal-close aria-label="Close">&times;</button>
      <h2 id="flag-modal-title">Flag an error</h2>

      <form data-flag-form novalidate>
        <div class="form-field">
          <p id="flag-target-label">What's wrong?</p>
          <div data-flag-target-options role="radiogroup" aria-labelledby="flag-target-label"></div>
        </div>

        <div class="form-field">
          <label for="flag-detail">Tell us what's incorrect</label>
          <textarea id="flag-detail" name="detail" rows="3" required></textarea>
        </div>

        <div class="form-field">
          <label for="flag-source">Source link (optional)</label>
          <input id="flag-source" name="sourceUrl" type="url" />
          <p data-flag-source-error hidden></p>
        </div>

        <div class="form-field">
          <label for="flag-suggested">Suggested correction (optional)</label>
          <input id="flag-suggested" name="suggestedValue" type="text" />
        </div>

        <p data-flag-rate-limit-error hidden></p>
        <p data-flag-generic-error hidden></p>

        <button type="submit" data-flag-submit>Submit flag</button>
      </form>
    </div>

    <span hidden data-msg-rate-limit>${MSGS.rateLimit}</span>
    <span hidden data-msg-source-invalid>${MSGS.sourceInvalid}</span>
    <span hidden data-msg-generic-error>${MSGS.genericError}</span>
    <span hidden data-msg-success>${MSGS.success}</span>
  </dialog>
`;

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

/** Flushes the microtask queue so the island's async fetch chains settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function jsonResponse(body: unknown, status = 200): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const WARD_ID = 57;
const SINGLE_TARGET = [{ targetType: 'ward_field' as const, targetRef: 'ward:57:name', label: 'This ward name and details' }];
const MULTI_TARGETS = [
  { targetType: 'ward_issue' as const, targetRef: 'ward_issue:1', label: 'Garbage collection' },
  { targetType: 'ward_issue' as const, targetRef: 'ward_issue:2', label: 'Road repair' },
];

describe('FlagModal island (src/islands/FlagModal.ts)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let registerLoginSpy: ReturnType<typeof vi.fn>;
  let openFlagModal: FlagModalModule['openFlagModal'];
  let loginRedirectUrl: FlagModalModule['loginRedirectUrl'];
  let initialHref: string;

  beforeEach(async () => {
    document.body.innerHTML = MODAL_HTML;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    registerLoginSpy = vi.fn();
    (window as unknown as { bvOpenRegisterLogin?: unknown }).bvOpenRegisterLogin = registerLoginSpy;

    initialHref = location.href;

    vi.resetModules();
    ({ openFlagModal, loginRedirectUrl } = await import('../../src/islands/FlagModal'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { bvOpenRegisterLogin?: unknown }).bvOpenRegisterLogin;
    delete (window as { bvOpenFlagModal?: unknown }).bvOpenFlagModal;
  });

  function dialog(): HTMLDialogElement {
    return document.querySelector('[data-flag-modal]')!;
  }

  function form(): HTMLFormElement {
    return document.querySelector('[data-flag-form]')!;
  }

  function fillForm(opts: { targetRef?: string; detail?: string; sourceUrl?: string; suggestedValue?: string }): void {
    if (opts.targetRef) {
      const radio = document.querySelector<HTMLInputElement>(`input[name="targetRef"][value="${opts.targetRef}"]`);
      if (radio) radio.checked = true;
    }
    document.querySelector<HTMLTextAreaElement>('textarea[name="detail"]')!.value = opts.detail ?? '';
    document.querySelector<HTMLInputElement>('input[name="sourceUrl"]')!.value = opts.sourceUrl ?? '';
    document.querySelector<HTMLInputElement>('input[name="suggestedValue"]')!.value = opts.suggestedValue ?? '';
  }

  it('ANONYMOUS: openFlagModal opens Register/Login FIRST, not the flag form', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: true }));

    openFlagModal({ wardId: WARD_ID, targets: SINGLE_TARGET });
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('/api/me');
    expect(registerLoginSpy).toHaveBeenCalledTimes(1);
    expect(dialog().hasAttribute('open')).toBe(false); // flag form did NOT open yet
  });

  it('ANONYMOUS: once Register/Login\'s onSuccess fires, the flag modal opens', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: true }));

    openFlagModal({ wardId: WARD_ID, targets: SINGLE_TARGET });
    await flush();

    const onSuccess = registerLoginSpy.mock.calls[0]![0].onSuccess as () => void;

    fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: false, userId: 1, role: 'citizen' }));
    onSuccess();
    await flush();

    expect(dialog().hasAttribute('open')).toBe(true);
  });

  it('AUTHED: openFlagModal opens the flag form directly, no Register/Login', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: false, userId: 1, role: 'citizen' }));

    openFlagModal({ wardId: WARD_ID, targets: SINGLE_TARGET });
    await flush();

    expect(registerLoginSpy).not.toHaveBeenCalled();
    expect(dialog().hasAttribute('open')).toBe(true);
  });

  describe('field/claim picker', () => {
    it('a single target is pre-selected (hidden input carries its targetRef, no radios shown)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: false, userId: 1, role: 'citizen' }));
      openFlagModal({ wardId: WARD_ID, targets: SINGLE_TARGET });
      await flush();

      const radios = document.querySelectorAll('input[name="targetRef"][type="radio"]');
      expect(radios).toHaveLength(0);
      const hidden = document.querySelector<HTMLInputElement>('input[name="targetRef"][type="hidden"]');
      expect(hidden?.value).toBe(SINGLE_TARGET[0]!.targetRef);
      expect(document.querySelector('[data-flag-target-options]')?.textContent).toContain(SINGLE_TARGET[0]!.label);
    });

    it('multiple targets render a radio picker with the first pre-selected', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: false, userId: 1, role: 'citizen' }));
      openFlagModal({ wardId: WARD_ID, targets: MULTI_TARGETS });
      await flush();

      const radios = document.querySelectorAll<HTMLInputElement>('input[name="targetRef"][type="radio"]');
      expect(radios).toHaveLength(2);
      expect(radios[0]!.checked).toBe(true);
      expect(radios[1]!.checked).toBe(false);
      expect(radios[0]!.value).toBe(MULTI_TARGETS[0]!.targetRef);
    });
  });

  describe('submit outcomes', () => {
    async function openAuthed(targets: FlagTarget[] = SINGLE_TARGET): Promise<void> {
      fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: false, userId: 1, role: 'citizen' }));
      openFlagModal({ wardId: WARD_ID, targets });
      await flush();
    }

    it('200 -> POSTs the captured state, shows a success toast, and closes the modal', async () => {
      await openAuthed();
      fillForm({ detail: 'The ward name is misspelled.', sourceUrl: 'https://example.com/proof', suggestedValue: 'Correct Name' });

      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, flagItemId: 42 }, 200));
      submit(form());
      await flush();

      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe('/api/flags');
      expect(JSON.parse(init.body)).toEqual({
        wardId: WARD_ID,
        targetType: 'ward_field',
        targetRef: SINGLE_TARGET[0]!.targetRef,
        detail: 'The ward name is misspelled.',
        suggestedValue: 'Correct Name',
        sourceUrl: 'https://example.com/proof',
      });

      expect(dialog().hasAttribute('open')).toBe(false);
      const toast = document.querySelector('[data-flag-success-toast]');
      expect(toast?.textContent).toBe(MSGS.success);
    });

    it('429 -> shows the rate-limit message, modal stays open', async () => {
      await openAuthed();
      fillForm({ detail: 'Something is wrong here.' });

      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'rate limit exceeded' }, 429));
      submit(form());
      await flush();

      expect(dialog().hasAttribute('open')).toBe(true);
      const rateLimitError = document.querySelector('[data-flag-rate-limit-error]') as HTMLElement;
      expect(rateLimitError.hidden).toBe(false);
      expect(rateLimitError.textContent).toBe(MSGS.rateLimit);
    });

    it('400 -> shows an inline error on the source field, modal stays open', async () => {
      await openAuthed();
      fillForm({ detail: 'Something is wrong here.', sourceUrl: 'javascript:alert(1)' });

      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid flag payload' }, 400));
      submit(form());
      await flush();

      expect(dialog().hasAttribute('open')).toBe(true);
      const sourceError = document.querySelector('[data-flag-source-error]') as HTMLElement;
      expect(sourceError.hidden).toBe(false);
      expect(sourceError.textContent).toBe(MSGS.sourceInvalid);
    });

    it('401 mid-submit: Register/Login opens (flag dialog left open), and onSuccess RE-POSTS the SAME captured state', async () => {
      await openAuthed(MULTI_TARGETS);
      fillForm({
        targetRef: MULTI_TARGETS[1]!.targetRef,
        detail: 'The road repair status is stale.',
        sourceUrl: 'https://example.com/road-status',
        suggestedValue: 'Completed',
      });

      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'authentication required' }, 401));
      submit(form());
      await flush();

      // Session expired mid-flow: same auth-resume opener as the anonymous-at-open path.
      expect(registerLoginSpy).toHaveBeenCalledTimes(1);
      // The flag dialog was deliberately left open across the handoff — nothing was reset.
      expect(dialog().hasAttribute('open')).toBe(true);
      expect((document.querySelector('textarea[name="detail"]') as HTMLTextAreaElement).value).toBe(
        'The road repair status is stale.',
      );

      const onSuccess = registerLoginSpy.mock.calls[0]![0].onSuccess as () => void;
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, flagItemId: 99 }, 200));
      onSuccess();
      await flush();

      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe('/api/flags');
      // SAME captured detail/target/source/suggestedValue as the original (pre-401) attempt — state was preserved.
      expect(JSON.parse(init.body)).toEqual({
        wardId: WARD_ID,
        targetType: 'ward_issue',
        targetRef: MULTI_TARGETS[1]!.targetRef,
        detail: 'The road repair status is stale.',
        suggestedValue: 'Completed',
        sourceUrl: 'https://example.com/road-status',
      });
      expect(dialog().hasAttribute('open')).toBe(false); // resumed submit succeeded -> closes
    });

    it('401 resumed submit itself fails (429): the reopened/still-open flag dialog shows the inline error', async () => {
      await openAuthed();
      fillForm({ detail: 'Flagging this again after re-auth.' });

      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'authentication required' }, 401));
      submit(form());
      await flush();

      const onSuccess = registerLoginSpy.mock.calls[0]![0].onSuccess as () => void;
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'rate limit exceeded' }, 429));
      onSuccess();
      await flush();

      expect(dialog().hasAttribute('open')).toBe(true);
      const rateLimitError = document.querySelector('[data-flag-rate-limit-error]') as HTMLElement;
      expect(rateLimitError.hidden).toBe(false);
    });
  });

  it('the URL never changes across the whole anonymous -> auth -> submit -> success flow', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: true }));
    openFlagModal({ wardId: WARD_ID, targets: SINGLE_TARGET });
    await flush();

    const onSuccess = registerLoginSpy.mock.calls[0]![0].onSuccess as () => void;
    fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: false, userId: 1, role: 'citizen' }));
    onSuccess();
    await flush();

    fillForm({ detail: 'Testing URL stability.' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, flagItemId: 1 }, 200));
    submit(form());
    await flush();

    expect(location.href).toBe(initialHref);
  });

  describe('ModalController shell behavior', () => {
    it('Escape closes the (authed, already-open) flag dialog', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: false, userId: 1, role: 'citizen' }));
      openFlagModal({ wardId: WARD_ID, targets: SINGLE_TARGET });
      await flush();

      expect(dialog().hasAttribute('open')).toBe(true);
      dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(dialog().hasAttribute('open')).toBe(false);
    });

    it('focus starts inside the dialog (first focusable element) when opened', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: false, userId: 1, role: 'citizen' }));
      openFlagModal({ wardId: WARD_ID, targets: SINGLE_TARGET });
      await flush();

      expect(dialog().contains(document.activeElement)).toBe(true);
    });
  });

  describe('temporary password mode: Register/Login modal absent', () => {
    it('loginRedirectUrl sends an English page to /login with next', () => {
      expect(loginRedirectUrl('/candidate/some-slug', '?x=1')).toBe(
        `/login?next=${encodeURIComponent('/candidate/some-slug?x=1')}`,
      );
    });

    it('loginRedirectUrl sends a Kannada page to /kn/login with next', () => {
      expect(loginRedirectUrl('/kn/ward/12', '')).toBe(`/kn/login?next=${encodeURIComponent('/kn/ward/12')}`);
      expect(loginRedirectUrl('/kn', '')).toBe(`/kn/login?next=${encodeURIComponent('/kn')}`);
    });

    it('a path that merely starts with "kn" is not treated as Kannada', () => {
      expect(loginRedirectUrl('/knowledge', '')).toBe(`/login?next=${encodeURIComponent('/knowledge')}`);
    });

    describe('with no bvOpenRegisterLogin, sign-in falls back to /login', () => {
      let assignSpy: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        delete (window as { bvOpenRegisterLogin?: unknown }).bvOpenRegisterLogin;
        assignSpy = vi.fn();
        vi.stubGlobal('location', { pathname: '/ward/12', search: '?a=1', href: initialHref, assign: assignSpy });
      });

      it('ANONYMOUS on open: the flag form does not open and the person is sent to /login', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: true }));
        openFlagModal({ wardId: 1, targets: SINGLE_TARGET });
        await flush();
        expect(dialog().open).toBe(false);
        expect(registerLoginSpy).not.toHaveBeenCalled();
        expect(assignSpy).toHaveBeenCalledExactlyOnceWith(`/login?next=${encodeURIComponent('/ward/12?a=1')}`);
      });

      it('401 on submit: the person is sent to /login instead of a dead click', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: false, userId: 1, role: 'citizen' }));
        openFlagModal({ wardId: WARD_ID, targets: SINGLE_TARGET });
        await flush();
        fillForm({ detail: 'The road repair status is stale.' });
        fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'authentication required' }, 401));
        submit(form());
        await flush();
        expect(registerLoginSpy).not.toHaveBeenCalled();
        expect(assignSpy).toHaveBeenCalledExactlyOnceWith(`/login?next=${encodeURIComponent('/ward/12?a=1')}`);
      });
    });
  });
});

describe('initFlagModal wiring ([data-flag-action], window.bvOpenFlagModal)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let initFlagModal: FlagModalModule['initFlagModal'];

  beforeEach(async () => {
    document.body.innerHTML = `
      <button
        type="button"
        data-flag-action
        data-ward-id="57"
        data-flag-targets='${JSON.stringify(SINGLE_TARGET)}'
      >Flag an error</button>
      ${MODAL_HTML}
    `;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    vi.resetModules();
    ({ initFlagModal } = await import('../../src/islands/FlagModal'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { bvOpenFlagModal?: unknown }).bvOpenFlagModal;
  });

  it('exposes window.bvOpenFlagModal', () => {
    initFlagModal();
    expect(typeof window.bvOpenFlagModal).toBe('function');
  });

  it('clicking [data-flag-action] opens the modal with its data-ward-id/data-flag-targets, authed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ anonymous: false, userId: 1, role: 'citizen' }));
    initFlagModal();

    const button = document.querySelector('[data-flag-action]') as HTMLButtonElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    await flush();

    expect(event.defaultPrevented).toBe(true);
    const dialog = document.querySelector('[data-flag-modal]') as HTMLDialogElement;
    expect(dialog.hasAttribute('open')).toBe(true);
    const hidden = document.querySelector<HTMLInputElement>('input[name="targetRef"][type="hidden"]');
    expect(hidden?.value).toBe(SINGLE_TARGET[0]!.targetRef);
  });
});

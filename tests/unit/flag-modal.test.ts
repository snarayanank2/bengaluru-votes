// @vitest-environment jsdom
/**
 * Direct coverage for the Flag misinformation modal island
 * (src/islands/FlagModal.ts) — Task 32. Builds a
 * DOM fixture mirroring the exact markup src/components/FlagModal.astro
 * renders (same `data-flag-*`/`data-msg-*` hooks) and drives it via jsdom,
 * mocking `fetch` for /api/flags. Reports are anonymous: there is no
 * sign-in step in front of the form.
 *
 * jsdom does not implement `HTMLDialogElement.prototype.showModal`/`close`
 * at all — hence the small polyfill below.
 *
 * MODULE STATE, PER TEST: the island caches the DOM elements it finds on
 * its first `openFlagModal`/`initFlagModal` call (module-level `els`), so
 * every test resets modules (`vi.resetModules()` + a fresh dynamic import)
 * against a freshly-built DOM fixture.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// jsdom (this repo's version) does not implement
// `HTMLDialogElement.prototype.showModal`/`close` at all — a minimal
// polyfill, applied once at file scope
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


const TARGETS = [{ targetType: 'candidate_field' as const, targetRef: 'candidate:1:age', label: 'Age' }];
describe('anonymous FlagModal', () => {
  let api: FlagModalModule;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.resetModules(); document.body.innerHTML = MODAL_HTML;
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, state: 'accepted' }));
    vi.stubGlobal('fetch', fetchMock);
    api = await import('../../src/islands/FlagModal');
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('opens immediately without asking for login or fetching identity', () => {
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    expect(document.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('initializes the browser on submit, then submits with CAPTCHA and closes', async () => {
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    document.querySelector('textarea')!.value = 'The affidavit says 43.';
    submit(document.querySelector('form')!); await flush(); await flush();
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['/api/flags/identity', '/api/flags']);
    const body = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(body.recaptchaToken).toBeTruthy();
    expect(document.querySelector('dialog')!.hasAttribute('open')).toBe(false);
  });
  it.each([403, 429, 503])('retains text and modal on failure %s', async status => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true })).mockResolvedValueOnce(jsonResponse({ error: 'failed' }, status));
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    document.querySelector('textarea')!.value = 'Do not lose this evidence';
    submit(document.querySelector('form')!); await flush(); await flush();
    expect(document.querySelector('textarea')!.value).toBe('Do not lose this evidence');
    expect(document.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    expect(document.querySelector('button[type=submit]')!.hasAttribute('disabled')).toBe(false);
  });
});

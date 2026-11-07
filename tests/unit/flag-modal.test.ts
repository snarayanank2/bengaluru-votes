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
  success: 'Thank you. Your report has been received for review.',
};

/** Mirrors src/components/FlagModal.astro's rendered markup. */
const MODAL_HTML = `
  <dialog data-flag-modal aria-labelledby="flag-modal-title">
    <div class="flag-modal-inner">
      <button type="button" data-modal-close aria-label="Close">&times;</button>
      <h2 id="flag-modal-title">Flag an error</h2>
      <p data-flag-candidate hidden></p>

      <form data-flag-form novalidate>
        <fieldset>
          <legend>Which details are wrong? Tick all that apply.</legend>
          <div data-flag-target-options></div>
        </fieldset>
        <div data-flag-blocks></div>

        <p data-flag-rate-limit-error hidden></p>
        <p data-flag-generic-error hidden></p>

        <button type="submit" data-flag-submit>Submit flag</button>
      </form>
    </div>

    <template data-flag-block-template>
      <fieldset data-flag-block>
        <legend data-flag-block-title></legend>
        <p data-flag-block-help hidden>Use this if something else is wrong.</p>
        <div>
          <label data-flag-detail-label data-label-default="Tell us what's incorrect" data-label-other="Describe the problem"></label>
          <textarea name="detail" rows="3" required></textarea>
          <p data-flag-detail-error hidden></p>
        </div>
        <div>
          <label data-flag-source-label>Source link (optional)</label>
          <input name="sourceUrl" type="url" />
          <p data-flag-source-error hidden></p>
        </div>
        <div data-flag-suggested-field>
          <label data-flag-suggested-label>Suggested correction (optional)</label>
          <input name="suggestedValue" type="text" />
        </div>
      </fieldset>
    </template>

    <span hidden data-msg-rate-limit>${MSGS.rateLimit}</span>
    <span hidden data-msg-rate-limit-minute>Limit reached. Try again in about a minute.</span>
    <span hidden data-msg-rate-limit-minutes>Limit reached. Try again in about {n} minutes.</span>
    <span hidden data-msg-rate-limit-hour>Limit reached. Try again in about an hour.</span>
    <span hidden data-msg-rate-limit-hours>Limit reached. Try again in about {n} hours.</span>
    <span hidden data-msg-source-invalid>${MSGS.sourceInvalid}</span>
    <span hidden data-msg-generic-error>${MSGS.genericError}</span>
    <span hidden data-msg-success>${MSGS.success}</span>
    <span hidden data-msg-detail-required>Describe what is wrong before you submit.</span>
    <span hidden data-msg-select-one>Tick at least one item to report.</span>
    <span hidden data-msg-not-added>Not added again: {fields}.</span>
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

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): { ok: boolean; status: number; headers: Headers; json: () => Promise<unknown> } {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body };
}

const ONE_TARGET = [{ targetType: 'candidate_field' as const, targetRef: 'candidate:1:age', label: 'Age' }];
const TARGETS = [
  { targetType: 'candidate_field' as const, targetRef: 'candidate:1:age', label: 'Age' },
  { targetType: 'candidate_field' as const, targetRef: 'candidate:1:party', label: 'Party' },
  { targetType: 'candidate_other' as const, targetRef: 'candidate:1:other', label: 'Other (something else)' },
];
const dialog = () => document.querySelector('dialog')!;
const tick = (ref: string) => {
  const box = document.querySelector<HTMLInputElement>(`input[name="targetRef"][value="${ref}"]`)!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};
const block = (ref: string) => document.querySelector<HTMLElement>(`[data-flag-block][data-target-ref="${ref}"]`)!;
const type = (ref: string, detail: string) => { block(ref).querySelector<HTMLTextAreaElement>('textarea')!.value = detail; };
const sentBody = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse(fetchMock.mock.calls[1]![1].body);

describe('anonymous FlagModal', () => {
  let api: FlagModalModule;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.resetModules(); document.body.innerHTML = MODAL_HTML;
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, accepted: 1, results: [{ targetRef: 'candidate:1:age', state: 'accepted' }] }));
    vi.stubGlobal('fetch', fetchMock);
    api = await import('../../src/islands/FlagModal');
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('opens immediately without asking for login or fetching identity', () => {
    api.openFlagModal({ wardId: 1, targets: ONE_TARGET });
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a single target is pre-selected with its block shown and no checkbox', async () => {
    api.openFlagModal({ wardId: 1, targets: ONE_TARGET });
    expect(document.querySelectorAll('input[name="targetRef"]')).toHaveLength(0);
    expect(block('candidate:1:age').hidden).toBe(false);
    document.querySelector('textarea')!.value = 'The affidavit says 43.';
    submit(document.querySelector('form')!); await flush(); await flush();
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['/api/flags/identity', '/api/flags']);
    const body = sentBody(fetchMock);
    expect(body.recaptchaToken).toBeTruthy();
    expect(body.targets).toEqual([{ targetType: 'candidate_field', targetRef: 'candidate:1:age', detail: 'The affidavit says 43.', suggestedValue: null, sourceUrl: null }]);
    expect(dialog().hasAttribute('open')).toBe(false);
  });

  it('offers checkboxes, and each ticked field gets its own correction block', () => {
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    expect(document.querySelectorAll('input[type=checkbox][name="targetRef"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-flag-block]:not([hidden])')).toHaveLength(0);
    tick('candidate:1:age'); tick('candidate:1:party');
    const shown = Array.from(document.querySelectorAll('[data-flag-block]:not([hidden])')).map(b => b.querySelector('legend')!.textContent);
    expect(shown).toEqual(['Age', 'Party']);
    // Hidden blocks are disabled so they neither validate nor submit.
    expect(block('candidate:1:other').querySelector('textarea')!.disabled).toBe(true);
    // Labels are tied to their own controls (unique ids per block).
    const ids = Array.from(document.querySelectorAll('textarea')).map(t => t.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('sends every ticked target in one request; "Other" has no suggested value', async () => {
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    tick('candidate:1:age'); tick('candidate:1:other');
    type('candidate:1:age', 'Should be 43'); type('candidate:1:other', 'Wrong person');
    block('candidate:1:age').querySelector<HTMLInputElement>('input[name=suggestedValue]')!.value = '43';
    expect(block('candidate:1:other').querySelector('input[name=suggestedValue]')).toBeNull();
    block('candidate:1:other').querySelector<HTMLInputElement>('input[name=sourceUrl]')!.value = 'https://example.com/p';
    submit(document.querySelector('form')!); await flush(); await flush();
    expect(sentBody(fetchMock).targets).toEqual([
      { targetType: 'candidate_field', targetRef: 'candidate:1:age', detail: 'Should be 43', suggestedValue: '43', sourceUrl: null },
      { targetType: 'candidate_other', targetRef: 'candidate:1:other', detail: 'Wrong person', suggestedValue: null, sourceUrl: 'https://example.com/p' },
    ]);
  });

  it('asks for at least one tick and does not call the API', async () => {
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    submit(document.querySelector('form')!); await flush();
    expect(document.querySelector('[data-flag-generic-error]')!.textContent).toBe('Tick at least one item to report.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The form is `novalidate`: an empty required description is reported inline
  // (design-system §7.10), not as the browser's own bubble.
  it('an empty description is an inline error on the textarea, with focus there and nothing sent', async () => {
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    tick('candidate:1:age');
    submit(document.querySelector('form')!); await flush();
    const box = block('candidate:1:age').querySelector<HTMLTextAreaElement>('textarea')!;
    const error = block('candidate:1:age').querySelector<HTMLElement>('[data-flag-detail-error]')!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('Describe what is wrong before you submit.');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toBe(error.id);
    expect(error.id).not.toBe('');
    expect(document.activeElement).toBe(box);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('whitespace is an empty description too', async () => {
    api.openFlagModal({ wardId: 1, targets: ONE_TARGET });
    document.querySelector('textarea')!.value = '   \n ';
    submit(document.querySelector('form')!); await flush();
    expect(document.querySelector<HTMLElement>('[data-flag-detail-error]')!.hidden).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flags every ticked block that is missing its description and focuses the first', async () => {
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    tick('candidate:1:age'); tick('candidate:1:party'); type('candidate:1:party', 'filled');
    tick('candidate:1:other');
    submit(document.querySelector('form')!); await flush();
    const state = (ref: string) => block(ref).querySelector<HTMLTextAreaElement>('textarea')!.getAttribute('aria-invalid');
    expect(state('candidate:1:age')).toBe('true');
    expect(state('candidate:1:party')).toBeNull();
    expect(state('candidate:1:other')).toBe('true');
    expect(document.activeElement).toBe(block('candidate:1:age').querySelector('textarea'));
  });

  it('typing into a refused description clears its error', async () => {
    api.openFlagModal({ wardId: 1, targets: ONE_TARGET });
    submit(document.querySelector('form')!); await flush();
    const box = document.querySelector<HTMLTextAreaElement>('textarea')!;
    box.value = 'x';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector<HTMLElement>('[data-flag-detail-error]')!.hidden).toBe(true);
    expect(box.hasAttribute('aria-invalid')).toBe(false);
    expect(box.hasAttribute('aria-describedby')).toBe(false);
  });

  it('reports a missing description and a bad source link together', async () => {
    api.openFlagModal({ wardId: 1, targets: ONE_TARGET });
    block('candidate:1:age').querySelector<HTMLInputElement>('input[name=sourceUrl]')!.value = 'ftp://example.com';
    submit(document.querySelector('form')!); await flush();
    expect(block('candidate:1:age').querySelector<HTMLElement>('[data-flag-detail-error]')!.hidden).toBe(false);
    expect(block('candidate:1:age').querySelector('[data-flag-source-error]')!.textContent).toBe(MSGS.sourceInvalid);
    // Focus goes to the first problem in reading order: the description.
    expect(document.activeElement).toBe(block('candidate:1:age').querySelector('textarea'));
  });

  it('rejects a non-http source link on its own block before sending', async () => {
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    tick('candidate:1:age'); type('candidate:1:age', 'Wrong');
    block('candidate:1:age').querySelector<HTMLInputElement>('input[name=sourceUrl]')!.value = 'ftp://example.com';
    submit(document.querySelector('form')!); await flush();
    expect(block('candidate:1:age').querySelector('[data-flag-source-error]')!.textContent).toBe(MSGS.sourceInvalid);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('partial success closes the modal and the toast names what was not added again', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true })).mockResolvedValueOnce(jsonResponse({ ok: true, accepted: 1, results: [
      { targetRef: 'candidate:1:age', state: 'duplicate' }, { targetRef: 'candidate:1:party', state: 'accepted' },
    ] }));
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    tick('candidate:1:age'); tick('candidate:1:party'); type('candidate:1:age', 'a'); type('candidate:1:party', 'b');
    submit(document.querySelector('form')!); await flush(); await flush();
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(document.querySelector('[data-flag-success-toast]')!.textContent).toBe(`${MSGS.success} Not added again: Age.`);
  });

  it('when nothing was new the modal stays open, keeps the text and says why', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true })).mockResolvedValueOnce(jsonResponse({ ok: true, accepted: 0, results: [{ targetRef: 'candidate:1:age', state: 'already_reported' }] }));
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    tick('candidate:1:age'); type('candidate:1:age', 'keep me');
    submit(document.querySelector('form')!); await flush(); await flush();
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(block('candidate:1:age').querySelector('textarea')!.value).toBe('keep me');
    expect(document.querySelector('[data-flag-generic-error]')!.textContent).toBe('Not added again: Age.');
  });

  it.each([
    [45, 'Limit reached. Try again in about a minute.'],
    [600, 'Limit reached. Try again in about 10 minutes.'],
    [3600, 'Limit reached. Try again in about an hour.'],
    [3 * 3600, 'Limit reached. Try again in about 3 hours.'],
  ])('429 with retryAfterSeconds %s shows "%s"', async (seconds, message) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true })).mockResolvedValueOnce(jsonResponse({ error: 'rate_limited', retryAfterSeconds: seconds }, 429));
    api.openFlagModal({ wardId: 1, targets: ONE_TARGET });
    document.querySelector('textarea')!.value = 'text';
    submit(document.querySelector('form')!); await flush(); await flush();
    expect(document.querySelector('[data-flag-rate-limit-error]')!.textContent).toBe(message);
  });

  it('429 without a hint falls back to the generic limit message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true })).mockResolvedValueOnce(jsonResponse({ error: 'rate_limited' }, 429));
    api.openFlagModal({ wardId: 1, targets: ONE_TARGET });
    document.querySelector('textarea')!.value = 'text';
    submit(document.querySelector('form')!); await flush(); await flush();
    expect(document.querySelector('[data-flag-rate-limit-error]')!.textContent).toBe(MSGS.rateLimit);
  });

  it('names the candidate above the form, and hides the line when no name is given', () => {
    api.openFlagModal({ wardId: 1, targets: TARGETS, candidateName: 'Test Candidate' });
    const line = document.querySelector<HTMLElement>('[data-flag-candidate]')!;
    expect(line.hidden).toBe(false); expect(line.textContent).toBe('Test Candidate');
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    expect(line.hidden).toBe(true);
  });

  it('marks an invalid source link as aria-invalid and described by its error, clearing it on the next submit', async () => {
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    tick('candidate:1:age'); type('candidate:1:age', 'Wrong');
    const source = block('candidate:1:age').querySelector<HTMLInputElement>('input[name=sourceUrl]')!;
    source.value = 'ftp://example.com';
    submit(document.querySelector('form')!); await flush();
    expect(source.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(source.getAttribute('aria-describedby')!)!.textContent).toBe(MSGS.sourceInvalid);
    source.value = 'https://example.com';
    submit(document.querySelector('form')!); await flush();
    expect(source.hasAttribute('aria-invalid')).toBe(false);
  });

  it('a click on the backdrop does not close the modal', () => {
    api.openFlagModal({ wardId: 1, targets: TARGETS });
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog().hasAttribute('open')).toBe(true);
    document.querySelector<HTMLElement>('[data-modal-close]')!.click();
    expect(dialog().hasAttribute('open')).toBe(false);
  });

  it.each([403, 429, 503])('retains text and modal on failure %s', async status => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true })).mockResolvedValueOnce(jsonResponse({ error: 'failed' }, status));
    api.openFlagModal({ wardId: 1, targets: ONE_TARGET });
    document.querySelector('textarea')!.value = 'Do not lose this evidence';
    submit(document.querySelector('form')!); await flush(); await flush();
    expect(document.querySelector('textarea')!.value).toBe('Do not lose this evidence');
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(document.querySelector('button[type=submit]')!.hasAttribute('disabled')).toBe(false);
  });
});

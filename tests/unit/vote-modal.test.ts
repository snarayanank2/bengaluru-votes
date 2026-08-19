// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

if (!('showModal' in HTMLDialogElement.prototype)) Object.assign(HTMLDialogElement.prototype, {
  showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); },
  close(this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); },
});

const HTML = `
<section data-issue-vote-zone data-ward-id="57" data-vote-issues='[{"id":1,"title":"Roads"},{"id":2,"title":"Water"},{"id":3,"title":"Waste"},{"id":4,"title":"Lighting"}]' data-recaptcha-site-key="" data-msg-voted-elsewhere="Already voted in {ward}.">
  <button data-vote-action>Vote</button><span data-show-results-wrap hidden><button data-show-results>Show results</button></span>
  <p data-voted-elsewhere hidden></p><ol data-vote-results hidden></ol>
</section>
<dialog data-vote-modal><button data-modal-close>Close</button><div data-vote-form-wrap><form data-vote-form><div data-vote-issue-options></div><p class="form-error" data-vote-rate-limit-error hidden></p><p class="form-error" data-vote-verification-error hidden></p><p class="form-error" data-vote-generic-error hidden></p><button data-vote-submit disabled>Vote</button></form></div>
<span data-msg-rate-limit>Busy</span><span data-msg-verification-error>Verify</span><span data-msg-generic-error>Error</span><span data-msg-success>Recorded</span><span data-msg-submit-template>Vote ({n} of 3 selected)</span></dialog>`;

async function setup(status: object = { status: 'not_voted' }) {
  vi.resetModules(); document.body.innerHTML = HTML;
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => status });
  vi.stubGlobal('fetch', fetchMock);
  const module = await import('../../src/islands/VoteModal'); module.initVoteModal();
  await Promise.resolve(); await Promise.resolve();
  return { fetchMock, module };
}

describe('anonymous VoteModal island', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('opens directly for an anonymous visitor without requesting /api/me', async () => {
    const { fetchMock } = await setup();
    (document.querySelector('[data-vote-action]') as HTMLButtonElement).click();
    expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/me')).toBe(false);
    expect(document.querySelectorAll('[data-vote-issue-options] input')).toHaveLength(4);
  });

  it('requires exactly three and disables a fourth choice', async () => {
    await setup(); (document.querySelector('[data-vote-action]') as HTMLButtonElement).click();
    const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-vote-issue-options] input')];
    boxes.slice(0, 3).forEach((box) => box.click());
    expect((document.querySelector('[data-vote-submit]') as HTMLButtonElement).disabled).toBe(false);
    expect(boxes[3].disabled).toBe(true);
  });

  it('shows the results button only after status says this browser voted here', async () => {
    await setup({ status: 'voted_here' });
    expect((document.querySelector('[data-vote-action]') as HTMLElement).hidden).toBe(true);
    expect((document.querySelector('[data-show-results-wrap]') as HTMLElement).hidden).toBe(false);
  });

  it('renders only non-zero results as horizontal percentage bars', async () => {
    const { fetchMock } = await setup({ status: 'voted_here' });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [
      { titleEn: 'Roads', titleKn: 'ರಸ್ತೆಗಳು', count: 8, sharePct: 80 },
      { titleEn: 'Water', titleKn: 'ನೀರು', count: 4, sharePct: 40 },
      { titleEn: 'Waste', titleKn: 'ಕಸ', count: 0, sharePct: 0 },
    ] }) });
    (document.querySelector('[data-show-results]') as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    const results = document.querySelector('[data-vote-results]')!;
    expect(results.textContent).toContain('Roads80%');
    expect(results.textContent).not.toContain('8 votes');
    expect(results.textContent).not.toContain('Waste');
    expect(results.querySelectorAll('.issue-result')).toHaveLength(2);
    expect((results.querySelector('.issue-result-fill') as HTMLElement).style.width).toBe('80%');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/issue-votes?wardId=57&results=1');
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const HTML = `
<section data-issue-vote-zone data-ward-id="57" data-vote-issues='[{"id":1,"title":"Roads"},{"id":2,"title":"Water"},{"id":3,"title":"Waste"},{"id":4,"title":"Lighting"}]' data-recaptcha-site-key="" data-msg-voted-elsewhere="Already voted in {ward}.">
  <p data-vote-instructions>Choose exactly three issues.</p><p data-vote-results-intro hidden>You have voted.</p>
  <div data-vote-personal hidden><h3>You voted for</h3><ul data-vote-selections></ul></div>
  <h3 data-vote-results-heading hidden>Overall top issues</h3>
  <span data-show-results-wrap hidden><button data-show-results>Show results</button></span>
  <p data-voted-elsewhere hidden></p><ol data-vote-results hidden></ol>
<div data-inline-vote><div data-vote-form-wrap><form data-vote-form><div data-vote-issue-options><label><input type="checkbox" value="1">Roads</label><label><input type="checkbox" value="2">Water</label><label><input type="checkbox" value="3">Waste</label><label><input type="checkbox" value="4">Lighting</label></div><p class="form-error" data-vote-rate-limit-error hidden></p><p class="form-error" data-vote-verification-error hidden></p><p class="form-error" data-vote-generic-error hidden></p><button data-vote-submit disabled>Vote</button></form></div>
<span data-msg-rate-limit>Busy</span><span data-msg-verification-error>Verify</span><span data-msg-generic-error>Error</span><span data-msg-success>Recorded</span><span data-msg-submit-template>Vote ({n} of 3 selected)</span></div><p data-vote-success hidden tabindex="-1"></p></section>`;

const RESULTS = [
  { issueId: 1, titleEn: 'Roads', titleKn: 'ರಸ್ತೆಗಳು', count: 8, sharePct: 80 },
  { issueId: 2, titleEn: 'Water', titleKn: 'ನೀರು', count: 4, sharePct: 40 },
  { issueId: 3, titleEn: 'Waste', titleKn: 'ಕಸ', count: 0, sharePct: 0 },
];

async function setup(status: object = { status: 'not_voted' }) {
  vi.resetModules(); document.body.innerHTML = HTML;
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: RESULTS, selectedIssueIds: [1, 2, 3] }) }).mockResolvedValueOnce({ ok: true, status: 200, json: async () => status });
  vi.stubGlobal('fetch', fetchMock);
  const module = await import('../../src/islands/IssueVote'); module.initIssueVote();
  await Promise.resolve(); await Promise.resolve();
  return { fetchMock, module };
}

describe('anonymous inline voting island', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('initializes inline for an anonymous visitor without requesting /api/me', async () => {
    const { fetchMock } = await setup();
    expect(document.querySelector('dialog')).toBeNull();
    expect((document.querySelector('[data-vote-submit]') as HTMLButtonElement).textContent).toBe('Vote (0 of 3 selected)');
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/me')).toBe(false);
    expect(document.querySelectorAll('[data-vote-issue-options] input')).toHaveLength(4);
  });

  it('requires exactly three and disables a fourth choice', async () => {
    await setup();
    const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-vote-issue-options] input')];
    boxes.slice(0, 3).forEach((box) => box.click());
    expect((document.querySelector('[data-vote-submit]') as HTMLButtonElement).disabled).toBe(false);
    expect(boxes[3].disabled).toBe(true);
  });

  it('automatically shows results on a return visit', async () => {
    await setup({ status: 'voted_here' });
    expect((document.querySelector('[data-vote-form-wrap]') as HTMLElement).hidden).toBe(true);
    await vi.waitFor(() => expect((document.querySelector('[data-vote-results]') as HTMLElement).hidden).toBe(false));
    expect((document.querySelector('[data-show-results-wrap]') as HTMLElement).hidden).toBe(true);
  });

  it('renders only non-zero results as horizontal percentage bars', async () => {
    const { fetchMock } = await setup({ status: 'voted_here' });
    await vi.waitFor(() => expect((document.querySelector('[data-vote-results]') as HTMLElement).hidden).toBe(false));
    const results = document.querySelector('[data-vote-results]')!;
    expect(results.textContent).toContain('Roads80%');
    expect(results.textContent).not.toContain('8 votes');
    expect(results.textContent).not.toContain('Waste');
    expect(results.querySelectorAll('.issue-result')).toHaveLength(2);
    expect((results.querySelector('.issue-result-fill') as HTMLElement).style.width).toBe('80%');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/issue-votes?wardId=57&results=1');
  });
  it('submits anonymously, prevents duplicate submits, and confirms inline', async () => {
    const { fetchMock } = await setup();
    const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-vote-issue-options] input')];
    boxes.slice(0, 3).forEach((box) => box.click());
    fetchMock.mockResolvedValueOnce({ ok: true });
    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect((document.querySelector('[data-vote-form-wrap]') as HTMLElement).hidden).toBe(true));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ wardId: 57, issueIds: [1, 2, 3] });
    expect((document.querySelector('[data-vote-success]') as HTMLElement).hidden).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('[data-vote-success]'));
    await vi.waitFor(() => expect(document.querySelector('[data-vote-results]')?.textContent).toContain('Roads80%'));
  });

  it('preserves choices after an error and allows a retry', async () => {
    const { fetchMock } = await setup();
    const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-vote-issue-options] input')];
    boxes.slice(0, 3).forEach((box) => box.click());
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect((document.querySelector('[data-vote-rate-limit-error]') as HTMLElement).hidden).toBe(false));
    expect(boxes.filter((box) => box.checked)).toHaveLength(3);
    expect((document.querySelector('[data-vote-submit]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('hides voting and results when the receipt belongs to another ward', async () => {
    await setup({ status: 'voted_elsewhere', wardNameEn: 'Demo ward' });
    expect((document.querySelector('[data-vote-form-wrap]') as HTMLElement).hidden).toBe(true);
    expect((document.querySelector('[data-show-results-wrap]') as HTMLElement).hidden).toBe(true);
    expect(document.querySelector('[data-voted-elsewhere]')?.textContent).toBe('Already voted in Demo ward.');
  });

  it('keeps the ballot saved and offers a results retry after a loading failure', async () => {
    const { fetchMock } = await setup();
    [...document.querySelectorAll<HTMLInputElement>('[data-vote-issue-options] input')].slice(0, 3).forEach((box) => box.click());
    fetchMock.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('offline'));
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect((document.querySelector('[data-show-results-wrap]') as HTMLElement).hidden).toBe(false));
    expect((document.querySelector('[data-vote-form-wrap]') as HTMLElement).hidden).toBe(true);
    expect((document.querySelector('[data-vote-success]') as HTMLElement).hidden).toBe(false);
    (document.querySelector('[data-show-results]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect((document.querySelector('[data-vote-results]') as HTMLElement).hidden).toBe(false));
    expect((document.querySelector('[data-vote-generic-error]') as HTMLElement).hidden).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  });

  it('replaces voting instructions and restores personal selections after reload', async () => {
    await setup({ status: 'voted_here' });
    await vi.waitFor(() => expect(document.querySelector('[data-vote-selections]')?.textContent).toBe('RoadsWaterWaste'));
    expect((document.querySelector('[data-vote-instructions]') as HTMLElement).hidden).toBe(true);
    expect((document.querySelector('[data-vote-results-intro]') as HTMLElement).hidden).toBe(false);
    expect((document.querySelector('[data-vote-personal]') as HTMLElement).hidden).toBe(false);
  });

  it('limits overall results to five without losing personal choices outside the top five', async () => {
    const { fetchMock } = await setup();
    const results = Array.from({ length: 7 }, (_, i) => ({ issueId: i + 1, titleEn: `Issue ${i + 1}`, titleKn: null, count: 7 - i, sharePct: 100 - i * 10 }));
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ results, selectedIssueIds: [1, 6, 7] }) });
    (document.querySelector('[data-show-results]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelectorAll('.issue-result')).toHaveLength(5));
    expect(document.querySelector('[data-vote-selections]')?.textContent).toBe('Issue 1Issue 6Issue 7');
    expect(document.querySelector('[data-vote-results]')?.textContent).not.toContain('Issue 6');
  });

});

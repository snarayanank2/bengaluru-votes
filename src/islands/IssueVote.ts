/** Inline anonymous voting. Receipt state is fetched client-side to keep public HTML cache-safe. */
type Grecaptcha = { ready(cb: () => void): void; execute(key: string, opts: { action: string }): Promise<string> };
declare global { interface Window { grecaptcha?: Grecaptcha } }
const MAX_SELECTIONS = 3;

async function captchaToken(siteKey: string): Promise<string | null> {
  if (!siteKey || !window.grecaptcha) return (!import.meta.env.PROD || ['localhost', '127.0.0.1'].includes(location.hostname)) ? 'local-development' : null;
  return new Promise((resolve) => window.grecaptcha!.ready(() => {
    window.grecaptcha!.execute(siteKey, { action: 'issue_vote' }).then(resolve).catch(() => resolve(null));
  }));
}
function applyStatus(zone: HTMLElement, payload: { status: string; wardId?: number; wardNameEn?: string; wardNameKn?: string }): void {
  const vote = zone.querySelector<HTMLElement>('[data-vote-form-wrap]');
  const show = zone.querySelector<HTMLElement>('[data-show-results-wrap]');
  const elsewhere = zone.querySelector<HTMLElement>('[data-voted-elsewhere]');
  const instructions = zone.querySelector<HTMLElement>('[data-vote-instructions]');
  const intro = zone.querySelector<HTMLElement>('[data-vote-results-intro]');
  if (instructions) instructions.hidden = payload.status !== 'not_voted';
  if (intro) intro.hidden = payload.status !== 'voted_here';
  if (vote) vote.hidden = payload.status !== 'not_voted';
  if (show) show.hidden = true;
  if (elsewhere) {
    elsewhere.hidden = payload.status !== 'voted_elsewhere';
    if (!elsewhere.hidden) {
      const name = document.documentElement.lang === 'kn' ? payload.wardNameKn : payload.wardNameEn;
      elsewhere.textContent = (zone.dataset.msgVotedElsewhere ?? '').replace('{ward}', name ?? String(payload.wardId ?? ''));
    }
  }
}
async function loadStatus(zone: HTMLElement, showResults: () => Promise<void>): Promise<void> {
  try {
    const res = await fetch(`/api/issue-votes?wardId=${zone.dataset.wardId}`);
    if (res.ok) {
      const status = await res.json();
      applyStatus(zone, status);
      if (status.status === 'voted_here') await showResults();
    }
  } catch { /* Keep the anonymous-safe default action visible. */ }
}
function renderResults(zone: HTMLElement, results: Array<{ issueId: number; titleEn: string | null; titleKn: string | null; count: number; sharePct: number }>, selectedIssueIds: number[]): void {
  const list = zone.querySelector<HTMLOListElement>('[data-vote-results]');
  if (!list) return;
  const lang = document.documentElement.lang === 'kn' ? 'kn' : 'en';
  const titleFor = (result: typeof results[number]) => (lang === 'kn' ? (result.titleKn ?? result.titleEn) : (result.titleEn ?? result.titleKn)) ?? '';
  const selections = zone.querySelector<HTMLElement>('[data-vote-selections]');
  if (selections) {
    selections.replaceChildren(...results.filter((result) => selectedIssueIds.includes(result.issueId)).map((result) => {
      const li = document.createElement('li'); li.textContent = titleFor(result); return li;
    }));
  }
  const personal = zone.querySelector<HTMLElement>('[data-vote-personal]');
  if (personal) personal.hidden = false;
  const heading = zone.querySelector<HTMLElement>('[data-vote-results-heading]');
  if (heading) heading.hidden = false;
  list.replaceChildren(...results.filter((result) => result.count > 0).slice(0, 5).map((result) => {
    const li = document.createElement('li');
    const title = titleFor(result);
    const percentage = `${result.sharePct}%`;
    li.className = 'issue-result';
    li.setAttribute('aria-label', `${title ?? ''}: ${percentage}`);

    const header = document.createElement('div');
    header.className = 'issue-result-header';
    const titleElement = document.createElement('span');
    titleElement.className = 'issue-result-title';
    titleElement.textContent = title ?? '';
    const percentageElement = document.createElement('span');
    percentageElement.className = 'issue-result-percentage';
    percentageElement.textContent = percentage;
    header.append(titleElement, percentageElement);

    const track = document.createElement('div');
    track.className = 'issue-result-track';
    track.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('div');
    fill.className = 'issue-result-fill';
    fill.style.width = `${Math.max(0, Math.min(100, result.sharePct))}%`;
    track.append(fill);
    li.append(header, track);
    return li;
  }));
  list.hidden = false;
}

function initZone(zone: HTMLElement): void {
  let submitting = false;
  function text(root: ParentNode, selector: string): string { return root.querySelector(selector)?.textContent ?? ''; }
  function checkboxes(): HTMLInputElement[] {
    return [...zone.querySelectorAll<HTMLInputElement>('[data-vote-issue-options] input')];
  }
  function refresh(): void {

    const selected = checkboxes().filter((box) => box.checked).length;
    checkboxes().forEach((box) => { box.disabled = submitting || (!box.checked && selected >= MAX_SELECTIONS); });
    const submit = zone.querySelector<HTMLButtonElement>('[data-vote-submit]');
    if (submit) {
      submit.disabled = submitting || selected !== MAX_SELECTIONS;
      const label = submit.querySelector('.btn-label') ?? submit;
      label.textContent = text(zone, '[data-msg-submit-template]').replace('{n}', String(selected));
    }
  }
  function setError(kind: 'rate-limit' | 'verification' | 'generic'): void {

    zone.querySelectorAll<HTMLElement>('.form-error').forEach((node) => { node.hidden = true; });
    const node = zone.querySelector<HTMLElement>(`[data-vote-${kind}-error]`);
    if (node) { node.hidden = false; node.textContent = text(zone, `[data-msg-${kind === 'rate-limit' ? 'rate-limit' : `${kind}-error`}]`); }
  }
  async function submitVote(event: SubmitEvent): Promise<void> {
    event.preventDefault(); if (submitting || zone.querySelector<HTMLElement>('[data-vote-form-wrap]')?.hidden) return;
    const issueIds = checkboxes().filter((box) => box.checked).map((box) => Number(box.value));
    if (issueIds.length !== 3) return;
    submitting = true; refresh();
    zone.querySelectorAll<HTMLElement>('.form-error').forEach((node) => { node.hidden = true; });
    const token = await captchaToken(zone.dataset.recaptchaSiteKey ?? '');
    if (!token) { setError('verification'); submitting = false; refresh(); return; }
    try {
      const res = await fetch('/api/issue-votes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wardId: Number(zone.dataset.wardId), issueIds, recaptchaToken: token }) });
      if (!res.ok) { setError(res.status === 429 ? 'rate-limit' : res.status === 403 ? 'verification' : 'generic'); submitting = false; refresh(); return; }
      applyStatus(zone, { status: 'voted_here' });
      const success = zone.querySelector<HTMLElement>('[data-vote-success]');
      if (success) { success.hidden = false; success.focus(); }
      await showResults();
    } catch { setError('generic'); submitting = false; refresh(); }
  }

  async function showResults(): Promise<void> {
    const button = zone.querySelector<HTMLButtonElement>('[data-show-results]');
    const retry = zone.querySelector<HTMLElement>('[data-show-results-wrap]');
    const error = zone.querySelector<HTMLElement>('[data-vote-generic-error]');
    if (button) button.disabled = true;
    if (error) error.hidden = true;
    try {
      const res = await fetch(`/api/issue-votes?wardId=${zone.dataset.wardId}&results=1`);
      if (!res.ok) throw new Error('results_unavailable');
      const payload = await res.json();
      renderResults(zone, payload.results, payload.selectedIssueIds);
      if (retry) retry.hidden = true;
    } catch {
      setError('generic');
      if (retry) retry.hidden = false;
    } finally { if (button) button.disabled = false; }
  }

  zone.querySelector('[data-vote-form]')?.addEventListener('submit', (event) => void submitVote(event as SubmitEvent));
  zone.querySelector('[data-vote-issue-options]')?.addEventListener('change', refresh);
  zone.querySelector('[data-show-results]')?.addEventListener('click', () => void showResults());
  refresh();
  void loadStatus(zone, showResults);
}

export function initIssueVote(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-issue-vote-zone]').forEach(initZone);
}

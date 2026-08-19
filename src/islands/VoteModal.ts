import { ModalController, type ModalDialogLike, type FocusTarget } from './ModalShell';

export interface VoteIssue { id: number; title: string }
export interface OpenVoteModalOptions { wardId: number; issues: VoteIssue[]; recaptchaSiteKey?: string }
type Grecaptcha = { ready(cb: () => void): void; execute(key: string, opts: { action: string }): Promise<string> };
declare global { interface Window { grecaptcha?: Grecaptcha; bvOpenVoteModal?: typeof openVoteModal } }

const MAX_SELECTIONS = 3;
let dialog: HTMLDialogElement | null;
let controller: ModalController | null;
let current: OpenVoteModalOptions | null = null;
let opener: FocusTarget | null = null;

function text(root: ParentNode, selector: string): string { return root.querySelector(selector)?.textContent ?? ''; }
function checkboxes(): HTMLInputElement[] {
  return dialog ? [...dialog.querySelectorAll<HTMLInputElement>('[data-vote-issue-options] input')] : [];
}
function refresh(): void {
  if (!dialog) return;
  const selected = checkboxes().filter((box) => box.checked).length;
  checkboxes().forEach((box) => { box.disabled = !box.checked && selected >= MAX_SELECTIONS; });
  const submit = dialog.querySelector<HTMLButtonElement>('[data-vote-submit]');
  if (submit) {
    submit.disabled = selected !== MAX_SELECTIONS;
    submit.textContent = text(dialog, '[data-msg-submit-template]').replace('{n}', String(selected));
  }
}
function setError(kind: 'rate-limit' | 'verification' | 'generic'): void {
  if (!dialog) return;
  dialog.querySelectorAll<HTMLElement>('.form-error').forEach((node) => { node.hidden = true; });
  const node = dialog.querySelector<HTMLElement>(`[data-vote-${kind}-error]`);
  if (node) { node.hidden = false; node.textContent = text(dialog, `[data-msg-${kind === 'rate-limit' ? 'rate-limit' : `${kind}-error`}]`); }
}
function showToast(): void {
  if (!dialog) return;
  const toast = document.createElement('div');
  toast.className = 'vote-success-toast'; toast.role = 'status';
  toast.textContent = text(dialog, '[data-msg-success]'); document.body.append(toast);
  setTimeout(() => toast.remove(), 5000);
}
function renderOptions(issues: VoteIssue[]): void {
  const container = dialog?.querySelector<HTMLElement>('[data-vote-issue-options]');
  if (!container) return;
  container.replaceChildren(...issues.map((issue) => {
    const label = document.createElement('label'); label.className = 'vote-issue-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = String(issue.id);
    label.append(input, document.createTextNode(issue.title)); return label;
  }));
  refresh();
}
async function captchaToken(siteKey: string): Promise<string | null> {
  if (!siteKey || !window.grecaptcha) return (!import.meta.env.PROD || ['localhost', '127.0.0.1'].includes(location.hostname)) ? 'local-development' : null;
  return new Promise((resolve) => window.grecaptcha!.ready(() => {
    window.grecaptcha!.execute(siteKey, { action: 'issue_vote' }).then(resolve).catch(() => resolve(null));
  }));
}
function zoneFor(wardId: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-issue-vote-zone][data-ward-id="${wardId}"]`);
}
function applyStatus(zone: HTMLElement, payload: { status: string; wardId?: number; wardNameEn?: string; wardNameKn?: string }): void {
  const vote = zone.querySelector<HTMLElement>('[data-vote-action]');
  const show = zone.querySelector<HTMLElement>('[data-show-results-wrap]');
  const elsewhere = zone.querySelector<HTMLElement>('[data-voted-elsewhere]');
  if (vote) vote.hidden = payload.status !== 'not_voted';
  if (show) show.hidden = payload.status !== 'voted_here';
  if (elsewhere) {
    elsewhere.hidden = payload.status !== 'voted_elsewhere';
    if (!elsewhere.hidden) {
      const name = document.documentElement.lang === 'kn' ? payload.wardNameKn : payload.wardNameEn;
      elsewhere.textContent = (zone.dataset.msgVotedElsewhere ?? '').replace('{ward}', name ?? String(payload.wardId ?? ''));
    }
  }
}
async function loadStatus(zone: HTMLElement): Promise<void> {
  try {
    const res = await fetch(`/api/issue-votes?wardId=${zone.dataset.wardId}`);
    if (res.ok) applyStatus(zone, await res.json());
  } catch { /* Keep the anonymous-safe default action visible. */ }
}
function renderResults(zone: HTMLElement, results: Array<{ titleEn: string | null; titleKn: string | null; count: number; sharePct: number }>): void {
  const list = zone.querySelector<HTMLOListElement>('[data-vote-results]');
  if (!list) return;
  const lang = document.documentElement.lang === 'kn' ? 'kn' : 'en';
  list.replaceChildren(...results.filter((result) => result.count > 0).map((result) => {
    const li = document.createElement('li');
    const title = lang === 'kn' ? (result.titleKn ?? result.titleEn) : (result.titleEn ?? result.titleKn);
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

async function submitVote(event: SubmitEvent): Promise<void> {
  event.preventDefault(); if (!dialog || !current) return;
  const issueIds = checkboxes().filter((box) => box.checked).map((box) => Number(box.value));
  if (issueIds.length !== 3) return;
  const submit = dialog.querySelector<HTMLButtonElement>('[data-vote-submit]'); if (submit) submit.disabled = true;
  const token = await captchaToken(current.recaptchaSiteKey ?? '');
  if (!token) { setError('verification'); refresh(); return; }
  try {
    const res = await fetch('/api/issue-votes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wardId: current.wardId, issueIds, recaptchaToken: token }) });
    if (!res.ok) { setError(res.status === 429 ? 'rate-limit' : res.status === 403 ? 'verification' : 'generic'); refresh(); return; }
    const zone = zoneFor(current.wardId); if (zone) applyStatus(zone, { status: 'voted_here' });
    controller?.close(); showToast();
  } catch { setError('generic'); refresh(); }
}

export function openVoteModal(options: OpenVoteModalOptions, trigger?: FocusTarget): void {
  if (!dialog || !controller) return; current = options; opener = trigger ?? null;
  dialog.querySelectorAll<HTMLElement>('.form-error').forEach((node) => { node.hidden = true; });
  renderOptions(options.issues); controller.open(opener);
}

export function initVoteModal(root: ParentNode = document): void {
  dialog = root.querySelector<HTMLDialogElement>('[data-vote-modal]');
  if (!dialog) return; controller = new ModalController(dialog as unknown as ModalDialogLike);
  dialog.querySelector('[data-vote-form]')?.addEventListener('submit', (event) => void submitVote(event as SubmitEvent));
  dialog.querySelector('[data-vote-issue-options]')?.addEventListener('change', refresh);
  root.querySelectorAll<HTMLElement>('[data-issue-vote-zone]').forEach((zone) => {
    void loadStatus(zone);
    zone.querySelector<HTMLElement>('[data-vote-action]')?.addEventListener('click', (event) => {
      const target = event.currentTarget as HTMLElement;
      openVoteModal({ wardId: Number(zone.dataset.wardId), issues: JSON.parse(zone.dataset.voteIssues ?? '[]'), recaptchaSiteKey: zone.dataset.recaptchaSiteKey ?? '' }, target as FocusTarget);
    });
    zone.querySelector<HTMLElement>('[data-show-results]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
      try { const res = await fetch(`/api/issue-votes?wardId=${zone.dataset.wardId}&results=1`); if (res.ok) renderResults(zone, (await res.json()).results); }
      finally { button.disabled = false; }
    });
  });
  window.bvOpenVoteModal = openVoteModal;
}

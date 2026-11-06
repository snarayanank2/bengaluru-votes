/**
 * Anonymous candidate reporting. The citizen ticks one or more targets (the
 * candidate's fields, and "Other"); each ticked target shows its own
 * correction block. One submit sends one request carrying every ticked
 * target. Every failed submission preserves what was typed.
 */
import { ModalController, type ModalDialogLike, type FocusTarget } from './ModalShell';

export type FlagTargetType = 'candidate_field' | 'candidate_other';

export interface FlagTarget {
  targetType: FlagTargetType;
  targetRef: string;
  label: string;
}

export interface OpenFlagModalOptions {
  wardId: number;
  targets: FlagTarget[];
  /** Whose report card this is about, shown above the form so a page with several candidates is unambiguous. */
  candidateName?: string;
}

interface FlagTargetPayload {
  targetType: FlagTargetType;
  targetRef: string;
  detail: string;
  suggestedValue: string | null;
  sourceUrl: string | null;
}

interface FlagResultRow {
  targetRef: string;
  state: 'accepted' | 'duplicate' | 'already_reported' | 'already_reviewed';
}

interface Elements {
  dialog: HTMLDialogElement;
  controller: ModalController;
  form: HTMLFormElement;
  targetOptions: HTMLElement;
  blocks: HTMLElement;
  blockTemplate: HTMLTemplateElement;
  rateLimitError: HTMLElement;
  genericError: HTMLElement;
  submitButton: HTMLButtonElement;
  msgRateLimit: string;
  msgSourceInvalid: string;
  msgGenericError: string;
  msgSuccess: string;
}

let els: Elements | null = null;
let currentTargets: FlagTarget[] = [];

function text(root: ParentNode, selector: string): string {
  return root.querySelector(selector)?.textContent ?? '';
}

function findElements(root: ParentNode): Elements | null {
  const dialog = root.querySelector<HTMLDialogElement>('[data-flag-modal]');
  const form = dialog?.querySelector<HTMLFormElement>('[data-flag-form]');
  const targetOptions = dialog?.querySelector<HTMLElement>('[data-flag-target-options]');
  const blocks = dialog?.querySelector<HTMLElement>('[data-flag-blocks]');
  const blockTemplate = dialog?.querySelector<HTMLTemplateElement>('[data-flag-block-template]');
  const rateLimitError = dialog?.querySelector<HTMLElement>('[data-flag-rate-limit-error]');
  const genericError = dialog?.querySelector<HTMLElement>('[data-flag-generic-error]');
  const submitButton = form?.querySelector<HTMLButtonElement>('[data-flag-submit]');

  if (!dialog || !form || !targetOptions || !blocks || !blockTemplate || !rateLimitError || !genericError || !submitButton) {
    return null;
  }

  return {
    dialog,
    // A form must not lose typed text to a stray click: close only via × and Escape.
    controller: new ModalController(dialog as unknown as ModalDialogLike, { closeOnScrim: false }),
    form,
    targetOptions,
    blocks,
    blockTemplate,
    rateLimitError,
    genericError,
    submitButton,
    msgRateLimit: text(dialog, '[data-msg-rate-limit]'),
    msgSourceInvalid: text(dialog, '[data-msg-source-invalid]'),
    msgGenericError: text(dialog, '[data-msg-generic-error]'),
    msgSuccess: text(dialog, '[data-msg-success]'),
  };
}

const isOther = (target: FlagTarget): boolean => target.targetType === 'candidate_other';

function blockFor(targetRef: string): HTMLElement | null {
  if (!els) return null;
  return Array.from(els.blocks.querySelectorAll<HTMLElement>('[data-flag-block]')).find((b) => b.dataset.targetRef === targetRef) ?? null;
}

/** Shows or hides one target's block; a hidden block's controls are disabled so they neither validate nor submit. */
function setBlockShown(block: HTMLElement, shown: boolean): void {
  block.hidden = !shown;
  for (const control of block.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) control.disabled = !shown;
}

/** Builds one correction block per target (hidden until its target is ticked). */
function renderBlocks(container: HTMLElement, template: HTMLTemplateElement, targets: FlagTarget[]): void {
  container.innerHTML = '';
  for (const [index, target] of targets.entries()) {
    const block = (template.content.cloneNode(true) as DocumentFragment).querySelector<HTMLElement>('[data-flag-block]')!;
    block.dataset.targetRef = target.targetRef;
    block.querySelector('[data-flag-source-error]')!.id = `flag-source-error-${index}`;
    block.querySelector('[data-flag-block-title]')!.textContent = target.label;
    const detailLabel = block.querySelector<HTMLLabelElement>('[data-flag-detail-label]')!;
    detailLabel.textContent = (isOther(target) ? detailLabel.dataset.labelOther : detailLabel.dataset.labelDefault) ?? '';
    const detail = block.querySelector<HTMLTextAreaElement>('textarea[name="detail"]')!;
    const source = block.querySelector<HTMLInputElement>('input[name="sourceUrl"]')!;
    const suggested = block.querySelector<HTMLInputElement>('input[name="suggestedValue"]')!;
    detail.id = `flag-detail-${index}`;
    source.id = `flag-source-${index}`;
    suggested.id = `flag-suggested-${index}`;
    detailLabel.htmlFor = detail.id;
    block.querySelector<HTMLLabelElement>('[data-flag-source-label]')!.htmlFor = source.id;
    block.querySelector<HTMLLabelElement>('[data-flag-suggested-label]')!.htmlFor = suggested.id;
    if (isOther(target)) {
      block.querySelector<HTMLElement>('[data-flag-block-help]')!.hidden = false;
      block.querySelector('[data-flag-suggested-field]')!.remove();
    }
    container.append(block);
    setBlockShown(block, false);
  }
}

/** Renders the picker: a checkbox per target, or — with exactly one target — its label, pre-selected. */
function renderTargetPicker(container: HTMLElement, targets: FlagTarget[]): void {
  container.innerHTML = '';

  if (targets.length === 1) {
    const p = document.createElement('p');
    p.className = 'flag-target-single';
    p.textContent = targets[0]!.label;
    container.append(p);
    return;
  }

  for (const target of targets) {
    const label = document.createElement('label');
    label.className = 'flag-target-option';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.name = 'targetRef';
    box.value = target.targetRef;
    box.addEventListener('change', () => {
      const block = blockFor(target.targetRef);
      if (block) setBlockShown(block, box.checked);
      clearErrors();
    });
    label.append(box, document.createTextNode(target.label));
    container.append(label);
  }
}

function selectedTargets(): FlagTarget[] {
  if (currentTargets.length === 1) return currentTargets;
  const ticked = new Set(Array.from(els?.form.querySelectorAll<HTMLInputElement>('input[name="targetRef"]:checked') ?? []).map((box) => box.value));
  return currentTargets.filter((target) => ticked.has(target.targetRef));
}

function clearErrors(): void {
  if (!els) return;
  els.rateLimitError.hidden = true;
  els.rateLimitError.textContent = '';
  els.genericError.hidden = true;
  els.genericError.textContent = '';
  for (const e of els.blocks.querySelectorAll<HTMLElement>('[data-flag-source-error]')) {
    e.hidden = true;
    e.textContent = '';
  }
  for (const input of els.blocks.querySelectorAll<HTMLInputElement>('input[name="sourceUrl"]')) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }
}

/** "Please try again in about N minutes/hours", singular and plural keyed separately. Falls back to the generic message without a hint. */
function rateLimitMessage(retryAfterSeconds: number | null): string {
  if (!els || !retryAfterSeconds || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) return els?.msgRateLimit ?? '';
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  const [key, n] = minutes >= 60 ? [Math.round(minutes / 60) === 1 ? 'hour' : 'hours', Math.round(minutes / 60)] : [minutes === 1 ? 'minute' : 'minutes', minutes];
  return (text(els.dialog, `[data-msg-rate-limit-${key}]`) || els.msgRateLimit).replace('{n}', String(n));
}

function showRateLimitError(retryAfterSeconds: number | null): void {
  if (!els) return;
  els.rateLimitError.hidden = false;
  els.rateLimitError.textContent = rateLimitMessage(retryAfterSeconds);
}

function showGenericError(): void {
  if (!els) return;
  els.genericError.hidden = false;
  els.genericError.textContent = els.msgGenericError;
}

function setSubmitDisabled(disabled: boolean): void {
  if (els) els.submitButton.disabled = disabled;
}

/**
 * Ephemeral bottom toast (design-system.md §7.12, `.flag-success-toast` in
 * src/components/FlagModal.astro's global styles) announcing success —
 * created fresh so it survives the flag dialog closing.
 */
function showSuccessToast(message: string, ms = 5000): void {
  if (typeof document === 'undefined') return;
  const toast = document.createElement('div');
  toast.className = 'flag-success-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('data-flag-success-toast', '');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), ms);
}

function resetForm(): void {
  if (!els) return;
  els.form.reset();
  clearErrors();
}

async function captchaToken(): Promise<string | null> {
  const siteKey = els?.dialog.dataset.recaptchaSiteKey ?? '';
  if (!siteKey) return (!import.meta.env.PROD || ['localhost','127.0.0.1'].includes(location.hostname)) ? 'local-development' : null;
  if (!window.grecaptcha) return null;
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 8000);
    window.grecaptcha!.ready(() => {
      window.grecaptcha!.execute(siteKey,{ action:'candidate_flag' }).then(token => { clearTimeout(timer); resolve(token); }).catch(() => { clearTimeout(timer); resolve(null); });
    });
  });
}
function showFeedback(key: string): void {
  if (!els) return;
  els.genericError.hidden = false;
  els.genericError.textContent = text(els.dialog, `[data-msg-${key}]`) || els.msgGenericError;
}

async function retryAfter(res: Response): Promise<number | null> {
  try {
    const body = (await res.json()) as { retryAfterSeconds?: number };
    if (typeof body.retryAfterSeconds === 'number') return body.retryAfterSeconds;
  } catch { /* fall through to the header */ }
  const header = Number(res.headers.get('retry-after'));
  return Number.isFinite(header) && header > 0 ? header : null;
}

/** The labels of the targets a result row names, joined for a sentence. */
function labelsFor(rows: FlagResultRow[]): string {
  return rows.map((row) => currentTargets.find((target) => target.targetRef === row.targetRef)?.label ?? '').filter(Boolean).join(', ');
}

async function submitTargets(targets: FlagTargetPayload[]): Promise<void> {
  try {
    const identity = await fetch('/api/flags/identity', { method:'POST', headers:{ 'content-type':'application/json' } });
    if (!identity.ok) { if (identity.status === 429) showRateLimitError(await retryAfter(identity)); else showFeedback('paused'); return; }
    const recaptchaToken = await captchaToken();
    if (!recaptchaToken) { showFeedback('verification'); return; }
    const res = await fetch('/api/flags', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ targets, recaptchaToken }) });
    if (res.status === 429) { showRateLimitError(await retryAfter(res)); return; }
    if (!res.ok) { showFeedback(res.status === 403 ? 'verification' : res.status === 503 ? 'paused' : 'generic-error'); return; }
    const { results } = (await res.json()) as { results: FlagResultRow[] };
    const skipped = results.filter((row) => row.state !== 'accepted');
    const notAdded = skipped.length ? text(els!.dialog, '[data-msg-not-added]').replace('{fields}', labelsFor(skipped)) : '';
    if (skipped.length === results.length) {
      // Nothing was new: stay open so the citizen can untick these or add other fields.
      if (els) { els.genericError.hidden = false; els.genericError.textContent = notAdded; }
      return;
    }
    els?.controller.close();
    if (els) showSuccessToast(notAdded ? `${els.msgSuccess} ${notAdded}` : els.msgSuccess, notAdded ? 9000 : 5000);
    resetForm();
  } catch { showGenericError(); }
}

/** Reads every ticked target's block; reports the first problem (nothing ticked, or a bad source link) and returns null. */
function captureTargets(): FlagTargetPayload[] | null {
  if (!els) return null;
  const chosen = selectedTargets();
  if (chosen.length === 0) {
    els.genericError.hidden = false;
    els.genericError.textContent = text(els.dialog, '[data-msg-select-one]');
    els.form.querySelector<HTMLInputElement>('input[name="targetRef"]')?.focus();
    return null;
  }
  const payload: FlagTargetPayload[] = [];
  for (const target of chosen) {
    const block = blockFor(target.targetRef)!;
    const detail = block.querySelector<HTMLTextAreaElement>('textarea[name="detail"]')!.value.trim();
    const source = block.querySelector<HTMLInputElement>('input[name="sourceUrl"]')!;
    const sourceUrl = source.value.trim() || null;
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
      const error = block.querySelector<HTMLElement>('[data-flag-source-error]')!;
      error.hidden = false;
      error.textContent = els.msgSourceInvalid;
      source.setAttribute('aria-invalid', 'true');
      source.setAttribute('aria-describedby', error.id);
      source.focus();
      return null;
    }
    if (!detail) return null; // native `required` reports the empty case
    payload.push({
      targetType: target.targetType,
      targetRef: target.targetRef,
      detail,
      suggestedValue: block.querySelector<HTMLInputElement>('input[name="suggestedValue"]')?.value.trim() || null,
      sourceUrl,
    });
  }
  return payload;
}

async function onSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!els) return;

  clearErrors();
  if (selectedTargets().length === 0) { captureTargets(); return; }
  if (!els.form.reportValidity()) return;
  const payload = captureTargets();
  if (!payload) return;

  setSubmitDisabled(true);
  try {
    await submitTargets(payload);
  } finally {
    setSubmitDisabled(false);
  }
}

function wireForm(e: Elements): void {
  e.form.addEventListener('submit', (event) => {
    void onSubmit(event);
  });
}

/** Shows the flag form directly — resets any prior state and (re)builds the picker and blocks for `opts.targets`. */
function showFlagForm(opts: OpenFlagModalOptions, opener?: FocusTarget | null): void {
  if (!els) return;

  currentTargets = opts.targets;

  resetForm();
  const candidate = els.dialog.querySelector<HTMLElement>('[data-flag-candidate]');
  if (candidate) {
    candidate.textContent = opts.candidateName ?? '';
    candidate.hidden = !opts.candidateName;
  }
  renderTargetPicker(els.targetOptions, opts.targets);
  renderBlocks(els.blocks, els.blockTemplate, opts.targets);
  // One target is pre-selected; with several, the citizen chooses.
  if (opts.targets.length === 1) {
    const block = blockFor(opts.targets[0]!.targetRef);
    if (block) setBlockShown(block, true);
  }

  els.controller.open(opener ?? undefined);
}

export function openFlagModal(opts: OpenFlagModalOptions, opener?: FocusTarget | null): void {
  if (!els) {
    els = findElements(document);
    if (!els) return;
    wireForm(els);
  }

  showFlagForm(opts, opener);
}

declare global {
  interface Window {
    bvOpenFlagModal?: typeof openFlagModal;
  }
}

function parseTargets(raw: string | undefined): FlagTarget[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is FlagTarget =>
        t &&
        typeof t.targetRef === 'string' &&
        typeof t.label === 'string' &&
        (t.targetType === 'candidate_field' || t.targetType === 'candidate_other'),
    );
  } catch {
    return [];
  }
}

/**
 * Wires every `[data-flag-action]` element on the page (Ward.astro,
 * Ward.astro and Candidate.astro) to open this modal
 * with its own `data-ward-id`/`data-flag-targets` (JSON-encoded
 * `FlagTarget[]`), and exposes `window.bvOpenFlagModal` for anything else
 * that wants to open it directly.
 */
export function initFlagModal(root: ParentNode = document): void {
  window.bvOpenFlagModal = openFlagModal;

  for (const el of root.querySelectorAll<HTMLElement>('[data-flag-action]')) {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      const wardId = Number(el.dataset.wardId);
      const targets = parseTargets(el.dataset.flagTargets);
      if (!Number.isFinite(wardId) || targets.length === 0) return;
      openFlagModal({ wardId, targets, candidateName: el.dataset.candidateName }, el);
    });
  }
}

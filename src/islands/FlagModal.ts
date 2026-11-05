/** Anonymous candidate reporting: preserve the form on every failed submission. */
import { ModalController, type ModalDialogLike, type FocusTarget } from './ModalShell';

export type FlagTargetType = 'candidate_field';

export interface FlagTarget {
  targetType: FlagTargetType;
  targetRef: string;
  label: string;
}

export interface OpenFlagModalOptions {
  wardId: number;
  targets: FlagTarget[];
}

interface FlagFormState {
  wardId: number;
  targetType: FlagTargetType;
  targetRef: string;
  detail: string;
  suggestedValue: string | null;
  sourceUrl: string | null;
}



interface Elements {
  dialog: HTMLDialogElement;
  controller: ModalController;
  form: HTMLFormElement;
  targetOptions: HTMLElement;
  detailInput: HTMLTextAreaElement;
  sourceInput: HTMLInputElement;
  suggestedInput: HTMLInputElement;
  sourceError: HTMLElement;
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
let currentWardId = 0;

function text(root: ParentNode, selector: string): string {
  return root.querySelector(selector)?.textContent ?? '';
}

function findElements(root: ParentNode): Elements | null {
  const dialog = root.querySelector<HTMLDialogElement>('[data-flag-modal]');
  const form = dialog?.querySelector<HTMLFormElement>('[data-flag-form]');
  const targetOptions = dialog?.querySelector<HTMLElement>('[data-flag-target-options]');
  const detailInput = form?.querySelector<HTMLTextAreaElement>('textarea[name="detail"]');
  const sourceInput = form?.querySelector<HTMLInputElement>('input[name="sourceUrl"]');
  const suggestedInput = form?.querySelector<HTMLInputElement>('input[name="suggestedValue"]');
  const sourceError = dialog?.querySelector<HTMLElement>('[data-flag-source-error]');
  const rateLimitError = dialog?.querySelector<HTMLElement>('[data-flag-rate-limit-error]');
  const genericError = dialog?.querySelector<HTMLElement>('[data-flag-generic-error]');
  const submitButton = form?.querySelector<HTMLButtonElement>('[data-flag-submit]');

  if (
    !dialog ||
    !form ||
    !targetOptions ||
    !detailInput ||
    !sourceInput ||
    !suggestedInput ||
    !sourceError ||
    !rateLimitError ||
    !genericError ||
    !submitButton
  ) {
    return null;
  }

  return {
    dialog,
    controller: new ModalController(dialog as unknown as ModalDialogLike),
    form,
    targetOptions,
    detailInput,
    sourceInput,
    suggestedInput,
    sourceError,
    rateLimitError,
    genericError,
    submitButton,
    msgRateLimit: text(dialog, '[data-msg-rate-limit]'),
    msgSourceInvalid: text(dialog, '[data-msg-source-invalid]'),
    msgGenericError: text(dialog, '[data-msg-generic-error]'),
    msgSuccess: text(dialog, '[data-msg-success]'),
  };
}

/** Renders the field/claim picker: a single pre-selected (hidden-input) target, or a radio list when there's more than one. */
function renderTargetPicker(container: HTMLElement, targets: FlagTarget[]): void {
  container.innerHTML = '';

  if (targets.length <= 1) {
    const target = targets[0];
    if (!target) return;
    const p = document.createElement('p');
    p.className = 'flag-target-single';
    p.textContent = target.label;
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'targetRef';
    hidden.value = target.targetRef;
    container.append(p, hidden);
    return;
  }

  for (const [index, target] of targets.entries()) {
    const label = document.createElement('label');
    label.className = 'flag-target-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'targetRef';
    radio.value = target.targetRef;
    radio.checked = index === 0;
    label.append(radio, document.createTextNode(target.label));
    container.append(label);
  }
}

function getSelectedTargetRef(form: HTMLFormElement): string | null {
  const checked = form.querySelector<HTMLInputElement>('input[name="targetRef"]:checked');
  if (checked) return checked.value;
  const hidden = form.querySelector<HTMLInputElement>('input[name="targetRef"][type="hidden"]');
  return hidden ? hidden.value : null;
}

function clearErrors(): void {
  if (!els) return;
  els.sourceError.hidden = true;
  els.sourceError.textContent = '';
  els.rateLimitError.hidden = true;
  els.rateLimitError.textContent = '';
  els.genericError.hidden = true;
  els.genericError.textContent = '';
}

function showRateLimitError(): void {
  if (!els) return;
  els.rateLimitError.hidden = false;
  els.rateLimitError.textContent = els.msgRateLimit;
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
function showSuccessToast(message: string): void {
  if (typeof document === 'undefined') return;
  const toast = document.createElement('div');
  toast.className = 'flag-success-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('data-flag-success-toast', '');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
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
async function submitFlagState(state: FlagFormState): Promise<void> {
  try {
    const identity = await fetch('/api/flags/identity', { method:'POST', headers:{ 'content-type':'application/json' } });
    if (!identity.ok) { if (identity.status === 429) showRateLimitError(); else showFeedback('paused'); return; }
    const recaptchaToken = await captchaToken();
    if (!recaptchaToken) { showFeedback('verification'); return; }
    const res = await fetch('/api/flags', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ ...state,recaptchaToken }) });
    if (res.status === 429) { showRateLimitError(); return; }
    if (!res.ok) { showFeedback(res.status === 403 ? 'verification' : res.status === 503 ? 'paused' : 'generic-error'); return; }
    const result = await res.json();
    if (result.state === 'already_reported') { showFeedback('already-reported'); return; }
    els?.controller.close();
    if (els) showSuccessToast(result.state === 'already_reviewed' ? text(els.dialog,'[data-msg-already-reviewed]') : els.msgSuccess);
    resetForm();
  } catch { showGenericError(); }
}

function captureState(form: HTMLFormElement): FlagFormState | null {
  const targetRef = getSelectedTargetRef(form);
  const target = currentTargets.find((t) => t.targetRef === targetRef);
  if (!targetRef || !target) return null;

  const detail = els?.detailInput.value.trim() ?? '';
  if (!detail) return null; // native `required` handles the empty case in real usage

  const sourceUrl = els?.sourceInput.value.trim() || null;
  const suggestedValue = els?.suggestedInput.value.trim() || null;

  return {
    wardId: currentWardId,
    targetType: target.targetType,
    targetRef,
    detail,
    suggestedValue,
    sourceUrl,
  };
}

async function onSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!els) return;

  if (!els.form.reportValidity()) return;
  const state = captureState(els.form);
  if (!state) return;

  clearErrors();
  setSubmitDisabled(true);
  try {
    await submitFlagState(state);
  } finally {
    setSubmitDisabled(false);
  }
}

function wireForm(e: Elements): void {
  e.form.addEventListener('submit', (event) => {
    void onSubmit(event);
  });
}

/** Shows the flag form directly — resets any prior state and (re)builds the picker for `opts.targets`. */
function showFlagForm(opts: OpenFlagModalOptions, opener?: FocusTarget | null): void {
  if (!els) return;

  currentWardId = opts.wardId;
  currentTargets = opts.targets;

  resetForm();
  renderTargetPicker(els.targetOptions, opts.targets);

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
        t.targetType === 'candidate_field',
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
      openFlagModal({ wardId, targets }, el);
    });
  }
}

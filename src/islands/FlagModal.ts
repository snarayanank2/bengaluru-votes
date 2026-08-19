/**
 * Flag misinformation modal — the client-side half of Task 32 (IA §7.2,
 * PRD §6.1/§6.3). Built on `ModalController` (src/islands/ModalShell.ts)
 * over the `<dialog>` markup `src/components/FlagModal.astro` renders once
 * per page (from Base.astro, so it's present everywhere a "Flag an error"
 * action can appear — Ward.astro and Candidate.astro today;
 * in Task 41).
 *
 * GLOBAL OPENER + WIRING: `openFlagModal` is exported AND attached to
 * `window.bvOpenFlagModal`, and `initFlagModal` additionally wires every
 * `[data-flag-action]` element found on the page (its `data-ward-id` and
 * `data-flag-targets` — a JSON-encoded `FlagTarget[]` — carry everything
 * `openFlagModal` needs) so Ward.astro/Candidate.astro
 * never need their own per-page wiring script, mirroring how
 * `initRegisterLoginModal` wires `[data-me-slot]`/`[data-register-slot]`
 * from one call in Base.astro.
 *
 * AUTH GATING + RESUME (core concept 2 — "visible to all, gated at
 * submit"; IA §7.2 "if anonymous, the Register/Login modal shows first,
 * then this reopens"):
 *
 *   - ON OPEN: `openFlagModal` checks `/api/me` before ever showing the
 *     flag form. Anonymous -> `window.bvOpenRegisterLogin` opens FIRST,
 *     with `onSuccess: () => openFlagModal(opts)` — once auth completes,
 *     THIS function runs again, now authed, and shows the (still-empty,
 *     nothing was ever typed) flag form. Authed -> the flag form shows
 *     immediately.
 *   - ON SUBMIT: the already-open flag dialog is deliberately left open
 *     (not closed) while `window.bvOpenRegisterLogin` opens on top of it —
 *     native `<dialog>` supports stacked modals, and this means a 401 mid-
 *     flow (an idle-timed-out session) needs no separate "reopen with
 *     saved state" plumbing: the flag dialog was never torn down, so its
 *     fields (target, detail, source, suggested value) are exactly as the
 *     citizen left them. `onSuccess` re-POSTs the SAME captured request
 *     body directly (seamless resume, no need for the citizen to retype or
 *     even re-tap submit). If that resumed POST itself fails (429/400),
 *     the flag dialog is right there, still open, to show the inline
 *     error — the same code path a normal (non-resumed) failure uses.
 *
 * The URL never changes at any point in this flow — nothing here calls
 * `location.assign`/`history.pushState`/etc.
 */
import { ModalController, type ModalDialogLike, type FocusTarget } from './ModalShell';

export type FlagTargetType = 'candidate_field' | 'ward_field' | 'ward_issue';

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

type MeResponse = { anonymous: true } | { anonymous: false; [key: string]: unknown };

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

async function fetchMe(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return null;
    return (await res.json()) as MeResponse;
  } catch {
    return null;
  }
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

function showSourceError(): void {
  if (!els) return;
  els.sourceError.hidden = false;
  els.sourceError.textContent = els.msgSourceInvalid;
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

async function postFlag(state: FlagFormState): Promise<Response> {
  return fetch('/api/flags', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state),
  });
}

/**
 * Submits `state` and handles every outcome, INCLUDING re-submitting it
 * automatically once auth resumes on a 401 — see the module header's
 * "AUTH GATING + RESUME" note for why the flag dialog is deliberately left
 * open (not closed) across that handoff.
 */
async function submitFlagState(state: FlagFormState): Promise<void> {
  let res: Response;
  try {
    res = await postFlag(state);
  } catch {
    showGenericError();
    return;
  }

  if (res.status === 401) {
    window.bvOpenRegisterLogin?.({
      onSuccess: () => {
        void submitFlagState(state);
      },
    });
    return;
  }

  if (res.status === 429) {
    showRateLimitError();
    return;
  }

  if (res.status === 400) {
    showSourceError();
    return;
  }

  if (res.ok) {
    els?.controller.close();
    if (els) showSuccessToast(els.msgSuccess);
    resetForm();
    return;
  }

  showGenericError();
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

/** Shows the flag form itself (called once auth is confirmed) — resets any prior state and (re)builds the picker for `opts.targets`. */
function showFlagForm(opts: OpenFlagModalOptions, opener?: FocusTarget | null): void {
  if (!els) return;

  currentWardId = opts.wardId;
  currentTargets = opts.targets;

  resetForm();
  renderTargetPicker(els.targetOptions, opts.targets);

  els.controller.open(opener ?? undefined);
}

/**
 * Opens the Flag misinformation modal (IA §7.2). Anonymous visitors are
 * shown Register/Login FIRST — this function itself re-runs as that
 * flow's `onSuccess`, so `opts` (the SAME targets/wardId) is preserved
 * across the handoff with no extra state-passing needed. Safe no-op if the
 * modal markup isn't present on this page.
 */
export function openFlagModal(opts: OpenFlagModalOptions, opener?: FocusTarget | null): void {
  if (!els) {
    els = findElements(document);
    if (!els) return;
    wireForm(els);
  }

  void fetchMe().then((me) => {
    if (!me || me.anonymous) {
      window.bvOpenRegisterLogin?.({
        onSuccess: () => openFlagModal(opts, opener),
      });
      return;
    }

    showFlagForm(opts, opener);
  });
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
        (t.targetType === 'candidate_field' || t.targetType === 'ward_field' || t.targetType === 'ward_issue'),
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

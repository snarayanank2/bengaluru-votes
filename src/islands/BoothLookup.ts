/**
 * BoothLookup handles the homepage voter-ID form through
 * `POST /api/booth-lookup`, painting the result inline. Public booth lookup
 * requires JavaScript now that the standalone guide routes are removed.
 * `initBoothLookup` wires every `[data-booth-lookup]` form it finds.
 *
 * INPUT IS AN EPIC NUMBER (voter ID), not an address — see
 * src/pages/api/booth-lookup.ts for why the address mode was removed.
 *
 * PRIVACY: the response carries the voter's own name and EPIC. This module
 * paints them into the DOM and does nothing else with them — no storage, no
 * analytics call, no URL rewrite. Nothing personal may be added to any of
 * those; the result must stay as ephemeral as the request.
 *
 * NEVER FALLS BACK TO A NATIVE SUBMIT. The old `/voting-guide/find-booth`
 * route is gone (architecture §15), so every failure is answered in place:
 * a 400 says the number is malformed (`invalid`), and a timeout, network
 * error, non-2xx or unreadable body says the roll is unavailable and points
 * at the official finder (`unavailable`). While a request is pending the
 * result region says so (`searching`), and the request is abandoned after
 * `LOOKUP_TIMEOUT_MS` so a stalled upstream never leaves the visitor
 * watching a disabled button.
 *
 * The directions link is built by the shared src/lib/maps-links.ts helper
 * from the lat/lng the API already returns — no separate API call.
 * BoothLookupForm.astro's server-rendered result (used only by the unrouted
 * FindBooth.astro) renders the identical link from the same helper; keep
 * both in sync rather than letting one drift.
 */
import { directionsUrl } from '../lib/maps-links';
import { formatWardLabel } from '../lib/ward-label-format';

interface WardPayload {
  id: number;
  nameEn: string;
  nameKn: string;
  corporation: string;
}

interface BoothPayload {
  nameEn: string;
  nameKn: string;
  serialNo: number;
  lat: number;
  lng: number;
}

interface VoterPayload {
  epic: string;
  nameEn: string;
  nameKn: string;
}

type LookupResponse =
  | { result: 'booth'; voter: VoterPayload; ward: WardPayload | null; booth: BoothPayload }
  | { result: 'not_found' }
  | { result: 'unavailable'; reason?: string }
  | { result: 'invalid' };

/** Longer than the server's own upstream timeout, short enough to give up on a stalled connection. */
export const LOOKUP_TIMEOUT_MS = 15000;

interface Messages {
  registeredAs: string;
  wardLabel: string;
  wardTemplate: string;
  boothLabel: string;
  serialNo: string;
  wardUnknown: string;
  notFound: string;
  unavailable: string;
  invalid: string;
  searching: string;
  directions: string;
  directionsAria: string;
}

/**
 * Kannada if we have it and the page is Kannada; English otherwise. Upstream
 * ships an empty string rather than omitting the field when a record has no
 * Kannada text, hence the truthiness check rather than a null check.
 */
function pick(lang: string, en: string, kn: string): string {
  return lang === 'kn' && kn ? kn : en;
}

function para(text: string, className?: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.textContent = text;
  if (className) p.className = className;
  return p;
}

function section(label: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'booth-section';
  const heading = document.createElement('p');
  heading.className = 'booth-section-label';
  heading.textContent = label;
  wrapper.appendChild(heading);
  return wrapper;
}

function wardHref(lang: string, wardId: number): string {
  return lang === 'kn' ? `/kn/ward/${wardId}` : `/ward/${wardId}`;
}

function renderBooth(
  container: HTMLElement,
  lang: string,
  msgs: Messages,
  data: Extract<LookupResponse, { result: 'booth' }>,
): void {
  const root = document.createElement('div');
  root.className = 'booth-card';

  // Who the roll says this is — the citizen's own check that they typed
  // their number, not a stranger's.
  const who = section(msgs.registeredAs);
  who.appendChild(para(pick(lang, data.voter.nameEn, data.voter.nameKn), 'booth-voter-name'));
  who.appendChild(para(data.voter.epic, 'booth-epic'));
  root.appendChild(who);

  const ward = section(msgs.wardLabel);
  if (data.ward) {
    const link = document.createElement('a');
    link.href = wardHref(lang, data.ward.id);
    link.textContent = formatWardLabel(msgs.wardTemplate, lang, data.ward);
    ward.appendChild(link);
  } else {
    ward.appendChild(para(msgs.wardUnknown));
  }
  root.appendChild(ward);

  const booth = section(msgs.boothLabel);
  const boothName = pick(lang, data.booth.nameEn, data.booth.nameKn);
  booth.appendChild(para(boothName, 'booth-name'));
  // `t()` on the server leaves `{serialNo}` intact when called without vars
  // (src/i18n/index.ts) — this island imports no i18n table by design, so the
  // server hands over the template and the substitution happens here.
  booth.appendChild(para(msgs.serialNo.replace(/\{serialNo\}/g, () => String(data.booth.serialNo)), 'booth-serial'));

  const directions = document.createElement('a');
  directions.className = 'booth-directions';
  directions.href = directionsUrl(String(data.booth.lat), String(data.booth.lng));
  directions.target = '_blank';
  directions.rel = 'noopener noreferrer';
  directions.textContent = msgs.directions;
  directions.setAttribute('aria-label', msgs.directionsAria.replace(/\{boothName\}/g, () => boothName));
  booth.appendChild(directions);
  root.appendChild(booth);

  container.replaceChildren(root);
}

function renderResult(
  container: HTMLElement,
  lang: string,
  msgs: Messages,
  data: LookupResponse,
): void {
  switch (data.result) {
    case 'booth':
      renderBooth(container, lang, msgs, data);
      return;
    case 'not_found':
      container.replaceChildren(para(msgs.notFound));
      return;
    case 'unavailable':
      // Every reason — timeout, failed, malformed, budget — is one message:
      // the citizen's next step is identical (see the i18n hint).
      container.replaceChildren(para(msgs.unavailable));
      return;
    case 'invalid':
      container.replaceChildren(para(msgs.invalid));
      return;
  }
}

let nextResultId = 1;

function wire(form: HTMLFormElement): void {
  const input = form.querySelector<HTMLInputElement>('input[name="epic"]');
  const result = form.querySelector<HTMLElement>('[data-booth-result]');
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!input || !result) return;

  const lang = form.dataset.lang ?? 'en';
  const msgs: Messages = {
    registeredAs: form.dataset.msgRegisteredAs ?? '',
    wardLabel: form.dataset.msgWardLabel ?? '',
    wardTemplate: form.dataset.msgWardTemplate ?? '',
    boothLabel: form.dataset.msgBoothLabel ?? '',
    serialNo: form.dataset.msgSerialNo ?? '',
    wardUnknown: form.dataset.msgWardUnknown ?? '',
    notFound: form.dataset.msgNotFound ?? '',
    unavailable: form.dataset.msgUnavailable ?? '',
    invalid: form.dataset.msgInvalid ?? '',
    searching: form.dataset.msgSearching ?? '',
    directions: form.dataset.msgDirections ?? '',
    directionsAria: form.dataset.msgDirectionsAria ?? '',
  };

  // A number the app refuses is an invalid field (design-system §7.10): mark
  // it so assistive technology links the field to the message in the result
  // region, and drop the mark as soon as it is edited or re-submitted.
  if (!result.id) result.id = `booth-result-${nextResultId++}`;
  const markInvalid = (): void => {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', result.id);
  };
  const markValid = (): void => {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  };
  input.addEventListener('input', markValid);

  form.addEventListener('submit', (event) => {
    const value = input.value.trim();
    event.preventDefault();
    markValid();
    if (!value) {
      // The form is `novalidate`, so an empty field is answered here, inline,
      // instead of with the browser's own bubble.
      result.replaceChildren(para(msgs.invalid));
      markInvalid();
      input.focus();
      return;
    }
    if (submitButton) submitButton.disabled = true;
    result.setAttribute('aria-busy', 'true');
    // The result region is the live region: say what is happening before the
    // answer arrives, so a slow lookup never looks like a dead button.
    result.replaceChildren(para(msgs.searching));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

    fetch('/api/booth-lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ epic: value }),
      signal: controller.signal,
    })
      .then((res): Promise<LookupResponse> => {
        // The endpoint answers 400 only for a number that cannot be a voter ID.
        if (res.status === 400) return Promise.resolve({ result: 'invalid' });
        if (!res.ok) throw new Error(`booth-lookup: ${res.status}`);
        return res.json() as Promise<LookupResponse>;
      })
      .catch((): LookupResponse => ({ result: 'unavailable', reason: 'failed' }))
      .then((data) => {
        renderResult(result, lang, msgs, data);
        if (data.result === 'invalid') markInvalid();
      })
      .finally(() => {
        clearTimeout(timer);
        if (submitButton) submitButton.disabled = false;
        result.removeAttribute('aria-busy');
      });
  });
}

/**
 * Wires up every `[data-booth-lookup]` form under `root` (defaults to the
 * whole document). Safe to call when no such form is present (does nothing).
 */
export function initBoothLookup(root: ParentNode = document): void {
  for (const form of root.querySelectorAll<HTMLFormElement>('[data-booth-lookup]')) {
    wire(form);
  }
}

/**
 * BoothLookup — progressive enhancement over the voter-ID booth-lookup
 * `<form>`, mirroring src/islands/WardLookup.ts's structure exactly.
 *
 * The form is a real `<form method="post">` that works with zero JS: a plain
 * submit POSTs to /voting-guide/find-booth and that page's own
 * `Astro.request.method === 'POST'` branch server-renders the result through
 * the same `lookupBoothByEpic` the API route uses. This module intercepts the
 * submit, calls `POST /api/booth-lookup` instead, and paints the result
 * inline so a JS-capable visitor never leaves the page.
 *
 * TWO MOUNT POINTS, one implementation: the find-booth page and the home
 * page's booth card both render `[data-booth-lookup]`, and the home card's
 * `action` points at the find-booth page — so a no-JS visitor who submits
 * from the home page lands on the full page with their answer, and a JS
 * visitor gets it inline without leaving home. `initBoothLookup` wires every
 * such form it finds, not just the first.
 *
 * INPUT IS AN EPIC NUMBER (voter ID), not an address — see
 * src/pages/api/booth-lookup.ts for why the address mode was removed.
 *
 * PRIVACY: the response carries the voter's own name and EPIC. This module
 * paints them into the DOM and does nothing else with them — no storage, no
 * analytics call, no URL rewrite. Nothing personal may be added to any of
 * those; the result must stay as ephemeral as the request.
 *
 * On any failure to fetch/parse — network error, non-2xx, bad JSON — this
 * lets the native form submission proceed (the no-JS server path), the same
 * fallback discipline as WardLookup.
 *
 * The directions link is built by the shared src/lib/maps-links.ts helper
 * from the lat/lng the API already returns — no separate API call. The
 * server-rendered POST branch in FindBooth.astro renders the identical link
 * from the same helper; keep both in sync rather than letting one drift.
 */
import { directionsUrl } from '../lib/maps-links';

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
  | { result: 'unavailable'; reason?: string };

interface Messages {
  registeredAs: string;
  wardLabel: string;
  boothLabel: string;
  serialNo: string;
  wardUnknown: string;
  notFound: string;
  unavailable: string;
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
    link.textContent = pick(lang, data.ward.nameEn, data.ward.nameKn);
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
  }
}

function wire(form: HTMLFormElement): void {
  const input = form.querySelector<HTMLInputElement>('input[name="epic"]');
  const result = form.querySelector<HTMLElement>('[data-booth-result]');
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!input || !result) return;

  const lang = form.dataset.lang ?? 'en';
  const msgs: Messages = {
    registeredAs: form.dataset.msgRegisteredAs ?? '',
    wardLabel: form.dataset.msgWardLabel ?? '',
    boothLabel: form.dataset.msgBoothLabel ?? '',
    serialNo: form.dataset.msgSerialNo ?? '',
    wardUnknown: form.dataset.msgWardUnknown ?? '',
    notFound: form.dataset.msgNotFound ?? '',
    unavailable: form.dataset.msgUnavailable ?? '',
    directions: form.dataset.msgDirections ?? '',
    directionsAria: form.dataset.msgDirectionsAria ?? '',
  };

  form.addEventListener('submit', (event) => {
    const value = input.value.trim();
    if (!value) return; // native `required` validation handles this

    event.preventDefault();
    if (submitButton) submitButton.disabled = true;
    result.setAttribute('aria-busy', 'true');

    fetch('/api/booth-lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ epic: value }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`booth-lookup: ${res.status}`);
        return res.json() as Promise<LookupResponse>;
      })
      .then((data) => {
        renderResult(result, lang, msgs, data);
      })
      .catch(() => {
        // Fetch/parse failed — degrade to the real no-JS submission rather
        // than leave the visitor stuck with a spinner.
        form.submit();
      })
      .finally(() => {
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

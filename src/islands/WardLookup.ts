/**
 * WardLookup — progressive enhancement over the Home page's ward-search
 * `<form>` (PRD §5.1, IA §3.1).
 *
 * The form is a real `<form method="post">` that works with zero JS: a
 * plain submit POSTs to `/` and `Home.astro` server-renders the result
 * (see that file's `Astro.request.method === 'POST'` branch). This module
 * intercepts the submit, calls `POST /api/ward-lookup` instead, and paints
 * the same four result states inline so a JS-capable visitor never leaves
 * the page. `/api/ward-lookup` itself decides address vs pincode the same
 * way this module does (a bare 6-digit string is a pincode, anything else
 * is an address — see src/pages/api/ward-lookup.ts).
 *
 * On any failure to fetch/parse — network error, non-2xx, bad JSON — this
 * lets the native form submission proceed rather than trap the visitor
 * behind a broken island: that's what the no-JS server path exists for.
 *
 * Kept deliberately framework-free and small: no i18n table is imported
 * client-side (that would pull both locale JSON files into the bundle for
 * a handful of strings) — the handful of localized messages/labels this
 * script needs are read off `data-msg-*` attributes the server already
 * rendered in the visitor's language, and the ward link path is built with
 * the same rule as `localePath()` (src/i18n/index.ts) without importing it.
 */
import { configureMapsApi, importLibrary } from '../lib/maps-loader';

interface WardRow {
  id: number;
  nameEn: string;
  nameKn: string;
  corporation: string;
}

type LookupResponse =
  | { result: 'ward'; ward: WardRow }
  | { result: 'shortlist'; wards: WardRow[] }
  | { result: 'out_of_coverage' }
  | { result: 'use_pincode'; reason?: string };

const PINCODE_RE = /^\d{6}$/;

function wardHref(lang: string, id: number): string {
  return lang === 'kn' ? `/kn/ward/${id}` : `/ward/${id}`;
}

function wardName(lang: string, ward: WardRow): string {
  return lang === 'kn' ? ward.nameKn : ward.nameEn;
}

function renderWard(container: HTMLElement, lang: string, ward: WardRow): void {
  const link = document.createElement('a');
  link.href = wardHref(lang, ward.id);
  link.textContent = wardName(lang, ward);
  container.replaceChildren(link);
}

function renderShortlist(container: HTMLElement, lang: string, heading: string, wards: WardRow[]): void {
  const headingEl = document.createElement('p');
  headingEl.textContent = heading;

  const list = document.createElement('ul');
  for (const ward of wards) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = wardHref(lang, ward.id);
    link.textContent = wardName(lang, ward);
    item.appendChild(link);
    list.appendChild(item);
  }

  container.replaceChildren(headingEl, list);
}

function renderMessage(container: HTMLElement, message: string): void {
  const p = document.createElement('p');
  p.textContent = message;
  container.replaceChildren(p);
}

function renderResult(container: HTMLElement, lang: string, msgs: Record<string, string>, data: LookupResponse): void {
  switch (data.result) {
    case 'ward':
      renderWard(container, lang, data.ward);
      return;
    case 'shortlist':
      renderShortlist(container, lang, msgs.shortlistHeading ?? '', data.wards);
      return;
    case 'out_of_coverage':
      renderMessage(container, msgs.outOfCoverage ?? '');
      return;
    case 'use_pincode':
      renderMessage(container, msgs.usePincode ?? '');
      return;
  }
}

/**
 * Padded GBA bounding box used as a soft `locationBias` for autocomplete.
 * Same four numbers as `GBA_BOUNDS_*` in src/lib/geocode.ts — see that
 * file's header for why this is a soft bias and not a hard locality filter
 * (the GBA includes former CMC/TMC areas Google does not reliably label
 * "Bengaluru", and a hard filter would return zero results for perfectly
 * valid addresses there). Regenerate both if data/gba.geojson ever changes.
 */
const GBA_BOUNDS = { south: 12.7834, west: 77.4098, north: 13.1927, east: 77.8341 };

/**
 * Swap the server-rendered `<input>` for Google's Places Autocomplete
 * element, when — and only when — the server rendered a browser key onto the
 * form (src/lib/maps-config.ts -> Home.astro's `data-maps-key`).
 *
 * WHY REPLACING THE INPUT IS SAFE. `PlaceAutocompleteElement` is not a
 * drop-in for `<input>` in general, but it exposes the two things this
 * island actually depends on: a read/write `value`, and a form-associated
 * `name` ("the name that will be used when a form is submitted", per
 * @types/google.maps). So the pincode branch still reads typed text, and a
 * fallback native POST still submits `query`.
 *
 * WHAT IS DELIBERATELY NOT DONE. On `gmp-select` this writes the
 * prediction's `text` into the element and stops. It does NOT call
 * `toPlace()`/`fetchFields()` — partly because that is a second billed
 * request, but mainly because this island must never learn a position. The
 * server geocodes and resolves the ward itself, which is what keeps
 * `geocode_cache` storing normalized-address -> ward id and never a
 * citizen's coordinates. See the compliance notice atop src/lib/geocode.ts
 * before changing this.
 *
 * FAILURE IS A NO-OP. No key, a blocked script, a CSP refusal, or a
 * `gmp-error` all leave the server-rendered input exactly where it is —
 * which is the field this page shipped with before autocomplete existed.
 *
 * KNOWN GAP: the element has no `required` property, so replacing the input
 * loses native empty-field validation. An empty submit falls through to the
 * no-JS server path, which handles it — the same place an empty submit went
 * before this island existed.
 */
async function attachAutocomplete(
  form: HTMLFormElement,
  input: HTMLInputElement,
  lang: string,
  onReady: (el: { value: string }) => void,
): Promise<void> {
  const apiKey = form.dataset.mapsKey;
  if (!apiKey) return;

  try {
    configureMapsApi(apiKey);
    const places = (await importLibrary('places')) as google.maps.PlacesLibrary;

    const el = new places.PlaceAutocompleteElement({
      locationBias: GBA_BOUNDS,
      includedRegionCodes: ['in'],
      requestedLanguage: lang,
      requestedRegion: 'in',
    });

    // Carry the server input's identity across so a fallback native POST is
    // unchanged, and so the field keeps its label and placeholder.
    el.name = input.name;
    if (input.placeholder) el.placeholder = input.placeholder;
    if (input.id) el.id = input.id;

    el.addEventListener('gmp-select', (event) => {
      const text = (event as unknown as { placePrediction?: { text?: unknown } }).placePrediction?.text;
      if (typeof text === 'string' && text) el.value = text;
    });

    input.replaceWith(el as unknown as Node);
    onReady(el as unknown as { value: string });
  } catch {
    // Script blocked, offline, or refused by CSP — the plain input stands.
  }
}

/**
 * Wires up every `[data-ward-lookup]` form under `root` (defaults to the
 * whole document — there is exactly one on the Home page, but scoping to a
 * root keeps this testable against a fragment). Safe to call when the form
 * is absent (does nothing).
 */
export function initWardLookup(root: ParentNode = document): void {
  const form = root.querySelector<HTMLFormElement>('[data-ward-lookup]');
  if (!form) return;

  const input = form.querySelector<HTMLInputElement>('input[name="query"]');
  const result = form.querySelector<HTMLElement>('[data-ward-result]');
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!input || !result) return;

  const lang = form.dataset.lang ?? 'en';
  const msgs = {
    shortlistHeading: form.dataset.msgShortlistHeading ?? '',
    outOfCoverage: form.dataset.msgOutOfCoverage ?? '',
    usePincode: form.dataset.msgUsePincode ?? '',
  };

  // Whatever currently holds the visitor's query. Starts as the
  // server-rendered <input>; `attachAutocomplete` swaps in the Places element
  // if — and only if — that succeeds. Both expose a plain `value`, which is
  // the entire reason the swap is safe (see attachAutocomplete's header).
  let queryField: { value: string } = input;
  void attachAutocomplete(form, input, lang, (el) => {
    queryField = el;
  });

  form.addEventListener('submit', (event) => {
    const value = queryField.value.trim();
    if (!value) return; // native `required` validation handles this

    event.preventDefault();
    if (submitButton) submitButton.disabled = true;
    result.setAttribute('aria-busy', 'true');

    const body = PINCODE_RE.test(value) ? { pincode: value } : { address: value };

    fetch('/api/ward-lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`ward-lookup: ${res.status}`);
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

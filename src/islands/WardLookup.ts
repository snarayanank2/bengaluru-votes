/**
 * WardLookup — progressive enhancement over the Home page's ward-search
 * `<form>` (PRD §5.1, IA §3.1).
 *
 * The form is a real `<form method="post">` that works with zero JS: a
 * plain submit POSTs to `/` and `Home.astro` server-renders the result
 * (see that file's `Astro.request.method === 'POST'` branch). This module
 * intercepts the submit, calls `POST /api/ward-lookup` instead, and paints
 * the same four result states inline so a JS-capable visitor never leaves
 * the page.
 *
 * TYPING AN ADDRESS IS THE ONLY INPUT MODE THE FORM ITSELF HAS. Pincode
 * lookup was removed 2026-08-14 — see the header of
 * src/pages/api/ward-lookup.ts for why, and for the consequence (geocoding
 * is the only path from an address to a ward, with no fallback when it is
 * unavailable). The four states are `ward`, `out_of_coverage`, `ambiguous`
 * (the citizen can act — be more specific) and `unavailable` (our outage;
 * rewording will not help, so never phrase it as a bad address).
 *
 * This module ALSO adds the "use my current location" control, which posts
 * `{lat, lng}` to the same endpoint and shares the same render branches —
 * see `attachGeolocation` below. Like autocomplete, it is injected rather
 * than server-rendered, so it exists only where it can work.
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
  | { result: 'out_of_coverage' }
  | { result: 'ambiguous' }
  | { result: 'unavailable'; reason?: string };

function wardHref(lang: string, id: number): string {
  return lang === 'kn' ? `/kn/ward/${id}` : `/ward/${id}`;
}

function wardName(lang: string, ward: WardRow): string {
  return lang === 'kn' ? ward.nameKn : ward.nameEn;
}

function renderWard(container: HTMLElement, lang: string, ward: WardRow, note?: string): void {
  const link = document.createElement('a');
  link.href = wardHref(lang, ward.id);
  link.textContent = wardName(lang, ward);

  if (!note) {
    container.replaceChildren(link);
    return;
  }

  // The ward is still the answer — the note qualifies it, so it goes below
  // rather than replacing it. See `ACCURACY_CAVEAT_METRES`.
  const caveat = document.createElement('p');
  caveat.className = 'ward-note';
  caveat.dataset.wardNote = '';
  caveat.textContent = note;
  container.replaceChildren(link, caveat);
}

function renderMessage(container: HTMLElement, message: string): void {
  const p = document.createElement('p');
  p.textContent = message;
  container.replaceChildren(p);
}

function renderResult(
  container: HTMLElement,
  lang: string,
  msgs: Record<string, string>,
  data: LookupResponse,
  wardNote?: string,
): void {
  switch (data.result) {
    case 'ward':
      renderWard(container, lang, data.ward, wardNote);
      return;
    case 'out_of_coverage':
      renderMessage(container, msgs.outOfCoverage ?? '');
      return;
    case 'ambiguous':
      renderMessage(container, msgs.ambiguous ?? '');
      return;
    case 'unavailable':
      // Deliberately the same copy for `budget` and `failed`: both are our
      // outage, neither is fixable by the citizen rewording anything.
      renderMessage(container, msgs.unavailable ?? '');
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
 * @types/google.maps). So the submit handler still reads whatever the
 * visitor typed, and a fallback native POST still submits `query`.
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
 * Above this many metres of reported accuracy, a resolved ward gets the
 * "approximate location" caveat (`home.result.locationApproximate`).
 *
 * A phone GPS fix is typically 5–50m — comfortably inside one ward. A
 * desktop fix comes from wifi or IP geolocation and can be off by
 * kilometres, which in a city of 369 wards is easily the wrong ward. 500m
 * is roughly the scale at which "which ward is this" stops being a safe
 * question to answer silently. The ward is still shown either way: for most
 * coarse fixes it is still correct, and withholding it would be worse than
 * qualifying it.
 */
const ACCURACY_CAVEAT_METRES = 500;

/** `GeolocationPositionError.PERMISSION_DENIED` — the visitor said no. */
const PERMISSION_DENIED = 1;

/**
 * Adds the "use my current location" control, which resolves a ward from the
 * device's own position (`POST /api/ward-lookup` with `{lat, lng}`) instead
 * of a typed address.
 *
 * INJECTED, NEVER SERVER-RENDERED. Geolocation is a JS-only capability, so a
 * server-rendered button would be dead for a no-JS visitor and dead again on
 * a browser without the API. Building it here means it exists exactly when
 * it works. It is `type="button"` — a submit button here would post the
 * (empty) address form instead.
 *
 * WHAT LEAVES THE DEVICE. Latitude and longitude, and nothing else. The
 * accuracy radius is read here to decide the caveat and is deliberately not
 * sent: the server has no use for it. The position itself is used to pick a
 * ward and then dropped — never cached, never logged (see the compliance
 * notice atop src/lib/geocode.ts and the endpoint's PRIVACY note).
 *
 * NO NATIVE-SUBMIT FALLBACK. The address path answers a failed fetch by
 * letting the real `<form>` POST proceed; this path cannot, because the
 * no-JS server route has no coordinate mode and would receive an empty
 * address. A failed request therefore renders the same outage copy the
 * server would.
 */
function attachGeolocation(
  form: HTMLFormElement,
  result: HTMLElement,
  lang: string,
  msgs: Record<string, string>,
): void {
  const label = form.dataset.msgUseLocation;
  if (!label || !navigator.geolocation) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ward-locate';
  button.dataset.wardLocate = '';
  button.textContent = label;

  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitButton) submitButton.insertAdjacentElement('afterend', button);
  else form.appendChild(button);

  const settle = (): void => {
    button.disabled = false;
    result.removeAttribute('aria-busy');
  };

  const resolve = (position: GeolocationPosition): void => {
    const { latitude, longitude, accuracy } = position.coords;

    fetch('/api/ward-lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lat: latitude, lng: longitude }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`ward-lookup: ${res.status}`);
        return res.json() as Promise<LookupResponse>;
      })
      .then((data) => {
        const note = accuracy > ACCURACY_CAVEAT_METRES ? msgs.locationApproximate : undefined;
        renderResult(result, lang, msgs, data, note);
      })
      .catch(() => {
        renderMessage(result, msgs.unavailable ?? '');
      })
      .finally(settle);
  };

  button.addEventListener('click', () => {
    button.disabled = true;
    result.setAttribute('aria-busy', 'true');
    renderMessage(result, msgs.locating ?? '');

    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => {
        // A refusal is not an outage and not something to retry — both
        // messages point back at the address field, which always works.
        renderMessage(
          result,
          (error?.code === PERMISSION_DENIED ? msgs.locationDenied : msgs.locationUnavailable) ?? '',
        );
        settle();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
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
    outOfCoverage: form.dataset.msgOutOfCoverage ?? '',
    ambiguous: form.dataset.msgAmbiguous ?? '',
    unavailable: form.dataset.msgUnavailable ?? '',
    locating: form.dataset.msgLocating ?? '',
    locationApproximate: form.dataset.msgLocationApproximate ?? '',
    locationDenied: form.dataset.msgLocationDenied ?? '',
    locationUnavailable: form.dataset.msgLocationUnavailable ?? '',
  };

  attachGeolocation(form, result, lang, msgs);

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

    const body = { address: value };

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

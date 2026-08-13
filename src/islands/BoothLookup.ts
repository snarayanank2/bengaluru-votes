/**
 * BoothLookup — progressive enhancement over the FindBooth page's
 * ward-search-style `<form>` (PRD §5.10, IA §3.12), mirroring
 * src/islands/WardLookup.ts's structure exactly.
 *
 * The form is a real `<form method="post">` that works with zero JS: a
 * plain submit POSTs to /voting-guide/find-booth and that page's own
 * `Astro.request.method === 'POST'` branch server-renders the result using
 * the same booth-resolution logic `/api/booth-lookup` uses. This module
 * intercepts the submit, calls `POST /api/booth-lookup` instead, and paints
 * the result inline so a JS-capable visitor never leaves the page.
 *
 * Unlike WardLookup there is no pincode/address branching here — booth
 * lookup only accepts a free-text address (see src/pages/api/booth-lookup.ts)
 * — and there is no pincode-shortlist result kind. `no_booth_data` and an
 * empty `booths: []` array are treated identically (both are the "we don't
 * have data for you yet" guided-link-out state — see that endpoint's
 * header), and `out_of_coverage`/`unavailable` both render their own
 * message pointing at the ALWAYS-VISIBLE guided link-out block the page
 * renders below the form (see FindBooth.astro) rather than duplicating
 * that link here.
 *
 * On any failure to fetch/parse — network error, non-2xx, bad JSON — this
 * lets the native form submission proceed (the no-JS server path), same
 * fallback discipline as WardLookup.
 *
 * Each rendered booth also gets a Google Maps directions link, built by the
 * shared src/lib/maps-links.ts helper (spec §7) from the lat/lng the API
 * already returns — no separate API call. FindBooth.astro's server-rendered
 * POST branch renders the identical link from the same helper; keep both in
 * sync (see that file's header) rather than letting one drift.
 */
import { directionsUrl } from '../lib/maps-links';

interface BoothRow {
  id: number;
  nameEn: string;
  nameKn: string;
  address: string;
  lat: string;
  lng: string;
  wardId: number;
}

type LookupResponse =
  | { result: 'booth'; booths: BoothRow[] }
  | { result: 'no_booth_data' }
  | { result: 'out_of_coverage' }
  | { result: 'unavailable'; reason?: string };

function boothName(lang: string, booth: BoothRow): string {
  return lang === 'kn' && booth.nameKn ? booth.nameKn : booth.nameEn;
}

function renderBooths(
  container: HTMLElement,
  lang: string,
  label: string,
  directionsLabel: string,
  booths: BoothRow[],
): void {
  const list = document.createElement('ul');
  list.setAttribute('aria-label', label);
  for (const booth of booths) {
    const item = document.createElement('li');
    const name = document.createElement('p');
    name.textContent = boothName(lang, booth);
    const address = document.createElement('p');
    address.textContent = booth.address;
    const directions = document.createElement('a');
    directions.href = directionsUrl(booth.lat, booth.lng);
    directions.target = '_blank';
    directions.rel = 'noopener noreferrer';
    directions.textContent = directionsLabel;
    item.append(name, address, directions);
    list.appendChild(item);
  }
  container.replaceChildren(list);
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
): void {
  switch (data.result) {
    case 'booth':
      // Empty booths:[] is deliberately treated the same as no_booth_data
      // (see /api/booth-lookup's header) — never render an empty <ul>.
      if (data.booths.length === 0) {
        renderMessage(container, msgs.noBoothData ?? '');
        return;
      }
      renderBooths(container, lang, msgs.boothLabel ?? '', msgs.directions ?? '', data.booths);
      return;
    case 'no_booth_data':
      renderMessage(container, msgs.noBoothData ?? '');
      return;
    case 'out_of_coverage':
      renderMessage(container, msgs.outOfCoverage ?? '');
      return;
    case 'unavailable':
      renderMessage(container, msgs.unavailable ?? '');
      return;
  }
}

/**
 * Wires up every `[data-booth-lookup]` form under `root` (defaults to the
 * whole document — there is exactly one on the FindBooth page). Safe to
 * call when the form is absent (does nothing).
 */
export function initBoothLookup(root: ParentNode = document): void {
  const form = root.querySelector<HTMLFormElement>('[data-booth-lookup]');
  if (!form) return;

  const input = form.querySelector<HTMLInputElement>('input[name="address"]');
  const result = form.querySelector<HTMLElement>('[data-booth-result]');
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!input || !result) return;

  const lang = form.dataset.lang ?? 'en';
  const msgs = {
    boothLabel: form.dataset.msgBoothLabel ?? '',
    noBoothData: form.dataset.msgNoBoothData ?? '',
    outOfCoverage: form.dataset.msgOutOfCoverage ?? '',
    unavailable: form.dataset.msgUnavailable ?? '',
    directions: form.dataset.msgDirections ?? '',
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
      body: JSON.stringify({ address: value }),
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

// @vitest-environment jsdom
/**
 * Direct coverage for the JS-enhanced ward finder (src/islands/WardLookup.ts)
 * — the island most real users exercise on Home, previously verified only by
 * code reading (Task 18 review finding). Exercises:
 *  - the address body the island POSTs to /api/ward-lookup (mocked `fetch`),
 *    including that a bare 6-digit string is now just an address like any
 *    other (pincode lookup was removed 2026-08-14);
 *  - all four `LookupResponse` render branches painted into the
 *    `[data-ward-result]` aria-live container;
 *  - the fetch-failure (network error / non-2xx) fallback to the real,
 *    no-JS `<form>` submission, so a JS-capable visitor is never trapped.
 *
 * `initWardLookup` is the module's one exported entry point (called by
 * Home.astro's inline bootstrap script — see that file's closing
 * `<script>` tag); no refactor was needed to test it; this file builds a
 * DOM fragment mirroring the exact markup/data attributes Home.astro emits
 * and drives it via jsdom.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { t } from '../../src/i18n';

// Places Autocomplete is optional enhancement on top of this island, so the
// loader is mocked for every test in this file — the majority, which render
// no `data-maps-key`, must never reach it at all.
const { importLibraryMock, configureMapsApiMock, PlaceAutocompleteElementMock, constructedElements } =
  vi.hoisted(() => {
    const constructedElements: FakeAutocompleteElement[] = [];

    /**
     * Stands in for google.maps.places.PlaceAutocompleteElement. Mirrors only
     * the surface the island uses, per @types/google.maps 3.65.5: a
     * read/write `value`, a form-associated `name`, and a `gmp-select` event
     * carrying `placePrediction.text`.
     */
    class FakeAutocompleteElement extends HTMLElement {
      value = '';
      name: string | null = null;
      placeholder: string | null = null;
      locationBias: unknown = null;
      includedRegionCodes: string[] | null = null;
      requestedLanguage: string | null = null;
      requestedRegion: string | null = null;
      // The real class is `implements PlaceAutocompleteElementOptions` and
      // applies its constructor options to the matching properties, so the
      // fake must too — otherwise every option the island passes silently
      // vanishes and the tests assert nothing.
      constructor(options?: Record<string, unknown>) {
        super();
        Object.assign(this, options ?? {});
        constructedElements.push(this);
      }
      /** Simulate the visitor picking a prediction. */
      selectPrediction(text: string): void {
        this.dispatchEvent(
          Object.assign(new Event('gmp-select'), { placePrediction: { text } }),
        );
      }
    }

    const PlaceAutocompleteElementMock = FakeAutocompleteElement;
    const importLibraryMock = vi.fn();
    const configureMapsApiMock = vi.fn();
    return { importLibraryMock, configureMapsApiMock, PlaceAutocompleteElementMock, constructedElements };
  });

vi.mock('../../src/lib/maps-loader', () => ({
  configureMapsApi: configureMapsApiMock,
  importLibrary: importLibraryMock,
}));

import { initWardLookup } from '../../src/islands/WardLookup';

const WARD_A = { id: 5025, nameEn: 'X', nameKn: 'ಎಕ್ಸ್', corporation: 'south' };
const WARD_B = { id: 5026, nameEn: 'Y', nameKn: 'ವೈ', corporation: 'south' };

/**
 * Builds the same `[data-ward-lookup]` fragment Home.astro renders (form +
 * required text input + submit button + aria-live result container), with
 * the msg-* data attributes populated from the real i18n tables so the
 * render-branch tests assert the same strings production ships.
 */
function buildForm(lang: 'en' | 'kn' = 'en'): {
  form: HTMLFormElement;
  input: HTMLInputElement;
  result: HTMLElement;
} {
  document.body.innerHTML = `
    <form data-ward-lookup data-lang="${lang}"
      data-msg-ambiguous="${t(lang, 'home.result.ambiguous')}"
      data-msg-out-of-coverage="${t(lang, 'home.result.outOfCoverage')}"
      data-msg-unavailable="${t(lang, 'home.result.unavailable')}">
      <input name="query" required />
      <button type="submit">Search</button>
      <div data-ward-result aria-live="polite"></div>
    </form>
  `;
  return {
    form: document.querySelector('form')!,
    input: document.querySelector('input[name="query"]')!,
    result: document.querySelector('[data-ward-result]')!,
  };
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

/**
 * Flush the microtask queue so chained `.then()`/`.catch()`/`.finally()` run
 * (the island's fetch chain is `fetch().then(ok-check+json()).then(render)
 * .catch(submit-fallback).finally(busy-clear)` — several microtask hops deep
 * once `res.json()`'s own promise is included).
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe('WardLookup island (src/islands/WardLookup.ts)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('does nothing (does not throw) when no [data-ward-lookup] form is present', () => {
    document.body.innerHTML = '<p>no form here</p>';
    expect(() => initWardLookup()).not.toThrow();
  });

  describe('POST body', () => {
    // There is one input mode now. Pincode lookup was removed 2026-08-14
    // (see src/pages/api/ward-lookup.ts), so a bare 6-digit string is an
    // address like any other — the first two cases are the regression guard
    // for that, since they used to route down a separate branch.
    it.each([
      ['560001', { address: '560001' }],
      ['  560001  ', { address: '560001' }], // still trimmed
      ['12345', { address: '12345' }],
      ['1234567', { address: '1234567' }],
      ['abc', { address: 'abc' }],
      ['MG Road', { address: 'MG Road' }],
    ])('query %j -> POST body %j', async (query, expectedBody) => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'out_of_coverage' }) });
      const { form, input } = buildForm();
      initWardLookup();
      input.value = query;

      submit(form);
      await flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/ward-lookup');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual(expectedBody);
    });

    it('does not fetch and leaves the event un-prevented for an empty query (native `required` handles it)', () => {
      const { form, input } = buildForm();
      initWardLookup();
      input.value = '';

      const event = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('render branches', () => {
    it('ward result: renders a link to /ward/{id} (en) / /kn/ward/{id} (kn)', async () => {
      for (const lang of ['en', 'kn'] as const) {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: 'ward', ward: WARD_A }),
        });
        const { form, input, result } = buildForm(lang);
        initWardLookup();
        input.value = '560001';

        submit(form);
        await flush();

        expect(result.getAttribute('aria-live')).toBe('polite');
        const link = result.querySelector('a');
        expect(link).not.toBeNull();
        expect(link!.getAttribute('href')).toBe(lang === 'kn' ? '/kn/ward/5025' : '/ward/5025');
        expect(link!.textContent).toBe(lang === 'kn' ? WARD_A.nameKn : WARD_A.nameEn);
      }
    });

    it('out_of_coverage result: renders the explicit not-in-GBA message (home.result.outOfCoverage)', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'out_of_coverage' }) });
      const { form, input, result } = buildForm('en');
      initWardLookup();
      input.value = 'Nowhere at all';

      submit(form);
      await flush();

      expect(result.textContent).toBe(t('en', 'home.result.outOfCoverage'));
      expect(result.querySelector('a')).toBeNull();
    });

    it('ambiguous result: asks for a more specific address (home.result.ambiguous)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'ambiguous' }),
      });
      const { form, input, result } = buildForm('en');
      initWardLookup();
      input.value = 'Some ambiguous address';

      submit(form);
      await flush();

      expect(result.textContent).toBe(t('en', 'home.result.ambiguous'));
      expect(result.querySelector('a')).toBeNull();
    });

    // Budget exhausted or Google down. Since pincode was removed there is no
    // fallback left, so this copy is the whole answer — and it must read as
    // our outage, not as the citizen mistyping their address.
    it.each([['budget'], ['failed']])(
      'unavailable/%s result: renders the outage message (home.result.unavailable)',
      async (reason) => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ result: 'unavailable', reason }),
        });
        const { form, input, result } = buildForm('en');
        initWardLookup();
        input.value = 'MG Road';

        submit(form);
        await flush();

        expect(result.textContent).toBe(t('en', 'home.result.unavailable'));
        expect(result.querySelector('a')).toBeNull();
      },
    );
  });

  describe('fetch-failure -> native submit fallback (visitor never trapped)', () => {
    it('a rejected fetch (network error) falls back to the real form submission', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const { form, input, result } = buildForm('en');
      initWardLookup();
      input.value = 'MG Road';
      const submitSpy = vi.spyOn(form, 'submit').mockImplementation(() => {});

      submit(form);
      await flush();

      expect(submitSpy).toHaveBeenCalledTimes(1);
      // No partial/broken render was left behind, and the busy state was
      // cleared rather than leaving the visitor stuck with a spinner.
      expect(result.hasAttribute('aria-busy')).toBe(false);
    });

    it('a non-2xx response also falls back to the real form submission', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
      const { form, input, result } = buildForm('en');
      initWardLookup();
      input.value = 'MG Road';
      const submitSpy = vi.spyOn(form, 'submit').mockImplementation(() => {});

      submit(form);
      await flush();

      expect(submitSpy).toHaveBeenCalledTimes(1);
      expect(result.hasAttribute('aria-busy')).toBe(false);
    });
  });

  describe('busy state and re-entrancy guard', () => {
    it('sets aria-busy and disables the submit button while the request is in flight', async () => {
      let resolveFetch!: (value: unknown) => void;
      fetchMock.mockReturnValueOnce(new Promise((resolve) => (resolveFetch = resolve)));
      const { form, input, result } = buildForm('en');
      initWardLookup();
      input.value = '560001';
      const button = form.querySelector('button[type="submit"]') as HTMLButtonElement;

      submit(form);
      await flush();

      expect(result.getAttribute('aria-busy')).toBe('true');
      expect(button.disabled).toBe(true);

      resolveFetch({ ok: true, json: async () => ({ result: 'out_of_coverage' }) });
      await flush();

      expect(result.hasAttribute('aria-busy')).toBe(false);
      expect(button.disabled).toBe(false);
    });
  });

  describe('Places Autocomplete', () => {
    /** Same fragment as buildForm, plus the data-maps-key Home.astro renders when maps are on. */
    function buildFormWithKey(lang: 'en' | 'kn' = 'en'): {
      form: HTMLFormElement;
      input: HTMLInputElement;
      result: HTMLElement;
    } {
      const built = buildForm(lang);
      built.form.dataset.mapsKey = 'test-browser-key';
      return built;
    }

    /** Let the island's dynamic import + importLibrary promise chain settle. */
    async function settle(): Promise<void> {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    beforeEach(() => {
      constructedElements.length = 0;
      importLibraryMock.mockReset();
      configureMapsApiMock.mockReset();
      importLibraryMock.mockResolvedValue({
        PlaceAutocompleteElement: PlaceAutocompleteElementMock,
      });
      if (!customElements.get('fake-place-autocomplete')) {
        customElements.define('fake-place-autocomplete', PlaceAutocompleteElementMock);
      }
    });

    it('does nothing at all when the form carries no maps key', async () => {
      const { input } = buildForm('en');
      initWardLookup();
      await settle();

      expect(configureMapsApiMock).not.toHaveBeenCalled();
      expect(importLibraryMock).not.toHaveBeenCalled();
      expect(constructedElements).toHaveLength(0);
      // The server-rendered input is untouched — this is today's behaviour.
      expect(document.querySelector('input[name="query"]')).toBe(input);
    });

    it('replaces the input with the autocomplete element when a key is present', async () => {
      buildFormWithKey('en');
      initWardLookup();
      await settle();

      expect(configureMapsApiMock).toHaveBeenCalledWith('test-browser-key');
      expect(importLibraryMock).toHaveBeenCalledWith('places');
      expect(constructedElements).toHaveLength(1);

      // Form-associated: the element carries the name the server input had,
      // so a fallback native POST still submits `query`.
      expect(constructedElements[0].name).toBe('query');
      expect(document.querySelector('input[name="query"]')).toBeNull();
    });

    it('biases to the GBA area and restricts to India', async () => {
      buildFormWithKey('en');
      initWardLookup();
      await settle();

      const el = constructedElements[0];
      expect(el.includedRegionCodes).toEqual(['in']);
      // Same padded GBA bbox as src/lib/geocode.ts's GBA_BOUNDS_*.
      expect(el.locationBias).toEqual({
        south: 12.7834,
        west: 77.4098,
        north: 13.1927,
        east: 77.8341,
      });
    });

    it('asks for predictions in the visitor’s language', async () => {
      buildFormWithKey('kn');
      initWardLookup();
      await settle();

      expect(constructedElements[0].requestedLanguage).toBe('kn');
      expect(constructedElements[0].requestedRegion).toBe('in');
    });

    it('posts the selected prediction as an address, never coordinates', async () => {
      const { form } = buildFormWithKey('en');
      initWardLookup();
      await settle();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'ward', ward: WARD_A }),
      });

      constructedElements[0].selectPrediction('MG Road, Bengaluru, Karnataka, India');
      submit(form);
      await flush();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ address: 'MG Road, Bengaluru, Karnataka, India' });
      // The whole compliance line in src/lib/geocode.ts's header: the client
      // never sends a position, so geocode_cache never stores one.
      expect(body).not.toHaveProperty('lat');
      expect(body).not.toHaveProperty('lng');
    });

    it('treats a bare 6-digit query as an address, spending no autocomplete session', async () => {
      const { form } = buildFormWithKey('en');
      initWardLookup();
      await settle();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'out_of_coverage' }),
      });

      // Typed, not selected — the element's own value, read back the way the
      // island reads it. Pincode lookup is gone, so this is now just an
      // address — but it still must not have cost an autocomplete session,
      // since nothing was selected from the dropdown.
      constructedElements[0].value = '560001';
      submit(form);
      await flush();

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ address: '560001' });
    });

    it('leaves the plain input in place when the places library fails to load', async () => {
      importLibraryMock.mockRejectedValue(new Error('blocked by CSP'));
      const { input } = buildFormWithKey('en');
      initWardLookup();
      await settle();

      expect(constructedElements).toHaveLength(0);
      expect(document.querySelector('input[name="query"]')).toBe(input);
    });

    it('a typed address still submits when the element never loaded', async () => {
      importLibraryMock.mockRejectedValue(new Error('offline'));
      const { form, input } = buildFormWithKey('en');
      initWardLookup();
      await settle();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'ward', ward: WARD_A }),
      });

      input.value = 'MG Road';
      submit(form);
      await flush();

      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ address: 'MG Road' });
    });
  });
});

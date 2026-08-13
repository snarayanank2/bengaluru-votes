// @vitest-environment jsdom
/**
 * Direct coverage for src/islands/BoothLookup.ts, mirroring
 * tests/unit/ward-lookup-island.test.ts's structure/rationale for the
 * ward-finder island.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initBoothLookup } from '../../src/islands/BoothLookup';
import { t } from '../../src/i18n';

const BOOTH_A = {
  id: 1,
  nameEn: 'Govt School A',
  nameKn: 'ಸರ್ಕಾರಿ ಶಾಲೆ ಎ',
  address: '1 Test Street',
  lat: '12.97',
  lng: '77.59',
  wardId: 5025,
};

function buildForm(lang: 'en' | 'kn' = 'en'): {
  form: HTMLFormElement;
  input: HTMLInputElement;
  result: HTMLElement;
} {
  document.body.innerHTML = `
    <form data-booth-lookup data-lang="${lang}"
      data-msg-booth-label="${t(lang, 'findBooth.result.boothLabel')}"
      data-msg-no-booth-data="${t(lang, 'findBooth.result.noBoothData')}"
      data-msg-out-of-coverage="${t(lang, 'home.result.outOfCoverage')}"
      data-msg-unavailable="${t(lang, 'findBooth.result.unavailable')}"
      data-msg-directions="${t(lang, 'findBooth.result.directions')}">
      <input name="address" required />
      <button type="submit">Search</button>
      <div data-booth-result aria-live="polite"></div>
    </form>
  `;
  return {
    form: document.querySelector('form')!,
    input: document.querySelector('input[name="address"]')!,
    result: document.querySelector('[data-booth-result]')!,
  };
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe('BoothLookup island (src/islands/BoothLookup.ts)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('does nothing (does not throw) when no [data-booth-lookup] form is present', () => {
    document.body.innerHTML = '<p>no form here</p>';
    expect(() => initBoothLookup()).not.toThrow();
  });

  it('POSTs { address } (never a pincode field — booth lookup has no pincode branch)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'out_of_coverage' }) });
    const { form, input } = buildForm();
    initBoothLookup();
    input.value = '  1 Test Street  ';

    submit(form);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/booth-lookup');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ address: '1 Test Street' });
  });

  it('does not fetch and leaves the event un-prevented for an empty address (native `required` handles it)', () => {
    const { form, input } = buildForm();
    initBoothLookup();
    input.value = '';

    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  describe('render branches', () => {
    it('booth result: renders every booth name + address', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'booth', booths: [BOOTH_A] }),
      });
      const { form, input, result } = buildForm('en');
      initBoothLookup();
      input.value = '1 Test Street';

      submit(form);
      await flush();

      expect(result.getAttribute('aria-live')).toBe('polite');
      expect(result.textContent).toContain(BOOTH_A.nameEn);
      expect(result.textContent).toContain(BOOTH_A.address);
    });

    it('renders a directions link for each booth (spec §7)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'booth', booths: [BOOTH_A] }),
      });
      const { form, input, result } = buildForm('en');
      initBoothLookup();
      input.value = '1 Test Street';

      submit(form);
      await flush();

      const link = result.querySelector<HTMLAnchorElement>('a[href*="google.com/maps/dir"]');
      expect(link).not.toBeNull();
      expect(link!.href).toContain('destination=12.97%2C77.59');
      expect(link!.rel).toContain('noopener');
      expect(link!.target).toBe('_blank');
      expect(link!.textContent).toBe(t('en', 'findBooth.result.directions'));
    });

    it('booth result in kn: renders the Kannada booth name', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'booth', booths: [BOOTH_A] }),
      });
      const { form, input, result } = buildForm('kn');
      initBoothLookup();
      input.value = '1 Test Street';

      submit(form);
      await flush();

      expect(result.textContent).toContain(BOOTH_A.nameKn);
    });

    it('an empty booths:[] array is treated identically to no_booth_data (guided link-out message, no empty list)', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'booth', booths: [] }) });
      const { form, input, result } = buildForm('en');
      initBoothLookup();
      input.value = 'Somewhere with no booth yet';

      submit(form);
      await flush();

      expect(result.textContent).toBe(t('en', 'findBooth.result.noBoothData'));
      expect(result.querySelector('ul')).toBeNull();
    });

    it('no_booth_data result: renders the guided-link-out message', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'no_booth_data' }) });
      const { form, input, result } = buildForm('en');
      initBoothLookup();
      input.value = 'Anywhere';

      submit(form);
      await flush();

      expect(result.textContent).toBe(t('en', 'findBooth.result.noBoothData'));
    });

    it('out_of_coverage result: renders the not-in-GBA message', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'out_of_coverage' }) });
      const { form, input, result } = buildForm('en');
      initBoothLookup();
      input.value = 'Nowhere at all';

      submit(form);
      await flush();

      expect(result.textContent).toBe(t('en', 'home.result.outOfCoverage'));
    });

    it('unavailable result: renders the unavailable message', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'unavailable', reason: 'failed' }),
      });
      const { form, input, result } = buildForm('en');
      initBoothLookup();
      input.value = 'Some address';

      submit(form);
      await flush();

      expect(result.textContent).toBe(t('en', 'findBooth.result.unavailable'));
    });
  });

  describe('fetch-failure -> native submit fallback (visitor never trapped)', () => {
    it('a rejected fetch (network error) falls back to the real form submission', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const { form, input, result } = buildForm('en');
      initBoothLookup();
      input.value = 'Some address';
      const submitSpy = vi.spyOn(form, 'submit').mockImplementation(() => {});

      submit(form);
      await flush();

      expect(submitSpy).toHaveBeenCalledTimes(1);
      expect(result.hasAttribute('aria-busy')).toBe(false);
    });

    it('a non-2xx response also falls back to the real form submission', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
      const { form, input, result } = buildForm('en');
      initBoothLookup();
      input.value = 'Some address';
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
      initBoothLookup();
      input.value = 'Some address';
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
});

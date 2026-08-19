// @vitest-environment jsdom
/**
 * Direct coverage for src/islands/BoothLookup.ts, mirroring
 * tests/unit/ward-lookup-island.test.ts's structure/rationale for the
 * ward-finder island.
 *
 * The voter in every fixture is fictional. The island paints personal data
 * into the DOM and must do nothing else with it — see the island's header.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initBoothLookup } from '../../src/islands/BoothLookup';
import { t } from '../../src/i18n';

const VOTER = { epic: 'ZZZ0000001', nameEn: 'Demo Voter (FICTIONAL)', nameKn: 'ಡೆಮೊ ಮತದಾರ (ಕಾಲ್ಪನಿಕ)' };
const WARD = { id: 3049, nameEn: 'Shivanasamudra Ward', nameKn: 'ಶಿವನಸಮುದ್ರ ವಾರ್ಡ್', corporation: 'east' };
const BOOTH = {
  nameEn: 'Nammura Govt Higher Primary School Room No 2',
  nameKn: 'ನಮ್ಮೂರ ಸರಕಾರಿ ಹಿರಿಯ ಪ್ರಾಥಮಿಕ ಶಾಲೆ',
  serialNo: 1242,
  lat: 12.923654,
  lng: 77.69122,
};

const FOUND = { result: 'booth', voter: VOTER, ward: WARD, booth: BOOTH };

function formMarkup(lang: 'en' | 'kn'): string {
  return `
    <form data-booth-lookup data-lang="${lang}" method="post" action="/voting-guide/find-booth"
      data-msg-registered-as="${t(lang, 'findBooth.result.registeredAs')}"
      data-msg-ward-label="${t(lang, 'findBooth.result.wardLabel')}"
      data-msg-booth-label="${t(lang, 'findBooth.result.boothLabel')}"
      data-msg-serial-no="${t(lang, 'findBooth.result.serialNo')}"
      data-msg-ward-unknown="${t(lang, 'findBooth.result.wardUnknown')}"
      data-msg-not-found="${t(lang, 'findBooth.result.notFound')}"
      data-msg-unavailable="${t(lang, 'findBooth.result.unavailable')}"
      data-msg-directions="${t(lang, 'findBooth.result.directions')}"
      data-msg-directions-aria="${t(lang, 'findBooth.result.directionsAriaLabel')}">
      <input name="epic" required />
      <button type="submit">Search</button>
      <div data-booth-result aria-live="polite"></div>
    </form>
  `;
}

function buildForm(lang: 'en' | 'kn' = 'en'): {
  form: HTMLFormElement;
  input: HTMLInputElement;
  result: HTMLElement;
} {
  document.body.innerHTML = formMarkup(lang);
  return {
    form: document.querySelector('form')!,
    input: document.querySelector('input[name="epic"]')!,
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

  function respond(body: unknown, ok = true): void {
    fetchMock.mockResolvedValueOnce({ ok, status: ok ? 200 : 500, json: async () => body });
  }

  it('does nothing (does not throw) when no [data-booth-lookup] form is present', () => {
    document.body.innerHTML = '<p>nothing here</p>';
    expect(() => initBoothLookup()).not.toThrow();
  });

  it('POSTs { epic } — the only input mode booth lookup has', async () => {
    const { form, input } = buildForm();
    initBoothLookup();
    input.value = 'ZZZ0000001';
    respond(FOUND);

    submit(form);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/booth-lookup');
    expect(JSON.parse(init.body)).toEqual({ epic: 'ZZZ0000001' });
  });

  it('does not fetch and leaves the event un-prevented for an empty input (native `required` handles it)', () => {
    const { form, input } = buildForm();
    initBoothLookup();
    input.value = '   ';

    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  // Both the home card and the find-booth page render this form; a page could
  // hold both at once and neither may be left inert.
  it('wires every form on the page, not just the first', async () => {
    document.body.innerHTML = formMarkup('en') + formMarkup('en');
    initBoothLookup();
    const forms = Array.from(document.querySelectorAll('form'));
    expect(forms).toHaveLength(2);

    for (const form of forms) {
      form.querySelector<HTMLInputElement>('input[name="epic"]')!.value = 'ZZZ0000001';
      respond(FOUND);
      submit(form);
    }
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const form of forms) {
      expect(form.querySelector('[data-booth-result]')!.textContent).toContain(BOOTH.nameEn);
    }
  });

  describe('render branches', () => {
    it('renders the voter, the ward link, the booth and the serial number', async () => {
      const { form, input, result } = buildForm();
      initBoothLookup();
      input.value = 'ZZZ0000001';
      respond(FOUND);

      submit(form);
      await flush();

      expect(result.textContent).toContain(VOTER.nameEn);
      expect(result.textContent).toContain(VOTER.epic);
      expect(result.textContent).toContain(BOOTH.nameEn);
      // The template's {serialNo} must be substituted, not printed.
      expect(result.textContent).toContain('1242');
      expect(result.textContent).not.toContain('{serialNo}');

      const wardLink = result.querySelector<HTMLAnchorElement>(`a[href="/ward/${WARD.id}"]`);
      expect(wardLink).not.toBeNull();
      expect(wardLink!.textContent).toBe(WARD.nameEn);
    });

    it('links the ward under /kn/ on the Kannada page, with the Kannada names', async () => {
      const { form, input, result } = buildForm('kn');
      initBoothLookup();
      input.value = 'ZZZ0000001';
      respond(FOUND);

      submit(form);
      await flush();

      const wardLink = result.querySelector<HTMLAnchorElement>(`a[href="/kn/ward/${WARD.id}"]`);
      expect(wardLink).not.toBeNull();
      expect(wardLink!.textContent).toBe(WARD.nameKn);
      expect(result.textContent).toContain(BOOTH.nameKn);
      expect(result.textContent).toContain(VOTER.nameKn);
    });

    // Upstream ships '' rather than omitting the field when a record carries
    // no Kannada text.
    it('falls back to English when the record has no Kannada text', async () => {
      const { form, input, result } = buildForm('kn');
      initBoothLookup();
      input.value = 'ZZZ0000001';
      respond({
        ...FOUND,
        voter: { ...VOTER, nameKn: '' },
        booth: { ...BOOTH, nameKn: '' },
      });

      submit(form);
      await flush();

      expect(result.textContent).toContain(VOTER.nameEn);
      expect(result.textContent).toContain(BOOTH.nameEn);
    });

    it('renders a directions link with a per-booth accessible name', async () => {
      const { form, input, result } = buildForm();
      initBoothLookup();
      input.value = 'ZZZ0000001';
      respond(FOUND);

      submit(form);
      await flush();

      const link = result.querySelector<HTMLAnchorElement>('a.booth-directions')!;
      expect(link.href).toContain('google.com/maps/dir/');
      expect(link.href).toContain(encodeURIComponent(`${BOOTH.lat},${BOOTH.lng}`));
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
      expect(link.getAttribute('aria-label')).toBe(`Directions to ${BOOTH.nameEn}`);
      expect(link.getAttribute('aria-label')).not.toContain('{boothName}');
    });

    // The booth is still the answer even when we cannot place it in a ward.
    it('a booth with no resolved ward still renders, with the ward-unknown line', async () => {
      const { form, input, result } = buildForm();
      initBoothLookup();
      input.value = 'ZZZ0000001';
      respond({ ...FOUND, ward: null });

      submit(form);
      await flush();

      expect(result.textContent).toContain(BOOTH.nameEn);
      expect(result.textContent).toContain(t('en', 'findBooth.result.wardUnknown'));
      expect(result.querySelector('a[href^="/ward/"]')).toBeNull();
    });

    it('not_found renders the check-your-number message', async () => {
      const { form, input, result } = buildForm();
      initBoothLookup();
      input.value = 'ZZZ0000002';
      respond({ result: 'not_found' });

      submit(form);
      await flush();

      expect(result.textContent).toBe(t('en', 'findBooth.result.notFound'));
    });

    it.each(['timeout', 'failed', 'malformed', 'budget'])(
      'unavailable/%s renders the one outage message',
      async (reason) => {
        const { form, input, result } = buildForm();
        initBoothLookup();
        input.value = 'ZZZ0000001';
        respond({ result: 'unavailable', reason });

        submit(form);
        await flush();

        expect(result.textContent).toBe(t('en', 'findBooth.result.unavailable'));
      },
    );

    it('replaces a previous result rather than appending to it', async () => {
      const { form, input, result } = buildForm();
      initBoothLookup();
      input.value = 'ZZZ0000001';
      respond(FOUND);
      submit(form);
      await flush();

      respond({ result: 'not_found' });
      submit(form);
      await flush();

      expect(result.textContent).toBe(t('en', 'findBooth.result.notFound'));
      expect(result.textContent).not.toContain(VOTER.epic);
    });
  });

  describe('fetch-failure -> native submit fallback (visitor never trapped)', () => {
    it('a rejected fetch (network error) falls back to the real form submission', async () => {
      const { form, input } = buildForm();
      const submitSpy = vi.fn();
      form.submit = submitSpy;
      initBoothLookup();
      input.value = 'ZZZ0000001';
      fetchMock.mockRejectedValueOnce(new Error('offline'));

      submit(form);
      await flush();

      expect(submitSpy).toHaveBeenCalledTimes(1);
    });

    it('a non-2xx response also falls back to the real form submission', async () => {
      const { form, input } = buildForm();
      const submitSpy = vi.fn();
      form.submit = submitSpy;
      initBoothLookup();
      input.value = 'ZZZ0000001';
      respond({ error: 'nope' }, false);

      submit(form);
      await flush();

      expect(submitSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('busy state', () => {
    it('sets aria-busy and disables the submit button while the request is in flight', async () => {
      const { form, input, result } = buildForm();
      initBoothLookup();
      input.value = 'ZZZ0000001';
      const button = form.querySelector('button')!;

      let resolve!: (value: unknown) => void;
      fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));

      submit(form);
      expect(result.getAttribute('aria-busy')).toBe('true');
      expect(button.disabled).toBe(true);

      resolve({ ok: true, status: 200, json: async () => FOUND });
      await flush();

      expect(result.hasAttribute('aria-busy')).toBe(false);
      expect(button.disabled).toBe(false);
    });
  });
});

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
import { initBoothLookup, LOOKUP_TIMEOUT_MS } from '../../src/islands/BoothLookup';
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
    <form data-booth-lookup data-lang="${lang}" method="post"
      data-msg-registered-as="${t(lang, 'findBooth.result.registeredAs')}"
      data-msg-ward-label="${t(lang, 'findBooth.result.wardLabel')}"
      data-msg-ward-template="${t(lang, 'nav.ward')}"
      data-msg-booth-label="${t(lang, 'findBooth.result.boothLabel')}"
      data-msg-serial-no="${t(lang, 'findBooth.result.serialNo')}"
      data-msg-ward-unknown="${t(lang, 'findBooth.result.wardUnknown')}"
      data-msg-not-found="${t(lang, 'findBooth.result.notFound')}"
      data-msg-unavailable="${t(lang, 'findBooth.result.unavailable')}"
      data-msg-invalid="${t(lang, 'findBooth.result.invalid')}"
      data-msg-searching="${t(lang, 'findBooth.result.searching')}"
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

  // A truly empty field never reaches here (native `required`); spaces do.
  // The native submit is cancelled either way: this form has no action to go to.
  it('does not fetch for a blank input, cancels the submit and says the number is not valid', () => {
    const { form, input, result } = buildForm();
    initBoothLookup();
    input.value = '   ';

    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(result.textContent).toBe(t('en', 'findBooth.result.invalid'));
  });

  // design-system §7.10: a refused field is aria-invalid and described by its message.
  it('marks the field aria-invalid and linked to the message when the number is refused, and clears it on edit', async () => {
    const { form, input, result } = buildForm();
    initBoothLookup();
    input.value = 'ABC';
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'bad' }) });

    submit(form);
    await flush();

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(result.id).not.toBe('');
    expect(input.getAttribute('aria-describedby')).toBe(result.id);

    input.value = 'ABC1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });

  it('an empty field is answered inline too (the form is novalidate), marked invalid and focused', () => {
    const { form, input, result } = buildForm();
    initBoothLookup();
    input.value = '';

    submit(form);

    expect(result.textContent).toBe(t('en', 'findBooth.result.invalid'));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input);
  });

  it('a lookup that finds nothing is not an invalid field', async () => {
    const { form, input } = buildForm();
    initBoothLookup();
    input.value = 'ZZZ0000002';
    respond({ result: 'not_found' });

    submit(form);
    await flush();

    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  // The form may be rendered more than once on a page and neither may be left
  // inert.
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

      // The public place label, not the stored name.
      const wardLink = result.querySelector<HTMLAnchorElement>(`a[href="/ward/${WARD.id}"]`);
      expect(wardLink).not.toBeNull();
      expect(wardLink!.textContent).toBe('Ward 49 Shivanasamudra Ward');
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
      expect(wardLink!.textContent).toBe('ವಾರ್ಡ್ 49 ಶಿವನಸಮುದ್ರ ವಾರ್ಡ್');
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

  describe('failures are answered in place — never by a native submit', () => {
    function lastSubmitSpy(form: HTMLFormElement): ReturnType<typeof vi.fn> {
      const submitSpy = vi.fn();
      form.submit = submitSpy;
      return submitSpy;
    }

    it('a 400 says the number is not valid', async () => {
      const { form, input, result } = buildForm();
      const submitSpy = lastSubmitSpy(form);
      initBoothLookup();
      input.value = 'ABC';
      fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'bad' }) });

      submit(form);
      await flush();

      expect(result.textContent).toBe(t('en', 'findBooth.result.invalid'));
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('a rejected fetch (network error) says the roll is unavailable', async () => {
      const { form, input, result } = buildForm();
      const submitSpy = lastSubmitSpy(form);
      initBoothLookup();
      input.value = 'ZZZ0000001';
      fetchMock.mockRejectedValueOnce(new Error('offline'));

      submit(form);
      await flush();

      expect(result.textContent).toBe(t('en', 'findBooth.result.unavailable'));
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it.each([500, 502, 504])('a %s response says the roll is unavailable', async (status) => {
      const { form, input, result } = buildForm();
      const submitSpy = lastSubmitSpy(form);
      initBoothLookup();
      input.value = 'ZZZ0000001';
      fetchMock.mockResolvedValueOnce({ ok: false, status, json: async () => ({}) });

      submit(form);
      await flush();

      expect(result.textContent).toBe(t('en', 'findBooth.result.unavailable'));
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('an unreadable body says the roll is unavailable', async () => {
      const { form, input, result } = buildForm();
      initBoothLookup();
      input.value = 'ZZZ0000001';
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });

      submit(form);
      await flush();

      expect(result.textContent).toBe(t('en', 'findBooth.result.unavailable'));
    });

    it('gives up on a stalled request after the timeout, and frees the button', async () => {
      vi.useFakeTimers();
      try {
        const { form, input, result } = buildForm();
        initBoothLookup();
        input.value = 'ZZZ0000001';
        const button = form.querySelector('button')!;
        // A fetch that only ever settles when it is aborted.
        fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }));

        submit(form);
        expect(button.disabled).toBe(true);

        await vi.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS - 1);
        expect(button.disabled).toBe(true);
        await vi.advanceTimersByTimeAsync(2);

        expect(result.textContent).toBe(t('en', 'findBooth.result.unavailable'));
        expect(button.disabled).toBe(false);
        expect(result.hasAttribute('aria-busy')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
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
      // The live region says something is happening while the request is pending.
      expect(result.textContent).toBe(t('en', 'findBooth.result.searching'));

      resolve({ ok: true, status: 200, json: async () => FOUND });
      await flush();

      expect(result.hasAttribute('aria-busy')).toBe(false);
      expect(button.disabled).toBe(false);
    });
  });
});

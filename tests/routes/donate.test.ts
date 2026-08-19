import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { localePath, type Lang } from '../../src/i18n';
import Donate from '../../src/features/pages/Donate.astro';

const SITE_ORIGIN = 'https://bengaluruvotes.opencity.in';

async function renderPage(lang: Lang): Promise<string> {
  const container = await AstroContainer.create({
    astroConfig: {
      site: SITE_ORIGIN,
      i18n: { locales: ['en', 'kn'], defaultLocale: 'en', routing: { prefixDefaultLocale: false } },
    },
  });
  const response = await container.renderToResponse(Donate, {
    partial: false,
    props: { lang },
    request: new Request(`${SITE_ORIGIN}${localePath(lang, '/donate')}`),
  });
  return response.text();
}

describe('Donate (/donate, /kn/donate)', () => {
  it('explains the need for support in both languages', async () => {
    const en = await renderPage('en');
    expect(en).toContain('all 369 GBA wards');
    expect(en).toContain('recurring donation');

    const kn = await renderPage('kn');
    expect(kn).toContain('ಎಲ್ಲಾ 369 ಜಿಬಿಎ ವಾರ್ಡ್‌ಗಳಲ್ಲಿ');
    expect(kn).toContain('ನಿಯಮಿತ ದೇಣಿಗೆಯು');
  });

  it('links safely to Oorvani’s hosted donation flow instead of embedding it', async () => {
    const html = await renderPage('en');
    expect(html).toContain('href="https://oorvani.org/support-us"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('danamojo');
  });

  it('emits localized canonical and hreflang URLs', async () => {
    const en = await renderPage('en');
    expect(en).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/donate">`);
    expect(en).toContain(`<link rel="alternate" hreflang="kn" href="${SITE_ORIGIN}/kn/donate">`);

    const kn = await renderPage('kn');
    expect(kn).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/kn/donate">`);
    expect(kn).toContain(`<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/donate">`);
  });
});

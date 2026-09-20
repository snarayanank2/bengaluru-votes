import { describe, it, expect, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import SourceLine from '../../src/components/SourceLine.astro';
import FieldRow from '../../src/components/FieldRow.astro';
import CandidateRow from '../../src/components/CandidateRow.astro';
import IssueBars from '../../src/components/IssueBars.astro';
import DeadlineBanner from '../../src/components/DeadlineBanner.astro';
import Banner from '../../src/components/Banner.astro';
import Badge from '../../src/components/Badge.astro';
import Button from '../../src/components/Button.astro';
import EmptyState from '../../src/components/EmptyState.astro';
import Card from '../../src/components/Card.astro';
import FormField from '../../src/components/FormField.astro';
import Toast from '../../src/components/Toast.astro';

import { ModalController, computeTabTrapTarget, getFocusableElements } from '../../src/islands/ModalShell';
import { t, localePath } from '../../src/i18n';

/**
 * The container API (dev mode) decorates elements with
 * `data-astro-source-file="..."`/`data-astro-source-loc="..."` and
 * `data-astro-cid-*` debug attributes; strip them so assertions read
 * against the meaningful markup only (matches tests/routes/layout.test.ts).
 */
function normalize(html: string): string {
  return html
    .replace(/\s+data-astro-cid-\w+/g, '')
    .replace(/\s+data-astro-(?:source-file|source-loc)="[^"]*"/g, '');
}

async function render(
  Component: Parameters<AstroContainer['renderToString']>[0],
  props: Record<string, unknown>,
  slots?: Record<string, string>,
): Promise<string> {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Component, { props, slots });
  return normalize(html);
}

// ---------------------------------------------------------------------------
// SourceLine (design-system.md §3 — the signature)
// ---------------------------------------------------------------------------

describe('SourceLine', () => {
  it('renders the AI-extracted badge (dotted border class) when aiExtracted is true, regardless of sourceType', async () => {
    const html = await render(SourceLine, {
      sourceType: 'official',
      sourceUrl: 'https://example.com/affidavit.pdf',
      aiExtracted: true,
      lang: 'en',
    });
    expect(html).toContain(t('en', 'common.source.aiExtracted'));
    expect(html).toContain('badge--ai-extracted');
    // Not yet curator-confirmed: no link out.
    expect(html).not.toContain('<a');
  });

  it('renders the Affidavit badge linking to sourceUrl for official, non-AI-extracted fields', async () => {
    const html = await render(SourceLine, {
      sourceType: 'official',
      sourceUrl: 'https://example.com/affidavit.pdf',
      aiExtracted: false,
      lang: 'en',
    });
    expect(html).toContain(t('en', 'common.source.affidavit'));
    expect(html).toContain('badge--affidavit');
    expect(html).toContain('href="https://example.com/affidavit.pdf"');
  });

  it('renders the Curator-compiled badge, never linked, for curator fields', async () => {
    const html = await render(SourceLine, { sourceType: 'curator', lang: 'en' });
    expect(html).toContain(t('en', 'common.source.curator'));
    expect(html).toContain('badge--curator');
    expect(html).not.toContain('<a');
  });
});

// ---------------------------------------------------------------------------
// FieldRow (design-system.md §3/§7.5)
// ---------------------------------------------------------------------------

describe('FieldRow', () => {
  it('renders the label, value, and source line for a normal field', async () => {
    const html = await render(FieldRow, {
      label: 'Education',
      value: 'B.Com, Bangalore University',
      sourceType: 'official',
      sourceUrl: 'https://example.com/a.pdf',
      lang: 'en',
    });
    expect(html).toContain('Education');
    expect(html).toContain('B.Com, Bangalore University');
    expect(html).toContain(t('en', 'common.source.affidavit'));
    expect(html).not.toContain(t('en', 'common.notDeclared'));
  });

  it('renders "Not declared" in muted italic when notDeclared is true, with the source line intact', async () => {
    const html = await render(FieldRow, {
      label: 'Criminal cases',
      sourceType: 'official',
      notDeclared: true,
      lang: 'en',
    });
    expect(html).toContain(t('en', 'common.notDeclared'));
    expect(html).toContain('field-value--not-declared');
    expect(html).toContain(t('en', 'common.source.affidavit'));
  });

  it('renders "Not declared" when value is null/empty even without an explicit notDeclared flag', async () => {
    const html = await render(FieldRow, {
      label: 'Assets',
      value: null,
      sourceType: 'curator',
      lang: 'en',
    });
    expect(html).toContain(t('en', 'common.notDeclared'));
    expect(html).toContain(t('en', 'common.source.curator'));
  });

  // Task 40 (PRD §8, architecture §9) — the pending-machine-translation
  // indicator: shown only when the value being displayed is a FALLBACK (the
  // authored language, on the other locale's page) because MT hasn't landed.
  describe('pending-translation indicator (Task 40)', () => {
    it('shows the authored-language value plus the subtle indicator when pending and lang differs from authoredLang', async () => {
      const html = await render(FieldRow, {
        label: 'Track record',
        value: 'Two-term corporator, led road-repair drive.',
        sourceType: 'curator',
        lang: 'kn',
        authoredLang: 'en',
        translationStatus: 'pending',
      });
      expect(html).toContain('Two-term corporator, led road-repair drive.');
      expect(html).toContain(t('kn', 'common.translationPending'));
    });

    it('shows the value normally, with no indicator, once translationStatus is done', async () => {
      const html = await render(FieldRow, {
        label: 'Track record',
        value: 'ಎರಡು ಅವಧಿಯ ಕಾರ್ಪೊರೇಟರ್.',
        sourceType: 'curator',
        lang: 'kn',
        authoredLang: 'en',
        translationStatus: 'done',
      });
      expect(html).toContain('ಎರಡು ಅವಧಿಯ ಕಾರ್ಪೊರೇಟರ್.');
      expect(html).not.toContain(t('kn', 'common.translationPending'));
    });

    it('shows no indicator when rendering in the authored language itself, even while pending', async () => {
      const html = await render(FieldRow, {
        label: 'Track record',
        value: 'Two-term corporator, led road-repair drive.',
        sourceType: 'curator',
        lang: 'en',
        authoredLang: 'en',
        translationStatus: 'pending',
      });
      expect(html).not.toContain(t('en', 'common.translationPending'));
    });

    it('a caller that omits authoredLang/translationStatus entirely (every pre-Task-40 caller) never shows the indicator', async () => {
      const html = await render(FieldRow, {
        label: 'Education',
        value: 'B.Com, Bangalore University',
        sourceType: 'official',
        sourceUrl: 'https://example.com/a.pdf',
        lang: 'en',
      });
      expect(html).not.toContain(t('en', 'common.translationPending'));
    });
  });
});

// ---------------------------------------------------------------------------
// CandidateRow (design-system.md §7.5, neutrality §4 — LOAD-BEARING)
// ---------------------------------------------------------------------------

const candidate = {
  slug: 'ward-57-asha-rao',
  nameEn: 'Asha Rao',
  partyEn: 'Independent',
};

describe('CandidateRow', () => {
  it('renders the candidate name and party as plain text', async () => {
    const html = await render(CandidateRow, { candidate, lang: 'en' });
    expect(html).toContain('Asha Rao');
    expect(html).toContain('Independent');
  });

  it('links to /candidate/{slug}, locale-prefixed for kn', async () => {
    const enHtml = await render(CandidateRow, { candidate, lang: 'en' });
    const knHtml = await render(CandidateRow, { candidate, lang: 'kn' });
    expect(enHtml).toContain(`href="${localePath('en', '/candidate/ward-57-asha-rao')}"`);
    expect(knHtml).toContain(`href="${localePath('kn', '/candidate/ward-57-asha-rao')}"`);
  });

  it('renders a neutral initials placeholder (no <img>) when photoUrl is absent', async () => {
    const html = await render(CandidateRow, { candidate, lang: 'en' });
    expect(html).not.toContain('<img');
    expect(html).toContain('photo--placeholder');
    expect(html).toContain('AR'); // initials of "Asha Rao"
  });

  it('renders an <img> when photoUrl is present', async () => {
    const html = await render(CandidateRow, {
      candidate: { ...candidate, photoUrl: 'https://example.com/asha.jpg' },
      lang: 'en',
    });
    expect(html).toContain('<img');
    expect(html).toContain('src="https://example.com/asha.jpg"');
  });

  it('never assigns a color/style keyed to the party (neutrality §4)', async () => {
    const bjpHtml = await render(CandidateRow, {
      candidate: { ...candidate, partyEn: 'BJP' },
      lang: 'en',
    });
    const indHtml = await render(CandidateRow, {
      candidate: { ...candidate, partyEn: 'Independent' },
      lang: 'en',
    });
    // No inline style attribute anywhere in the output.
    expect(bjpHtml).not.toMatch(/style="/);
    expect(indHtml).not.toMatch(/style="/);
    // No per-party class derived from the party name.
    expect(bjpHtml).not.toMatch(/class="[^"]*party-bjp/i);
  });
});

// ---------------------------------------------------------------------------
// IssueBars (design-system.md §7.11, neutrality §4.5 — LOAD-BEARING)
// ---------------------------------------------------------------------------

const issueBarsSource = readFileSync(
  path.join(__dirname, '..', '..', 'src', 'components', 'IssueBars.astro'),
  'utf8',
);

describe('IssueBars', () => {
  const longTitle =
    'Traffic congestion and unsafe pedestrian crossings near the main arterial road connecting the ward to the ring road, especially during peak morning and evening hours';

  const results = [
    { issueTitle: 'Waste management', rank: 1, sharePct: 42 },
    { issueTitle: 'Water supply', rank: 2, sharePct: 31 },
    { issueTitle: longTitle, rank: 3, sharePct: 27 },
  ];

  it('renders every bar with the same single fill class regardless of rank', async () => {
    const html = await render(IssueBars, { results, lang: 'en' });
    const fillMatches = html.match(/class="fill"/g) ?? [];
    expect(fillMatches).toHaveLength(3);
    // No per-rank color variant class.
    expect(html).not.toMatch(/fill--rank/);
    expect(html).not.toMatch(/fill-1|fill-2|fill-3/);
  });

  it('renders rank and share as text, styled tabular via font-variant-numeric: tabular-nums', async () => {
    const html = await render(IssueBars, { results, lang: 'en' });
    expect(html).toContain('42%');
    expect(html).toContain('31%');
    expect(html).toContain('27%');
    // AstroContainer#renderToString on a bare (non-page) component doesn't
    // inline the component's hoisted <style> block (there's no <head> to
    // place it in), so the CSS rule is asserted against the component's own
    // source rather than the rendered fragment.
    expect(issueBarsSource).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('never truncates a long issue title, in markup or in its own styling', async () => {
    const html = await render(IssueBars, { results, lang: 'en' });
    expect(html).toContain(longTitle);
    expect(issueBarsSource).not.toMatch(/text-overflow:\s*ellipsis/);
  });

  it('contains no hex color and no per-rank color class (neutrality guard)', async () => {
    const html = await render(IssueBars, { results, lang: 'en' });
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/rank-1|rank-2|rank-3|--forest-rank|color:\s*red|color:\s*green/i);
  });
});

// ---------------------------------------------------------------------------
// DeadlineBanner (design-system.md §7.6)
// ---------------------------------------------------------------------------

describe('DeadlineBanner', () => {
  it('computes days remaining from a plain deadline date and renders a tabular countdown', async () => {
    const inTenDays = new Date();
    inTenDays.setUTCDate(inTenDays.getUTCDate() + 10);
    const deadlineISO = inTenDays.toISOString().slice(0, 10);

    const html = await render(DeadlineBanner, { deadlineISO, lang: 'en' });
    expect(html).toContain(t('en', 'common.deadlineBanner.defaultLabel'));
    expect(html).toMatch(/10 days left/);
  });

  it('accepts a labelKey override', async () => {
    const deadlineISO = new Date().toISOString().slice(0, 10);
    const html = await render(DeadlineBanner, {
      deadlineISO,
      lang: 'en',
      labelKey: 'common.registerForUpdates',
    });
    expect(html).toContain(t('en', 'common.registerForUpdates'));
  });
});

// ---------------------------------------------------------------------------
// Banner (design-system.md §7.6)
// ---------------------------------------------------------------------------

describe('Banner', () => {
  it('renders notice content with the notice class', async () => {
    const html = await render(Banner, { kind: 'notice', lang: 'en' }, { default: 'Nominations open soon.' });
    expect(html).toContain('banner--notice');
    expect(html).toContain('Nominations open soon.');
  });

  it('renders error content with the error class', async () => {
    const html = await render(Banner, { kind: 'error', lang: 'en' }, { default: 'Something went wrong.' });
    expect(html).toContain('banner--error');
    expect(html).toContain('Something went wrong.');
  });
});

// ---------------------------------------------------------------------------
// Badge (design-system.md §7.7 — the reserved set)
// ---------------------------------------------------------------------------

describe('Badge', () => {
  const cases: Array<[string, string]> = [
    ['flag-pending', 'common.badge.flagPending'],
    ['flag-accepted', 'common.badge.flagAccepted'],
    ['flag-rejected', 'common.badge.flagRejected'],
    ['ward-ready', 'common.badge.wardReady'],
    ['ward-held', 'common.badge.wardHeld'],
  ];

  it.each(cases)('renders the spec\'d label and class for variant %s', async (variant, i18nKey) => {
    const html = await render(Badge, { variant, lang: 'en' });
    expect(html).toContain(t('en', i18nKey));
    expect(html).toContain(`badge-chip--${variant}`);
  });
});

// ---------------------------------------------------------------------------
// Button (design-system.md §7.3)
// ---------------------------------------------------------------------------

describe('Button', () => {
  const variants = ['primary', 'secondary', 'tertiary', 'destructive', 'light'] as const;

  it.each(variants)('renders the %s variant class', async (variant) => {
    const html = await render(Button, { variant, lang: 'en' }, { default: 'Do the thing' });
    expect(html).toContain(`btn--${variant}`);
    expect(html).toContain('Do the thing');
  });

  it('renders an anchor when href is given', async () => {
    const html = await render(Button, { variant: 'primary', href: '/check-registration', lang: 'en' }, { default: 'Check' });
    expect(html).toMatch(/<a\b[^>]*href="\/check-registration"/);
    expect(html).not.toMatch(/<button/);
  });

  it('renders a button element when href is omitted', async () => {
    const html = await render(Button, { variant: 'primary', lang: 'en' }, { default: 'Submit' });
    expect(html).toMatch(/<button/);
    expect(html).not.toMatch(/<a\b[^>]*href/);
  });

  it('renders the disabled attribute on a button variant', async () => {
    const html = await render(Button, { variant: 'primary', disabled: true, lang: 'en' }, { default: 'Submit' });
    expect(html).toMatch(/<button[^>]*\bdisabled\b/);
  });

  it('gives icon-only actions a localized accessible name and hides the decorative icon', async () => {
    const html = await render(Button, { variant: 'tertiary', iconOnly: true, label: 'ಮುಚ್ಚಿ', lang: 'kn' }, { default: '<svg></svg>' });
    expect(html).toContain('btn--icon');
    expect(html).toMatch(/<button[^>]*aria-label="ಮುಚ್ಚಿ"/);
    expect(html).toMatch(/<span class="btn-label"[^>]*aria-hidden="true"/);
  });

  it('rejects icon-only actions without an accessible name', async () => {
    await expect(render(Button, { variant: 'light', iconOnly: true, lang: 'en' }, { default: '<svg></svg>' })).rejects.toThrow('accessible label');
  });

  it.each([undefined, '/ward/3049'])('preserves the action name and exposes loading status (href=%s)', async (href) => {
    const html = await render(Button, { variant: 'light', loading: true, href, lang: 'en' }, { default: 'Find ward' });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('style="opacity:0"');
    expect(html).not.toContain('visibility:hidden');
    expect(html).toMatch(/<span class="sr-only" role="status">Loading/);
    expect(html).toContain('Find ward');
  });
});

// ---------------------------------------------------------------------------
// EmptyState (design-system.md §7.12)
// ---------------------------------------------------------------------------

describe('EmptyState', () => {
  it('renders a fact and a next step', async () => {
    // No apostrophes in these fixture strings — Astro HTML-escapes slotted
    // text (' -> &#39;), which would make a literal-string .toContain a
    // false negative unrelated to what this test actually checks.
    const html = await render(EmptyState, {
      fact: 'Candidate nominations open on 12 Aug.',
      nextStep: 'Register for updates and we will tell you when they are in.',
    });
    expect(html).toContain('Candidate nominations open on 12 Aug.');
    expect(html).toContain('Register for updates and we will tell you when they are in.');
  });
});

// ---------------------------------------------------------------------------
// Card (design-system.md §6.3/§7.5)
// ---------------------------------------------------------------------------

describe('Card', () => {
  it('wraps slotted content in a bordered white card', async () => {
    const html = await render(Card, {}, { default: 'Card contents' });
    expect(html).toContain('Card contents');
    expect(html).toContain('class="card"');
  });
});

// ---------------------------------------------------------------------------
// FormField (design-system.md §7.10)
// ---------------------------------------------------------------------------

describe('FormField', () => {
  it('links the label to the input via for/id', async () => {
    const html = await render(FormField, { label: 'Email', name: 'email', lang: 'en' });
    const forMatch = html.match(/<label[^>]*for="([^"]+)"/);
    const idMatch = html.match(/<input[^>]*\bid="([^"]+)"/);
    expect(forMatch).not.toBeNull();
    expect(idMatch).not.toBeNull();
    expect(forMatch![1]).toBe(idMatch![1]);
  });

  it('renders error text and marks the input invalid', async () => {
    const html = await render(FormField, {
      label: 'Email',
      name: 'email',
      error: 'Enter a valid email address',
      lang: 'en',
    });
    expect(html).toContain('Enter a valid email address');
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
    expect(html).toContain('form-input--invalid');
  });

  it('renders helper text when provided', async () => {
    const html = await render(FormField, {
      label: 'Phone',
      name: 'phone',
      helper: 'We only use this to send you OTPs.',
      lang: 'en',
    });
    expect(html).toContain('We only use this to send you OTPs.');
  });
});

// ---------------------------------------------------------------------------
// Toast (design-system.md §7.12)
// ---------------------------------------------------------------------------

describe('Toast', () => {
  it('renders success/failure classes and aria-live="polite"', async () => {
    const successHtml = await render(Toast, { kind: 'success', lang: 'en' }, { default: 'Flag submitted.' });
    const failureHtml = await render(Toast, { kind: 'failure', lang: 'en' }, { default: 'Something failed.' });
    expect(successHtml).toContain('toast--success');
    expect(successHtml).toContain('aria-live="polite"');
    expect(failureHtml).toContain('toast--failure');
  });
});

// ---------------------------------------------------------------------------
// ModalShell (design-system.md §7.9) — pure-logic tests over a minimal fake
// dialog built on Node's built-in EventTarget (no jsdom dependency needed).
// ---------------------------------------------------------------------------

class FakeDialog extends EventTarget {
  open = false;
  private children: HTMLElement[] = [];

  showModal(): void {
    this.open = true;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  }

  querySelectorAll(): HTMLElement[] {
    return this.children;
  }
}

describe('ModalController', () => {
  it('Escape triggers close()', () => {
    const dialog = new FakeDialog();
    const controller = new ModalController(dialog as unknown as ConstructorParameters<typeof ModalController>[0]);
    const opener = { focus: vi.fn() };

    controller.open(opener);
    expect(dialog.open).toBe(true);

    const escapeEvent = new Event('keydown') as Event & { key: string; shiftKey: boolean };
    escapeEvent.key = 'Escape';
    escapeEvent.shiftKey = false;
    dialog.dispatchEvent(escapeEvent);

    expect(dialog.open).toBe(false);
  });

  it('returns focus to the opener element when the dialog closes', () => {
    const dialog = new FakeDialog();
    const controller = new ModalController(dialog as unknown as ConstructorParameters<typeof ModalController>[0]);
    const opener = { focus: vi.fn() };

    controller.open(opener);
    controller.close();

    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('a scrim click (target === dialog) closes the dialog', () => {
    const dialog = new FakeDialog();
    const controller = new ModalController(dialog as unknown as ConstructorParameters<typeof ModalController>[0]);
    const opener = { focus: vi.fn() };

    controller.open(opener);

    const clickEvent = new Event('click');
    Object.defineProperty(clickEvent, 'target', { value: dialog });
    dialog.dispatchEvent(clickEvent);

    expect(dialog.open).toBe(false);
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });
});

describe('computeTabTrapTarget (pure)', () => {
  it('wraps Shift+Tab from the first element to the last', () => {
    const first = {} as HTMLElement;
    const last = {} as HTMLElement;
    const target = computeTabTrapTarget('Tab', true, [first, last], first);
    expect(target).toBe(last);
  });

  it('wraps Tab from the last element to the first', () => {
    const first = {} as HTMLElement;
    const last = {} as HTMLElement;
    const target = computeTabTrapTarget('Tab', false, [first, last], last);
    expect(target).toBe(first);
  });

  it('returns null for a non-Tab key', () => {
    const first = {} as HTMLElement;
    const last = {} as HTMLElement;
    expect(computeTabTrapTarget('Escape', false, [first, last], first)).toBeNull();
  });

  it('returns null when focus is not on a trap boundary', () => {
    const first = {} as HTMLElement;
    const middle = {} as HTMLElement;
    const last = {} as HTMLElement;
    expect(computeTabTrapTarget('Tab', false, [first, middle, last], middle)).toBeNull();
  });
});

describe('getFocusableElements (pure)', () => {
  it('delegates to querySelectorAll with the shared focusable selector', () => {
    const seen: string[] = [];
    const fakeContainer = {
      querySelectorAll(selector: string) {
        seen.push(selector);
        return [] as unknown as NodeListOf<HTMLElement>;
      },
    } as unknown as ParentNode;

    getFocusableElements(fakeContainer);
    expect(seen[0]).toContain('a[href]');
    expect(seen[0]).toContain('button:not([disabled])');
  });
});

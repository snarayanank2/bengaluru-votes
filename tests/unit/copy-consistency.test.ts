import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { t } from '../../src/i18n';
import en from '../../src/i18n/en.json';
import kn from '../../src/i18n/kn.json';

const strings = (table: Record<string, unknown>) =>
  Object.entries(table).filter((entry): entry is [string, string] => !entry[0].startsWith('__') && typeof entry[1] === 'string');

describe('UI copy consistency', () => {
  // The citizen-facing flag action has one name per language: the trigger
  // button and the dialog it opens read the same.
  it.each(['en', 'kn'] as const)('%s: the flag trigger and the modal title are the same words', (lang) => {
    expect(t(lang, 'flag.modal.title')).toBe(t(lang, 'common.flagError'));
  });

  it('kn: the flag action does not mix in "ದೋಷ" (error) or the staff word "ಫ್ಲ್ಯಾಗ್" in citizen-facing strings', () => {
    for (const key of ['common.flagError', 'flag.modal.title', 'flag.modal.submit', 'compare.flagError.label']) {
      expect(t('kn', key, { name: 'x' })).not.toMatch(/ದೋಷ|ಫ್ಲ್ಯಾಗ್/);
    }
  });

  // "Voted in {ward}": the ward is a complete public label ("Ward 1 Ramaswamy
  // Palya") built at run time, so no case suffix may be glued to it.
  it('the vote-lock sentence takes a complete ward label in both languages, with no detached suffix', () => {
    for (const lang of ['en', 'kn'] as const) {
      const sentence = t(lang, 'ward.vote.votedElsewhere');
      expect(sentence).toContain('{ward}');
      expect(sentence).not.toMatch(/\{ward\}\s+ನಲ್ಲಿ/);
    }
    expect(t('kn', 'ward.vote.votedElsewhere', { ward: 'ವಾರ್ಡ್ 1 ರಾಮಸ್ವಾಮಿ ಪಾಳ್ಯ' })).toContain('ವಾರ್ಡ್ 1 ರಾಮಸ್ವಾಮಿ ಪಾಳ್ಯ.');
  });

  // Singular and plural are separate strings, not a "(s)" placeholder.
  it.each([['en', en], ['kn', kn]] as const)('%s: no pluralisation placeholder like "flag(s)"', (_lang, table) => {
    const offenders = strings(table).filter(([, value]) => /\w\(s\)/i.test(value) || /\(ಗಳು\)/.test(value));
    expect(offenders.map(([key]) => key)).toEqual([]);
  });

  it('a pending-flag count has a singular and a plural', () => {
    expect(t('en', 'curator.dashboard.queueCountOne')).toBe('1 pending flag across the city');
    expect(t('en', 'curator.dashboard.queueCount', { count: 4 })).toBe('4 pending flags across the city');
  });
});

describe('contrast: text on the editorial red', () => {
  const tokens = readFileSync('src/styles/tokens.css', 'utf8');
  const hex = (name: string): string => {
    const value = tokens.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
    if (!value) throw new Error(`token ${name} not found`);
    return value;
  };
  const luminance = (color: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it('the colour for text on --hero-alert reaches AA for normal text (4.5:1)', () => {
    expect(tokens).toContain('--color-on-hero-alert: var(--white);');
    expect(ratio('#ffffff', hex('--hero-alert'))).toBeGreaterThanOrEqual(4.5);
  });

  // The measured failure this guards: the muted label colour of the green tiles on the red tile was 2.56:1.
  it('the muted hero label colour is NOT used on the red tile', () => {
    expect(ratio(hex('--hero-muted'), hex('--hero-alert'))).toBeLessThan(4.5);
    const home = readFileSync('src/features/pages/Home.astro', 'utf8');
    const accentText = home.match(/\.hero-stat--accent strong,\s*\.hero-stat--accent span \{[^}]*\}/)![0];
    expect(accentText).toContain('var(--color-on-hero-alert)');
  });
});

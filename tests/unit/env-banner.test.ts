import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveEnvBanner, envBannerKey, type EnvBanner } from '../../src/lib/env-banner';

const EN = JSON.parse(readFileSync(new URL('../../src/i18n/en.json', import.meta.url), 'utf8'));
const KN = JSON.parse(readFileSync(new URL('../../src/i18n/kn.json', import.meta.url), 'utf8'));

describe('src/lib/env-banner.ts#resolveEnvBanner', () => {
  it('maps the two deployed environments to their own banner', () => {
    expect(resolveEnvBanner('staging')).toBe('staging');
    expect(resolveEnvBanner('production')).toBe('production');
  });

  it('shows NO banner when APP_ENV is absent — the local/dev/test default', () => {
    expect(resolveEnvBanner(undefined)).toBeNull();
    expect(resolveEnvBanner('')).toBeNull();
  });

  // These come from hand-edited YAML, so they arrive however someone typed them.
  it.each(['  staging  ', 'STAGING', 'Production', '\tproduction\n'])(
    'tolerates surrounding whitespace and casing: %j',
    (raw) => {
      expect(resolveEnvBanner(raw)).not.toBeNull();
    },
  );

  // The failure that would actually hurt is a typo resolving to the WRONG
  // environment — e.g. showing "Testing site: Go away!" to real citizens on
  // production. Degrading to no banner is the safe direction.
  it.each(['stage', 'prod', 'preview', 'local', 'true', 'staging-2'])(
    'falls back to no banner rather than guessing: %j',
    (raw) => {
      expect(resolveEnvBanner(raw)).toBeNull();
    },
  );
});

describe('src/lib/env-banner.ts#envBannerKey', () => {
  const variants: EnvBanner[] = ['staging', 'production'];

  it.each(variants)('%s resolves to a key that exists in BOTH languages', (variant) => {
    const key = envBannerKey(variant);
    // t() throws on a missing key outside production, so a key present in
    // en.json but not kn.json would blow up every Kannada page at request
    // time rather than degrade — assert both sides here.
    expect(EN[key], `${key} missing from en.json`).toBeTruthy();
    expect(KN[key], `${key} missing from kn.json`).toBeTruthy();
  });

  it.each(variants)('%s copy carries a translation hint for the regeneration prompt', (variant) => {
    expect(EN.__hints[envBannerKey(variant)]).toBeTruthy();
  });

  it('production copy keeps the launch date intact in both languages', () => {
    // The hint tells the translator to render the date, never to translate
    // it as a word — if the day number vanishes, the banner is wrong.
    expect(EN['banner.production']).toContain('15');
    expect(KN['banner.production']).toContain('15');
  });
});

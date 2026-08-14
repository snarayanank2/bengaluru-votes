/**
 * Coverage for src/lib/maps-config.ts (spec §8). The kill switch and the
 * "unset key degrades to a no-op" rule from CLAUDE.md both live here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mapsConfig } from '../../src/lib/maps-config';

const KEYS = ['MAPS_ENABLED', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAPS_MAP_ID'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

describe('mapsConfig', () => {
  it('is disabled when nothing is set', () => {
    expect(mapsConfig()).toEqual({ enabled: false, browserKey: '', mapId: '' });
  });

  it('is disabled when the key is set but MAPS_ENABLED is not', () => {
    process.env.GOOGLE_MAPS_BROWSER_KEY = 'k';
    expect(mapsConfig().enabled).toBe(false);
  });

  it('is disabled when MAPS_ENABLED is true but the key is missing', () => {
    process.env.MAPS_ENABLED = 'true';
    expect(mapsConfig().enabled).toBe(false);
  });

  it('is disabled when MAPS_ENABLED is true and a key is present but the Map ID is missing', () => {
    process.env.MAPS_ENABLED = 'true';
    process.env.GOOGLE_MAPS_BROWSER_KEY = 'k';
    expect(mapsConfig().enabled).toBe(false);
  });

  it('is enabled only when MAPS_ENABLED is exactly "true" and a key is present', () => {
    process.env.MAPS_ENABLED = 'true';
    process.env.GOOGLE_MAPS_BROWSER_KEY = 'k';
    process.env.GOOGLE_MAPS_MAP_ID = 'm';
    expect(mapsConfig()).toEqual({ enabled: true, browserKey: 'k', mapId: 'm' });
  });

  it('treats any other MAPS_ENABLED value as off', () => {
    process.env.GOOGLE_MAPS_BROWSER_KEY = 'k';
    for (const v of ['1', 'yes', 'TRUE', 'on', '']) {
      process.env.MAPS_ENABLED = v;
      expect(mapsConfig().enabled).toBe(false);
    }
  });
});

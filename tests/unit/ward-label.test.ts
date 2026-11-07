import { describe, it, expect } from 'vitest';
import { wardLabel, zoneLabel, bareWardName } from '../../src/lib/ward-label';
import { formatWardLabel } from '../../src/lib/ward-label-format';
import { t } from '../../src/i18n';

const WARD = { id: 1024, nameEn: '24 - Agaram', nameKn: '24 - ಅಗರಂ' };

describe('ward place label (src/lib/ward-label.ts)', () => {
  it('is "Ward 24 Agaram": the public number and the bare name, never the stored "24 - Agaram"', () => {
    expect(wardLabel('en', WARD)).toBe('Ward 24 Agaram');
  });

  it('uses the same shape in Kannada', () => {
    expect(wardLabel('kn', WARD)).toBe('ವಾರ್ಡ್ 24 ಅಗರಂ');
  });

  it('numbers by the ward within its corporation, not the route id', () => {
    expect(wardLabel('en', { id: 3049, nameEn: '49 - Shivanasamudra', nameKn: '' })).toBe('Ward 49 Shivanasamudra');
  });

  it('the island helper builds the identical label from the server-rendered template', () => {
    for (const lang of ['en', 'kn'] as const) {
      expect(formatWardLabel(t(lang, 'nav.ward'), lang, WARD)).toBe(wardLabel(lang, WARD));
    }
  });

  it('falls back to the English name when a Kannada name is missing', () => {
    expect(formatWardLabel('Ward {wardNumber} {wardName}', 'kn', { id: 1005, nameEn: '5 - Demo', nameKn: '' })).toBe('Ward 5 Demo');
  });

  it('bareWardName strips only a leading number', () => {
    expect(bareWardName('14 - Hebbal')).toBe('Hebbal');
    expect(bareWardName('Hebbal 2')).toBe('Hebbal 2');
  });
});

describe('zoneLabel', () => {
  const ZONES = [
    'Rajarajeshwarinagar', 'Yelahanka', 'K.R. Pura', 'Byatarayanapura', 'Mahadevapura',
    'C.V. Raman Nagar', 'Jayanagar', 'Gandhinagara', 'Bommanahalli', 'Malleshwaram',
  ];

  // The data carries only English zone names; the Kannada reading is a UI string.
  it.each(ZONES)('%s has a Kannada reading in Kannada script, and is unchanged in English', (zone) => {
    expect(zoneLabel('en', zone)).toBe(zone);
    expect(zoneLabel('kn', zone)).toMatch(/[ಀ-೿]/);
    expect(zoneLabel('kn', zone)).not.toBe(zone);
  });

  it('shows an unknown zone as stored rather than failing', () => {
    expect(zoneLabel('kn', 'Zone T')).toBe('Zone T');
  });
});

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadWardOgRows, wardOgImage, wardOgMeta, wardOgPath, wardOgText, WARD_OG_HEIGHT, WARD_OG_WIDTH } from '../../src/lib/ward-og';

const rows = loadWardOgRows(join(process.cwd(), 'data/gba.geojson'));

describe('ward share images (task 196)', () => {
  it('maps every ward to a unique id with names in both languages', () => {
    expect(rows).toHaveLength(369);
    expect(new Set(rows.map((r) => r.id)).size).toBe(369);
    const ward = rows.find((r) => r.id === 5036)!;
    expect(ward.corporation).toBe('west');
    expect(wardOgText('en', ward)).toEqual({ name: 'Nalwadi Krishnaraja Wadiyar Ward', detail: 'Ward 36 · West Corporation' });
    expect(wardOgText('kn', ward)).toEqual({
      name: 'ನಾಲ್ವಡಿ ಕೃಷ್ಣರಾಜ ಒಡೆಯರ್ ವಾರ್ಡ್',
      detail: 'ವಾರ್ಡ್ 36 · ಪಶ್ಚಿಮ ನಗರ ಪಾಲಿಕೆ',
    });
  });

  it('names files by ward id and language', () => {
    expect(wardOgPath(3049, 'en')).toBe('/og/ward/3049-en.png');
    expect(wardOgPath(3049, 'kn')).toBe('/og/ward/3049-kn.png');
  });

  it('has a 1200x630 PNG under 300 KB for every ward and language', () => {
    for (const ward of rows) {
      for (const lang of ['en', 'kn'] as const) {
        const file = join(process.cwd(), 'public', wardOgPath(ward.id, lang));
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size, file).toBeLessThan(300 * 1024);
        const head = readFileSync(file).subarray(0, 24);
        expect(head.readUInt32BE(16), file).toBe(WARD_OG_WIDTH);
        expect(head.readUInt32BE(20), file).toBe(WARD_OG_HEIGHT);
      }
    }
  });

  it('falls back to the default image when a ward has no file', () => {
    expect(wardOgImage(3049, 'en')).toBe('/og/ward/3049-en.png');
    expect(wardOgImage(94101, 'en')).toBeUndefined();
    expect(wardOgMeta('en', { id: 94101, corporation: 'north', nameEn: 'X', nameKn: 'ಎಕ್ಸ್' })).toEqual({});
  });
});

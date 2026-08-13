/**
 * Coverage for src/lib/maps-links.ts (spec §7). A plain Google Maps deep
 * link — no API, no key, no billing, and it works with JS off.
 */
import { describe, it, expect } from 'vitest';
import { directionsUrl } from '../../src/lib/maps-links';

describe('directionsUrl', () => {
  it('builds a Maps directions URL from a lat/lng pair', () => {
    const url = new URL(directionsUrl('12.9716', '77.5946'));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('destination')).toBe('12.9716,77.5946');
  });

  it('encodes the destination rather than interpolating raw', () => {
    expect(directionsUrl('12.9716', '77.5946')).toContain('destination=12.9716%2C77.5946');
  });
});

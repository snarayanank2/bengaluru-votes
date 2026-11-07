/**
 * Google Maps deep links (booth directions; no API, no key).
 *
 * Deliberately NOT an API call: this builds a plain URL a citizen's browser
 * or Maps app opens. No key, no billing, no quota.
 *
 * Shared by BOTH booth render paths (BoothLookup.ts's renderBooth, and the
 * server-rendered result in BoothLookupForm.astro, which only the unrouted
 * FindBooth.astro still uses) so the two cannot drift.
 */
export function directionsUrl(lat: string, lng: string): string {
  const params = new URLSearchParams({ api: '1', destination: `${lat},${lng}` });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

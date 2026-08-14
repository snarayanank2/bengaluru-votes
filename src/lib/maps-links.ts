/**
 * Google Maps deep links (spec §7).
 *
 * Deliberately NOT an API call: this builds a plain URL a citizen's browser
 * or Maps app opens. No key, no billing, no quota, and the link works with
 * JavaScript disabled — which matters, because /voting-guide/find-booth's
 * whole no-JS path server-renders its results.
 *
 * Shared by BOTH booth render paths (FindBooth.astro's POST branch and
 * BoothLookup.ts's renderBooths) so the two cannot drift.
 */
export function directionsUrl(lat: string, lng: string): string {
  const params = new URLSearchParams({ api: '1', destination: `${lat},${lng}` });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

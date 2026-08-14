/**
 * The three Google Maps Platform settings, read once per render (spec §8).
 *
 * BUILD-TIME TRAP — do not "simplify" these into PUBLIC_* variables.
 * Astro inlines `PUBLIC_*` at build time. An image built without the value
 * would serve every GET a healthy 200 and a silently broken map, with
 * nothing in `docker compose ps`, the healthcheck, or the logs to say so —
 * the same failure mode CLAUDE.md documents for SITE_ORIGIN. These are read
 * in server frontmatter and handed to the island as data attributes, which
 * keeps them runtime config a container restart can change.
 *
 * `enabled` requires the kill switch, a key, AND a Map ID: an unset key
 * degrades to a documented no-op rather than an error (CLAUDE.md), and
 * MAPS_ENABLED lets client-side map spend be shed without a rebuild when a
 * budget alert fires (docs/gcp.md §5 — a GCP quota cap breaks rather than
 * degrades). The Map ID is required, not merely recommended: it is what
 * carries the cloud map *style*, so requiring it here is what keeps the
 * styling question answerable in code at all.
 *
 * BUT NOTE WHAT THIS DOES AND DOESN'T GUARANTEE. This check can only verify
 * that a Map ID EXISTS — it cannot verify that a style is bound to it. As of
 * 2026-08-14 no style is bound (a deliberate decision, recorded in
 * design-system §8.1), so production renders a stock full-colour Google
 * basemap with business POIs and Google's own red place markers. Do not read
 * this gate as enforcing design-system §8's "desaturated gray basemap … no
 * red pins" — that half is currently unimplemented, and the only enforceable
 * part lives in src/islands/WardMap.ts, which draws the boundary from CSS
 * custom properties and adds no markers of its own.
 *
 * `=== 'true'` exactly, matching the OTP_TEST_SINK convention in
 * src/lib/otp.ts.
 */
export interface MapsConfig {
  enabled: boolean;
  browserKey: string;
  mapId: string;
}

export function mapsConfig(): MapsConfig {
  const browserKey = process.env.GOOGLE_MAPS_BROWSER_KEY ?? '';
  const mapId = process.env.GOOGLE_MAPS_MAP_ID ?? '';

  return {
    enabled: process.env.MAPS_ENABLED === 'true' && browserKey !== '' && mapId !== '',
    browserKey,
    mapId,
  };
}

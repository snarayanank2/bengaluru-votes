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
 * degrades). The Map ID is required, not merely recommended: it carries the
 * cloud map *style*, and docs/gcp.md §4 states the styling constraint as a
 * rule, not a preference — nothing on a ward map may read as
 * party-affiliated, and no marker may be red (design-system §8). This
 * `enabled` check is the only place in code that rule can be enforced: with
 * a key set and the Map ID missing, the ward page would otherwise render a
 * stock full-colour Google basemap with business POIs on a real election
 * site.
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

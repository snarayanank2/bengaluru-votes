/**
 * Bridge between the BBMP electoral API's ward vocabulary and ours.
 *
 * The two ward sets are the same 369 wards: every (corporation, ward number)
 * pair upstream serves from `GET /wards/{corp_id}` exists in
 * `data/gba.geojson`, and vice versa. Only the ward NAMES differ, in 12 of
 * 369 cases — eleven are spelling variants ("Attigupe"/"Attiguppe",
 * "Amruthahalli"/"Amurthahalli") and one is a real disagreement: East 49 is
 * "Shivanasamudra Ward" in our source and "Doddakannelli Ward" in theirs.
 *
 * ============================================================================
 * THE CORPORATION IDS ARE NOT THE SAME NUMBERS. Load-bearing.
 *
 *   upstream (GET /corporations):  Central 1, North 2, South 3, East 4, West 5
 *   data/gba.geojson:              Central 1, North 2, East  3, South 4, West 5
 *
 * East and South are transposed. `wards.id` is `corporation_id * 1000 +
 * ward_id` built from the GEOJSON id (scripts/seed-wards.ts), so mapping an
 * upstream record through its own `corp_id` sends all 50 East voters to a
 * South ward and 72 South voters to a nonexistent East one — and every one
 * of those resolves to a real, plausible-looking ward page. There is no
 * error to notice.
 *
 * So: map by corporation NAME, never by the upstream integer. The name is
 * stable, unambiguous, and only five values wide.
 * ============================================================================
 *
 * The ward NUMBER comes from the leading integer of the upstream
 * `ward_name` ("49 - Doddakannelli Ward" -> 49), which is the only part of
 * that string we trust — the name text after it is theirs, not ours, and the
 * platform displays our own name throughout.
 *
 * This module is pure: no database, no network. Confirming that the id it
 * computes is a ward that actually exists is `src/lib/booth-lookup.ts`'s job.
 */

/**
 * Upstream corporation name (lowercased) -> the corporation id used by
 * `data/gba.geojson` and therefore by `wards.id`. NOT the upstream `corp_id`
 * — see the header.
 */
export const UPSTREAM_CORPORATION_IDS: Readonly<Record<string, number>> = Object.freeze({
  central: 1,
  north: 2,
  east: 3,
  south: 4,
  west: 5,
});

/**
 * Resolve an upstream (corporation name, ward name) pair to a `wards.id`.
 * Returns `null` when the corporation is unrecognized or the ward name
 * carries no usable leading number — callers fall back to point-in-polygon
 * on the polling station's coordinates rather than guessing.
 */
export function upstreamWardId(corporationName: string, wardName: string): number | null {
  const corporationId = UPSTREAM_CORPORATION_IDS[corporationName.trim().toLowerCase()];
  if (corporationId === undefined) {
    return null;
  }

  const match = /^\s*(\d+)\s*-/.exec(wardName);
  if (!match) {
    return null;
  }

  const wardNumber = Number(match[1]);
  // Guard the composite key: ward numbers are 1..112 city-wide, and anything
  // >= 1000 would overflow into the next corporation's id range.
  if (!Number.isInteger(wardNumber) || wardNumber < 1 || wardNumber >= 1000) {
    return null;
  }

  return corporationId * 1000 + wardNumber;
}

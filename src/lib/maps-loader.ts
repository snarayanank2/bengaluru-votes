/**
 * The one place this app configures the Google Maps JavaScript API.
 *
 * CLIENT-SAFE. This module ships to the browser — it must never import
 * anything with a Node dependency (`src/lib/geo.ts` pulls in `node:fs`, for
 * example). It exists so the two islands that need the Maps API —
 * `src/islands/WardMap.ts` (ward boundary, on `/ward/*`) and
 * `src/islands/WardLookup.ts` (Places Autocomplete, on `/`) — cannot
 * disagree about how it is configured.
 *
 * WHY A GUARD AT ALL. `setOptions()` is PROCESS-GLOBAL: it may take effect
 * once, before any `importLibrary()` call, and later calls are ignored (with
 * a console warning in dev). Two islands calling it independently would be a
 * duplicated write to one piece of global state, where the winner depends on
 * which island happened to mount first. So it is called exactly once here,
 * and the first caller's key wins for the whole page.
 *
 * That is safe in practice because both keys come from the same server
 * frontmatter (`src/lib/maps-config.ts` -> a `data-maps-key` attribute), so
 * they are always the same value. If a future page ever renders two
 * different keys, this is the function that would need to learn about it.
 *
 * NOTE ON THE LOADER API. `@googlemaps/js-api-loader` v2 removed the
 * `Loader` class in all but name — it is still exported, but its constructor
 * throws unconditionally (`MSG_DEPRECATED_LOADER`). The functional API below
 * (`setOptions` + `importLibrary`) is the only one that works. Code written
 * against `new Loader(...)` type-checks, passes a mocked test, and fails in
 * every real browser.
 */
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

let configured = false;

/**
 * Configure the Maps JS API with `apiKey`, once per page. Subsequent calls
 * are no-ops regardless of the key passed — see the header for why.
 */
export function configureMapsApi(apiKey: string): void {
  if (configured) return;
  configured = true;
  setOptions({ key: apiKey, v: 'weekly' });
}

/**
 * Re-exported so callers import the loader through this module rather than
 * reaching for `@googlemaps/js-api-loader` directly — which is what keeps
 * `configureMapsApi` from being bypassed by accident.
 *
 * Remember which library a symbol lives in: `Map` is in `maps`, but
 * `LatLngBounds` is in `core`, and `PlaceAutocompleteElement` is in
 * `places`.
 */
export { importLibrary };

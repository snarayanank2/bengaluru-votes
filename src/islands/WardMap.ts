/**
 * WardMap — the ward boundary map (IA §3.2), on the Google Maps JavaScript
 * API. Migrated from MapLibre 2026-08-13; design
 * docs/superpowers/specs/2026-08-13-google-maps-migration-design.md §5.
 *
 * The basemap is styled by a cloud Map ID (docs/gcp.md §4), NOT in code —
 * that is what satisfies design-system.md §8's "desaturated gray basemap",
 * and it is why `buildBaseStyle()` (MapLibre's flat background layer, the
 * closest thing this page had to a basemap) is gone. The ward polygon
 * itself is still drawn here, and its colors are still read off the page's
 * CSS custom properties at init time (`readMapColors`) rather than
 * hardcoded: tests/unit/tokens.test.ts bans hex literals anywhere under
 * src/ except tokens.css. Per design-system.md §8 the boundary is
 * `--oc-forest` at 2px over a 30% `--forest-tint` fill; no marker or pin is
 * ever created, and nothing here is keyed to party/candidate data.
 *
 * FAILING CLOSED IS THE CONTRACT. The container carries a server-rendered
 * fallback (`ward.map.fallback` — Ward.astro). Every failure path below
 * leaves it in place, and the container is cleared ONLY once a real map
 * object exists — after which any further failure puts the fallback back.
 * A working map is a bonus; the ward page never depends on one. Two
 * Google-specific failures the pre-migration MapLibre code did not have to
 * handle:
 *
 *   - the loader promise rejecting (script blocked, offline, CSP), and
 *   - `window.gm_authFailure`, which fires AFTER a successful script load
 *     when the key is rejected (bad referrer, billing off). It arrives
 *     asynchronously, long after `mountWardMap` has returned, so it has to
 *     put the fallback BACK.
 *
 * `gm_authFailure` is a GLOBAL, SINGLE-SLOT window callback — not per-map.
 * Exactly one handler is created here, and every mounted container
 * registers itself with it (`mounted`). A second map island added later
 * must reuse this registry rather than assigning `window.gm_authFailure`
 * again, or it will silently clobber this one and its containers will keep
 * a blank map forever.
 *
 * `setOptions()` from the loader is process-global in the same way: it may
 * be called once, before any `importLibrary()`, and later calls are ignored
 * (with a console warning in dev). Hence `configureMapsApi`'s guard — the
 * first container's key wins for the whole page.
 *
 * The key and Map ID arrive as data attributes from server frontmatter
 * (Ward.astro -> src/lib/maps-config.ts), never as build-time PUBLIC_*
 * variables — see that module's header for why.
 */
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

// ---------------------------------------------------------------------------
// Minimal GeoJSON shapes — mirrors `WardBoundaryFeature` in src/lib/geo.ts,
// which is what /ward/<id>/boundary.json returns. Declared structurally here
// rather than imported so this client bundle never pulls in the server's geo
// module (and, through it, node:fs).
// ---------------------------------------------------------------------------

type Position = [number, number, ...number[]];

export interface WardBoundaryFeatureLike {
  type: 'Feature';
  properties: { id: string; wardId: number };
  geometry: { type: string; coordinates: unknown };
}

type LngLatBounds = [[number, number], [number, number]];

// ---------------------------------------------------------------------------
// Pure helpers — exported for direct unit testing (no Google API, no network).
// ---------------------------------------------------------------------------

/** Recursively visits every [lng, lat, ...] position in a Polygon/MultiPolygon tree. */
function visitPositions(coords: unknown, visit: (pos: Position) => void): void {
  if (!Array.isArray(coords) || coords.length === 0) return;
  if (typeof coords[0] === 'number') {
    visit(coords as Position);
    return;
  }
  for (const child of coords as unknown[]) visitPositions(child, visit);
}

/** Bounding box `[[minLng, minLat], [maxLng, maxLat]]` for a Polygon or MultiPolygon. */
export function computeFeatureBounds(feature: WardBoundaryFeatureLike): LngLatBounds {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  visitPositions(feature.geometry.coordinates, ([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export interface WardMapColors {
  fill: string;
  line: string;
}

/**
 * Reads the two polygon colors off `root`'s computed CSS custom properties
 * (design-system.md §8: `--forest-tint` fill, `--oc-forest` boundary line).
 * Never hardcodes a hex value; the named-color fallbacks are reached only if
 * tokens.css failed to load and are deliberately neutral — no red, no party
 * hue. The basemap background is no longer read here: the cloud Map ID owns
 * it now, where `buildBaseStyle`'s empty background layer used to.
 */
export function readMapColors(root: HTMLElement = document.documentElement): WardMapColors {
  const style = getComputedStyle(root);
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;

  return {
    fill: read('--forest-tint', 'gray'),
    line: read('--oc-forest', 'darkslategray'),
  };
}

// ---------------------------------------------------------------------------
// Process-global Google state: one API configuration, one auth-failure
// handler, many containers. See the file header.
// ---------------------------------------------------------------------------

/** Containers whose fallback must be restored if Google rejects the key. */
const mounted = new Map<HTMLElement, string>();

let mapsApiConfigured = false;

function configureMapsApi(apiKey: string): void {
  if (mapsApiConfigured) return;
  mapsApiConfigured = true;
  setOptions({ key: apiKey, v: 'weekly' });
}

function restoreFallback(container: HTMLElement, fallbackHtml: string): void {
  container.innerHTML = fallbackHtml;
}

/**
 * The one `gm_authFailure` handler. Created once at module scope so its
 * identity is stable for the lifetime of the page — `installAuthFailureHandler`
 * below compares against it rather than tracking a boolean, so that the slot
 * being emptied (or never populated) still results in exactly one handler
 * rather than none.
 */
function handleAuthFailure(): void {
  for (const [container, fallbackHtml] of mounted) restoreFallback(container, fallbackHtml);
  mounted.clear();
}

function installAuthFailureHandler(): void {
  const win = window as unknown as { gm_authFailure?: () => void };
  if (win.gm_authFailure === handleAuthFailure) return;
  win.gm_authFailure = handleAuthFailure;
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

/**
 * Fetches this ward's boundary, loads the Maps JS API, and mounts a map into
 * `container`. Any failure — missing attribute, network error, non-2xx, a
 * body that is not a Feature, loader rejection — returns without touching
 * `container`, leaving its server-rendered fallback exactly as the server
 * sent it. Failures after the container has been taken over put the fallback
 * back: a ward page showing a bare basemap with no boundary on it is worse
 * than one showing the fallback text. Exported for direct testing.
 */
export async function mountWardMap(container: HTMLElement): Promise<void> {
  const boundaryUrl = container.dataset.boundaryUrl;
  const apiKey = container.dataset.mapsKey;
  const mapId = container.dataset.mapsMapId;
  if (!boundaryUrl || !apiKey) return;

  let feature: WardBoundaryFeatureLike;
  try {
    const res = await fetch(boundaryUrl);
    if (!res.ok) return;
    feature = (await res.json()) as WardBoundaryFeatureLike;
  } catch {
    return;
  }

  if (feature?.type !== 'Feature' || !feature.geometry) return;

  // `Map` lives in the `maps` library and `LatLngBounds` in `core`. Both are
  // taken off the objects `importLibrary` resolves with, never off the
  // `google.maps` global: that global only exists as a side effect of the
  // loader script, so depending on it would couple this island to script
  // load order and make it untestable.
  let maps: google.maps.MapsLibrary;
  let core: google.maps.CoreLibrary;
  try {
    configureMapsApi(apiKey);
    [maps, core] = await Promise.all([importLibrary('maps'), importLibrary('core')]);
  } catch {
    // Script blocked, offline, or refused by CSP. Fallback stays.
    return;
  }

  const colors = readMapColors();
  const [[minLng, minLat], [maxLng, maxLat]] = computeFeatureBounds(feature);

  // Everything that can fail before a map exists has now succeeded, so it is
  // safe to take the container over. Keep the fallback markup: gm_authFailure
  // (and the catch below) must be able to put it back.
  const fallbackHtml = container.innerHTML;
  container.textContent = '';

  try {
    const map = new maps.Map(container, {
      mapId: mapId || undefined,
      disableDefaultUI: true,
      clickableIcons: false,
    });

    mounted.set(container, fallbackHtml);
    installAuthFailureHandler();

    map.data.addGeoJson(feature);
    map.data.setStyle({
      fillColor: colors.fill,
      fillOpacity: 0.3,
      strokeColor: colors.line,
      strokeWeight: 2,
      clickable: false,
    });

    map.fitBounds(new core.LatLngBounds({ lat: minLat, lng: minLng }, { lat: maxLat, lng: maxLng }), 24);
  } catch {
    mounted.delete(container);
    restoreFallback(container, fallbackHtml);
  }
}

/**
 * Wires every `[data-ward-map]` container under `root`. Safe to call when
 * none is present (does nothing) — which is exactly what happens when
 * MAPS_ENABLED is off, since Ward.astro then renders the fallback without
 * the `data-ward-map` hook.
 *
 * Lazy: the map is constructed only once its container scrolls into view, so
 * a ward page whose map sits below the fold never spends a (billed) map load
 * on a visitor who never sees it — spec §2. Falls back to mounting
 * immediately where IntersectionObserver is absent.
 */
export function initWardMap(root: ParentNode = document): void {
  const containers = Array.from(root.querySelectorAll<HTMLElement>('[data-ward-map]'));
  if (containers.length === 0) return;

  if (typeof IntersectionObserver === 'undefined') {
    for (const container of containers) void mountWardMap(container);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      void mountWardMap(entry.target as HTMLElement);
    }
  });

  for (const container of containers) observer.observe(container);
}

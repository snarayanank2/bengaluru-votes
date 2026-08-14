// @vitest-environment jsdom
/**
 * Coverage for src/islands/WardMap.ts (Google Maps migration, spec §5).
 *
 * A real Google map needs network and a WebGL canvas jsdom does not
 * provide, so this file exercises the pure helpers directly and mocks
 * `@googlemaps/js-api-loader` for the wiring. The cases that matter most are
 * the failure ones: the container's server-rendered fallback must survive
 * every way this island can fail, including the two Google-specific shapes
 * (the loader promise rejecting, and `gm_authFailure` firing asynchronously
 * after an apparently successful mount).
 *
 * Note what is deliberately absent from this file: any `google` global. The
 * island must take `Map` and `LatLngBounds` off the library objects
 * `importLibrary()` resolves with, never off `window.google.maps` — the
 * global exists only as a side effect of the real loader script, so
 * depending on it would couple the island to load order and make exactly
 * these tests impossible.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `vi.mock` factories are hoisted above the rest of the file, so everything
// they close over has to be created inside `vi.hoisted` rather than as a
// plain top-level `const` (still in the temporal dead zone when the factory
// runs).
const {
  setOptionsMock,
  setOptionsCalls,
  importLibraryMock,
  MapMock,
  LatLngBoundsMock,
  addGeoJsonMock,
  setStyleMock,
  fitBoundsMock,
} = vi.hoisted(() => {
  const addGeoJsonMock = vi.fn();
  const setStyleMock = vi.fn();
  const fitBoundsMock = vi.fn();
  const MapMock = vi.fn().mockImplementation(() => ({
    data: { addGeoJson: addGeoJsonMock, setStyle: setStyleMock },
    fitBounds: fitBoundsMock,
  }));
  // Returning an object from a constructor makes it the instance, so this
  // records the corners it was built from in a directly assertable shape.
  const LatLngBoundsMock = vi.fn().mockImplementation((sw: unknown, ne: unknown) => ({ sw, ne }));
  const importLibraryMock = vi.fn();
  // `setOptions` configures the API process-wide and is called at most once
  // per module lifetime, so its call history has to outlive the per-test
  // `vi.clearAllMocks()` for the "exactly once" assertion to be independent
  // of which test happens to mount first.
  const setOptionsCalls: unknown[] = [];
  const setOptionsMock = vi.fn((options: unknown) => {
    setOptionsCalls.push(options);
  });
  return {
    setOptionsMock,
    setOptionsCalls,
    importLibraryMock,
    MapMock,
    LatLngBoundsMock,
    addGeoJsonMock,
    setStyleMock,
    fitBoundsMock,
  };
});

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: setOptionsMock,
  importLibrary: importLibraryMock,
}));

import {
  computeFeatureBounds,
  readMapColors,
  mountWardMap,
  initWardMap,
  type WardBoundaryFeatureLike,
} from '../../src/islands/WardMap';

const FEATURE: WardBoundaryFeatureLike = {
  type: 'Feature',
  properties: { id: 'ward_369_final.1', wardId: 1001 },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [77.5, 12.9],
        [77.6, 12.9],
        [77.6, 13.0],
        [77.5, 13.0],
        [77.5, 12.9],
      ],
    ],
  },
};

const FALLBACK = 'Map of ward boundary';

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-ward-map', '');
  el.dataset.boundaryUrl = '/ward/1001/boundary.json';
  el.dataset.mapsKey = 'test-key';
  el.dataset.mapsMapId = 'test-map-id';
  el.innerHTML = `<p class="map-fallback">${FALLBACK}</p>`;
  document.body.appendChild(el);
  return el;
}

/**
 * The real `importLibrary` resolves a different object per library name:
 * `Map` lives in `maps`, `LatLngBounds` in `core`. Mocking that split rather
 * than one merged object is what keeps the test honest — an implementation
 * that reached for `LatLngBounds` on the maps library (or on a `google`
 * global) would fail here exactly as it would in a browser.
 */
function stubLibraries(): void {
  importLibraryMock.mockImplementation(async (name: string) =>
    name === 'core' ? { LatLngBounds: LatLngBoundsMock } : { Map: MapMock },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  stubLibraries();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => FEATURE }));
  delete (window as unknown as Record<string, unknown>).gm_authFailure;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('computeFeatureBounds (pure)', () => {
  it('returns the bbox of a Polygon', () => {
    expect(computeFeatureBounds(FEATURE)).toEqual([
      [77.5, 12.9],
      [77.6, 13.0],
    ]);
  });

  it('spans every polygon of a MultiPolygon', () => {
    const multi: WardBoundaryFeatureLike = {
      ...FEATURE,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [77.5, 12.9],
              [77.6, 12.9],
              [77.5, 12.9],
            ],
          ],
          [
            [
              [77.7, 13.1],
              [77.8, 13.2],
              [77.7, 13.1],
            ],
          ],
        ],
      },
    };
    expect(computeFeatureBounds(multi)).toEqual([
      [77.5, 12.9],
      [77.8, 13.2],
    ]);
  });
});

describe('readMapColors (pure)', () => {
  it('reads only the polygon tokens — the basemap background is the Map ID’s job now (spec §5)', () => {
    const getPropertyValue = vi.fn((name: string) => {
      const values: Record<string, string> = {
        '--gray-100': 'ivory',
        '--forest-tint': 'honeydew',
        '--oc-forest': 'darkolivegreen',
      };
      return values[name] ?? '';
    });
    const spy = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ getPropertyValue } as unknown as CSSStyleDeclaration);

    const colors = readMapColors({} as HTMLElement);

    expect(colors).toEqual({ fill: 'honeydew', line: 'darkolivegreen' });
    expect(getPropertyValue).toHaveBeenCalledWith('--forest-tint');
    expect(getPropertyValue).toHaveBeenCalledWith('--oc-forest');
    expect(getPropertyValue).not.toHaveBeenCalledWith('--gray-100');

    // Restore only THIS spy: `vi.restoreAllMocks()` would also wipe the
    // file-scoped loader mocks every other test depends on.
    spy.mockRestore();
  });

  it('falls back to neutral named colors when tokens are absent', () => {
    const colors = readMapColors(document.documentElement);
    expect(colors.fill).toBeTruthy();
    expect(colors.line).toBeTruthy();
    expect(colors.fill).not.toMatch(/#|red|crimson/i);
    expect(colors.line).not.toMatch(/#|red|crimson/i);
  });
});

describe('mountWardMap — success', () => {
  it('builds a map and draws the boundary', async () => {
    const container = makeContainer();
    await mountWardMap(container);

    expect(MapMock).toHaveBeenCalledTimes(1);
    expect(MapMock.mock.calls[0][0]).toBe(container);
    expect(addGeoJsonMock).toHaveBeenCalledWith(FEATURE);
    expect(container.textContent).not.toContain(FALLBACK);
  });

  it('passes the Map ID from the container through to the map, with no default UI', async () => {
    await mountWardMap(makeContainer());
    expect(MapMock.mock.calls[0][1]).toMatchObject({
      mapId: 'test-map-id',
      disableDefaultUI: true,
    });
  });

  it('styles the polygon from the CSS tokens and adds no marker (design-system.md §8)', async () => {
    await mountWardMap(makeContainer());

    const tokens = readMapColors(document.documentElement);
    expect(setStyleMock).toHaveBeenCalledWith({
      fillColor: tokens.fill,
      fillOpacity: 0.3,
      strokeColor: tokens.line,
      strokeWeight: 2,
      clickable: false,
    });
    // No marker library is ever loaded, so no pin can ever be dropped.
    expect(importLibraryMock).not.toHaveBeenCalledWith('marker');
  });

  it('fits the bounds using LatLngBounds from the core library, not a google global', async () => {
    await mountWardMap(makeContainer());

    expect(importLibraryMock).toHaveBeenCalledWith('maps');
    expect(importLibraryMock).toHaveBeenCalledWith('core');
    expect(LatLngBoundsMock).toHaveBeenCalledWith({ lat: 12.9, lng: 77.5 }, { lat: 13.0, lng: 77.6 });
    expect(fitBoundsMock).toHaveBeenCalledWith(
      { sw: { lat: 12.9, lng: 77.5 }, ne: { lat: 13.0, lng: 77.6 } },
      24,
    );
  });

  it('configures the Maps API exactly once, with the key off the container', async () => {
    await mountWardMap(makeContainer());
    await mountWardMap(makeContainer());

    // Lifetime history, not this test's: `setOptions` is process-global, so
    // whichever mount in this file ran first is the only one that may call it.
    expect(setOptionsCalls).toEqual([{ key: 'test-key', v: 'weekly' }]);
  });
});

describe('mountWardMap — failure closed (spec §5)', () => {
  it('leaves the fallback when data-boundary-url is missing', async () => {
    const container = makeContainer();
    delete container.dataset.boundaryUrl;
    await mountWardMap(container);
    expect(container.textContent).toContain(FALLBACK);
    expect(MapMock).not.toHaveBeenCalled();
  });

  it('leaves the fallback when data-maps-key is missing', async () => {
    const container = makeContainer();
    delete container.dataset.mapsKey;
    await mountWardMap(container);
    expect(container.textContent).toContain(FALLBACK);
    expect(MapMock).not.toHaveBeenCalled();
  });

  it('leaves the fallback when the boundary fetch is non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const container = makeContainer();
    await mountWardMap(container);
    expect(container.textContent).toContain(FALLBACK);
    expect(MapMock).not.toHaveBeenCalled();
  });

  it('leaves the fallback when the boundary fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const container = makeContainer();
    await mountWardMap(container);
    expect(container.textContent).toContain(FALLBACK);
    expect(MapMock).not.toHaveBeenCalled();
  });

  it('leaves the fallback when the response is not a GeoJSON Feature', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: 'not_found' }) }));
    const container = makeContainer();
    await mountWardMap(container);
    expect(container.textContent).toContain(FALLBACK);
    expect(MapMock).not.toHaveBeenCalled();
  });

  it('leaves the fallback when the Google loader rejects', async () => {
    importLibraryMock.mockRejectedValue(new Error('script blocked by CSP'));
    const container = makeContainer();
    await mountWardMap(container);
    expect(container.textContent).toContain(FALLBACK);
    expect(MapMock).not.toHaveBeenCalled();
  });

  it('restores the fallback when constructing the map throws', async () => {
    MapMock.mockImplementationOnce(() => {
      throw new Error('no WebGL here');
    });
    const container = makeContainer();
    await mountWardMap(container);
    expect(container.textContent).toContain(FALLBACK);
  });

  it('restores the fallback when gm_authFailure fires after a successful mount', async () => {
    const container = makeContainer();
    await mountWardMap(container);
    expect(container.textContent).not.toContain(FALLBACK);

    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();

    expect(container.textContent).toContain(FALLBACK);
  });

  it('restores every mounted container from the one gm_authFailure handler', async () => {
    const first = makeContainer();
    const second = makeContainer();
    await mountWardMap(first);
    await mountWardMap(second);
    expect(first.textContent).not.toContain(FALLBACK);
    expect(second.textContent).not.toContain(FALLBACK);

    (window as unknown as { gm_authFailure: () => void }).gm_authFailure();

    expect(first.textContent).toContain(FALLBACK);
    expect(second.textContent).toContain(FALLBACK);
  });

  it('installs exactly one gm_authFailure handler across multiple mounts', async () => {
    await mountWardMap(makeContainer());
    const handler = (window as unknown as Record<string, unknown>).gm_authFailure;
    expect(typeof handler).toBe('function');
    await mountWardMap(makeContainer());
    expect((window as unknown as Record<string, unknown>).gm_authFailure).toBe(handler);
  });
});

describe('initWardMap', () => {
  it('does nothing when no container is present', () => {
    expect(() => initWardMap(document)).not.toThrow();
    expect(MapMock).not.toHaveBeenCalled();
  });

  it('mounts immediately when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    makeContainer();
    initWardMap(document);
    await vi.waitFor(() => expect(MapMock).toHaveBeenCalled());
  });

  it('defers the mount until the container intersects', async () => {
    const observe = vi.fn();
    const unobserve = vi.fn();
    let trigger: ((entries: unknown[]) => void) | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: unknown[]) => void) {
          trigger = cb;
        }
        observe = observe;
        unobserve = unobserve;
      },
    );

    const container = makeContainer();
    initWardMap(document);
    expect(observe).toHaveBeenCalledWith(container);
    expect(MapMock).not.toHaveBeenCalled();

    trigger!([{ isIntersecting: true, target: container }]);
    await vi.waitFor(() => expect(MapMock).toHaveBeenCalled());
    expect(unobserve).toHaveBeenCalledWith(container);
  });
});

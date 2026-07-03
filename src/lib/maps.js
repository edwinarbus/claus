import { isDark, subscribeResolvedTheme } from './theme.js';

// Leaflet fitBounds helpers — mobile Safari often mounts maps at 0×0 until
// layout settles; pixel padding also needs to shrink on narrow screens.

// CARTO basemaps: the warm "voyager" set for light, "dark" for dark so the map
// reads as part of the night theme instead of a glaring light rectangle. We use
// the *_nolabels* variants: the country/city names are baked into the labelled
// tiles, so they can't be reordered under our pins — dropping them clears the
// translucent geographic labels and leaves only our own stop markers.
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';

/** Tile URL template for the theme in effect right now. */
export function basemapUrl() {
  return isDark() ? TILE_DARK : TILE_LIGHT;
}

/**
 * Keep a Leaflet tile layer's basemap in sync with the active theme. Swaps the
 * URL in place (no re-create) on light⇆dark changes. Returns an unsubscribe.
 */
export function watchBasemapTheme(tiles) {
  let last = basemapUrl();
  return subscribeResolvedTheme(() => {
    const next = basemapUrl();
    if (next !== last) { last = next; tiles.setUrl(next); }
  });
}

/** Scale fixed pixel padding down on phones so fitBounds doesn't zoom out too far. */
export function mapFitPadding(width, topLeft, bottomRight) {
  const scale = width < 640 ? 0.55 : 1;
  return {
    paddingTopLeft: topLeft.map((n) => Math.round(n * scale)),
    paddingBottomRight: bottomRight.map((n) => Math.round(n * scale)),
  };
}

/** Run fn once invalidateSize reports a real container (retries via rAF). */
export function whenMapSized(map, fn, { maxTries = 16 } = {}) {
  let tries = 0;
  const attempt = () => {
    if (!map) return;
    map.invalidateSize();
    const { width, height } = map.getContainer().getBoundingClientRect();
    if ((width < 4 || height < 4) && tries < maxTries) {
      tries += 1;
      requestAnimationFrame(attempt);
      return;
    }
    if (width >= 4 && height >= 4) fn({ width, height });
  };
  requestAnimationFrame(attempt);
}

/** Debounced ResizeObserver — refit after expand/collapse, rotation, iOS chrome. */
export function watchMapResize(container, onResize) {
  if (typeof ResizeObserver === 'undefined') return () => {};
  let timer = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(onResize, 80);
  });
  ro.observe(container);
  return () => { clearTimeout(timer); ro.disconnect(); };
}

// Apple Maps deep link. On non-Apple devices maps.apple.com gracefully
// redirects to a web map, so this is safe everywhere.
export function appleMapsUrl(...parts) {
  const q = encodeURIComponent(parts.filter(Boolean).join(', '));
  return `https://maps.apple.com/?q=${q}`;
}

export function openInAppleMaps(...parts) {
  window.open(appleMapsUrl(...parts), '_blank', 'noopener');
}

// Google Maps search link — works on every platform (and is the default many
// non-Apple users prefer), so we offer it alongside Apple Maps everywhere.
export function googleMapsUrl(...parts) {
  const q = encodeURIComponent(parts.filter(Boolean).join(', '));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function openInGoogleMaps(...parts) {
  window.open(googleMapsUrl(...parts), '_blank', 'noopener');
}

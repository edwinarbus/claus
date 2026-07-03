import { html } from '../html.js';

// Custom transport glyphs that replace the emoji set. Drawn on a 24×24 grid in
// `currentColor` so they inherit the surrounding node's ink, with a faint
// lighter underlayer for a slightly skeuomorphic lift (a soft top sheen rather
// than a flat mark). They read as monochrome line glyphs sitting inside the
// glass node bubbles. One source of truth, rendered either as a React node
// (dangerouslySetInnerHTML) or as a raw string for Leaflet map markers.

function glyphKey(mode = '') {
  const m = String(mode).toLowerCase();
  if (m.includes('overnight')) return 'ship';
  if (/(flight|fly|plane|air)/.test(m)) return 'plane';
  if (m.includes('express') || m.includes('speed') || m.includes('hydro')) return 'speedboat';
  if (/(boat|ferry|cruise|sail)/.test(m)) return 'ferry';
  if (/(tram|streetcar|light rail|letbane|bybanen)/.test(m)) return 'tram';
  if (/(bike|bicycle|cycle)/.test(m)) return 'bike';
  if (/(train|rail|metro|subway)/.test(m)) return 'train';
  if (/(bus|coach)/.test(m)) return 'bus';
  if (/(car|drive|taxi)/.test(m)) return 'car';
  if (/(walk|foot)/.test(m)) return 'walk';
  return 'arrow';
}

const GLYPH_OFFSET_Y = {
  bus: -0.45,
  car: -0.9,
  ferry: -2.8,
  speedboat: -3.0,
  ship: -0.65,
  walk: 0.75,
};

// Inner markup per glyph (no <svg> wrapper). Filled silhouettes for the plane;
// rounded line work for the vehicles. Wheels/lights are solid dots.
const INNER = {
  plane:
    '<path d="M17.8 19.2 16 11l3.6-3.6c1.4-1.4 1.9-3.4 1.4-4.4-1-.5-3 0-4.4 1.4L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/>',
  train:
    '<rect x="5" y="3" width="14" height="13" rx="4.2"/><path d="M5.4 9.2h13.2"/><path d="M9 16l-2 4M15 16l2 4"/><circle cx="8.6" cy="12.4" r="1.05" fill="currentColor" stroke="none"/><circle cx="15.4" cy="12.4" r="1.05" fill="currentColor" stroke="none"/>',
  tram:
    '<rect x="6.5" y="4" width="11" height="12" rx="3"/><path d="M6.5 9.6h11"/><path d="M12 4V1.9M9.5 1.9h5M9.6 16l-1.6 4M14.4 16l1.6 4"/><circle cx="9.4" cy="12.6" r="1" fill="currentColor" stroke="none"/><circle cx="14.6" cy="12.6" r="1" fill="currentColor" stroke="none"/>',
  bike:
    '<circle cx="6" cy="16.5" r="3.1"/><circle cx="18" cy="16.5" r="3.1"/><path d="M6 16.5l4.2-7.2h4.6"/><path d="M8.6 9.3h2.6"/><path d="M14.8 9.3l3.2 7.2"/><path d="M10.2 16.5l4.6-7.2"/>',
  bus:
    '<rect x="3" y="5" width="18" height="11" rx="2.6"/><path d="M3 10.2h18"/><path d="M7 5v5M17 5v5"/><circle cx="8" cy="18" r="1.55" fill="currentColor" stroke="none"/><circle cx="16" cy="18" r="1.55" fill="currentColor" stroke="none"/>',
  car:
    '<path d="M19 17h2c.55 0 1-.45 1-1v-3c0-.9-.65-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.45-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C1.4 11.3 1 12.1 1 13v3c0 .55.45 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6"/>',
  ferry:
    '<path d="M3.5 14.5h17l-1.8 3.7A2 2 0 0 1 16.9 19.4H7.1A2 2 0 0 1 5.3 18.2z"/><path d="M8 14.5V9h4.8l3.2 3.1v2.4"/><path d="M3.6 21.1c1.4.9 2.8.9 4.2 0s2.8-.9 4.2 0 2.8.9 4.2 0"/>',
  speedboat:
    '<path d="M2.6 14.6l15.8-1.4a1 1 0 0 1 .96 1.5l-.94 1.7A3 3 0 0 1 15.8 18H6a3 3 0 0 1-2.2-1z"/><path d="M9 13.5l1-2.2a1 1 0 0 1 .9-.6h2a1 1 0 0 1 .87.5l1.1 2"/><path d="M3.4 21c1.4.9 2.8.9 4.2 0s2.8-.9 4.2 0"/>',
  ship:
    '<path d="M3 14h18l-1.9 4.2A2 2 0 0 1 17.3 19.4H6.7A2 2 0 0 1 4.9 18.2z"/><path d="M6.8 14V9h10.4v5"/><path d="M10.8 9V5.8h2.4V9"/><circle cx="9" cy="11.2" r="0.8" fill="currentColor" stroke="none"/><circle cx="12" cy="11.2" r="0.8" fill="currentColor" stroke="none"/><circle cx="15" cy="11.2" r="0.8" fill="currentColor" stroke="none"/>',
  walk:
    '<circle cx="13.2" cy="4.4" r="2"/><path d="M13 7.6l-1.9 4.9 2.1 1.1 1 5.4"/><path d="M11.1 12.5l-3.1 1.1M13.2 9.9l3 1.2 1.9 3"/>',
  arrow:
    '<path d="M4 12h13.5"/><path d="M12.5 6.2l6 5.8-6 5.8"/>',
};

function glyphMarkup(mode) {
  const key = glyphKey(mode);
  const inner = INNER[key] || INNER.arrow;
  const offsetY = GLYPH_OFFSET_Y[key] || 0;
  return `<svg class="transport-glyph-svg" viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(0 ${offsetY})">${inner}</g></svg>`;
}

// React node. Pass an explicit size via className (e.g. "w-[1.05rem] h-[1.05rem]");
// defaults to a 1em square so it tracks the surrounding font-size.
export function TransportGlyph({ mode, className = 'w-[1em] h-[1em]' }) {
  return html`<span aria-hidden="true"
    class=${`transport-glyph inline-flex items-center justify-center ${className}`}
    dangerouslySetInnerHTML=${{ __html: glyphMarkup(mode) }}></span>`;
}

// Raw string for non-React contexts (Leaflet divIcons).
export function transportGlyphSvg(mode) {
  return glyphMarkup(mode);
}

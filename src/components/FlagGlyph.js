import { html, useRef } from '../html.js';

// Flat, editorial flags: a pure rectangle (square corners) with a hairline frame
// so they read as crisp little swatches. 24×18 (≈ the emoji aspect). One source
// of truth, rendered as a React node (and a raw string for non-React contexts).

const FLAG_RX = 0;
const GLOSS = '';
const FRAME = '<rect x="0.45" y="0.45" width="23.1" height="17.1" fill="none" stroke="rgba(0,0,0,0.22)" stroke-width="0.9"/>';

// Nordic cross: vertical bar offset toward the hoist, horizontal centered.
function nordic(field, cross, inner) {
  const vx = 6.5, vw = 3, hy = 7.5, hh = 3;
  let s = `<rect width="24" height="18" fill="${field}"/>`;
  s += `<rect x="${vx}" y="0" width="${vw}" height="18" fill="${cross}"/>`;
  s += `<rect x="0" y="${hy}" width="24" height="${hh}" fill="${cross}"/>`;
  if (inner) {
    s += `<rect x="${vx + 0.9}" y="0" width="${vw - 1.8}" height="18" fill="${inner}"/>`;
    s += `<rect x="0" y="${hy + 0.9}" width="24" height="${hh - 1.8}" fill="${inner}"/>`;
  }
  return s;
}

// Simplified maple leaf centered on the white panel.
const MAPLE = '<path fill="#D80621" d="M12 4.2l.78 1.7c.16.34.55.26.83.07l1.2-.78-.36 2.1c-.07.4.2.55.5.45l1.55-.4-.7 1.45c-.16.33.02.5.3.56l1.2.27-1.6 1.28c-.2.16-.13.4-.05.62l.3.74-1.95-.36c-.27-.05-.4.13-.4.36l.06 1.5-.86-.66c-.2-.16-.45-.06-.58.12l-.09.13-.09-.13c-.13-.18-.38-.28-.58-.12l-.86.66.06-1.5c0-.23-.13-.41-.4-.36l-1.95.36.3-.74c.08-.22.15-.46-.05-.62l-1.6-1.28 1.2-.27c.28-.06.46-.23.3-.56l-.7-1.45 1.55.4c.3.1.57-.05.5-.45l-.36-2.1 1.2.78c.28.19.67.27.83-.07z"/>';

const FLAGS = {
  norway: () => nordic('#BA0C2F', '#FFFFFF', '#00205B'),
  sweden: () => nordic('#006AA7', '#FECC00'),
  denmark: () => nordic('#C8102E', '#FFFFFF'),
  finland: () => nordic('#FFFFFF', '#003580'),
  estonia: () => '<rect width="24" height="6" fill="#0072CE"/><rect y="6" width="24" height="6" fill="#000000"/><rect y="12" width="24" height="6" fill="#FFFFFF"/>',
  iceland: () => nordic('#02529C', '#FFFFFF', '#DC1E35'),
  canada: () => `<rect width="24" height="18" fill="#FFFFFF"/><rect width="6" height="18" fill="#D80621"/><rect x="18" width="6" height="18" fill="#D80621"/>${MAPLE}`,
  germany: () => '<rect width="24" height="6" fill="#000000"/><rect y="6" width="24" height="6" fill="#DD0000"/><rect y="12" width="24" height="6" fill="#FFCE00"/>',
};

const ALIAS = {
  Norway: 'norway', Sweden: 'sweden', Denmark: 'denmark', Finland: 'finland',
  Estonia: 'estonia', Iceland: 'iceland', Canada: 'canada', Germany: 'germany',
};

export function hasFlag(country) {
  return !!ALIAS[country];
}

function flagMarkup(country, clipId = 'fg-clip') {
  const fn = FLAGS[ALIAS[country]];
  if (!fn) return '';
  return `<svg class="flag-glyph-svg" viewBox="0 0 24 18" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`
    + `<defs><clipPath id="${clipId}"><rect width="24" height="18" rx="${FLAG_RX}"/></clipPath></defs>`
    + `<g clip-path="url(#${clipId})">${fn()}${GLOSS}</g>${FRAME}</svg>`;
}

export function flagGlyphSvg(country, clipId = 'fg-clip') {
  return flagMarkup(country, clipId);
}

export function flagDiscSvg(country, clipId = 'fg-disc') {
  const fn = FLAGS[ALIAS[country]];
  if (!fn) return '';
  return `<svg class="flag-disc-svg" viewBox="0 0 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">`
    + `<defs><clipPath id="${clipId}"><circle cx="12" cy="12" r="12"/></clipPath></defs>`
    + `<g clip-path="url(#${clipId})"><g transform="translate(-4 0) scale(1.333333)">${fn()}${GLOSS}</g></g></svg>`;
}

// React node. Renders nothing for unknown countries (caller can fall back).
export function FlagGlyph({ country, className = 'w-[1.08rem] h-[0.81rem]' }) {
  const clipId = useRef(`fg-clip-${Math.random().toString(36).slice(2)}`);
  const markup = flagMarkup(country, clipId.current);
  if (!markup) return null;
  return html`<span aria-hidden="true"
    class=${`flag-glyph inline-flex items-center justify-center shrink-0 ${className}`}
    dangerouslySetInnerHTML=${{ __html: markup }}></span>`;
}

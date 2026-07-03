import { html } from '../html.js';

// Colorful, emoji-like weather icons with a bit of depth (gradients + a soft
// highlight) — drawn to read at small sizes inside the weather chip. Mapped
// from WMO codes. One source of truth; rendered as a React node here.

function keyForCode(code) {
  if (code === 0) return 'sun';
  if (code === 1 || code === 2) return 'partly';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || code === 80 || code === 81) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code === 82 || code >= 95) return 'storm';
  return 'cloud';
}

const RAYS = (cx, cy, r, len) => {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    const x1 = cx + Math.cos(a) * (r + 1.4);
    const y1 = cy + Math.sin(a) * (r + 1.4);
    const x2 = cx + Math.cos(a) * (r + 1.4 + len);
    const y2 = cy + Math.sin(a) * (r + 1.4 + len);
    out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`);
  }
  return out.join('');
};

const SUN_DEFS = '<radialGradient id="wg-sun" cx="42%" cy="36%" r="72%"><stop offset="0%" stop-color="#FFEAB0"/><stop offset="55%" stop-color="#FFC24D"/><stop offset="100%" stop-color="#F39C1F"/></radialGradient>';
const CLOUD_DEFS = '<linearGradient id="wg-cloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#D6DFE9"/></linearGradient>';
const GREY_DEFS = '<linearGradient id="wg-grey" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#AEB8C4"/><stop offset="100%" stop-color="#7E8896"/></linearGradient>';
const BOLT_DEFS = '<linearGradient id="wg-bolt" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFD75E"/><stop offset="100%" stop-color="#F5A623"/></linearGradient>';

const cloud = (fill, stroke) => `<path d="M6.7 18A4.4 4.4 0 0 1 6.2 9.2 6 6 0 0 1 17.7 10.6 3.8 3.8 0 0 1 17.1 18H6.7Z" fill="${fill}" stroke="${stroke}" stroke-width="0.7"/>`;
const sunDisc = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#wg-sun)" stroke="#E08E1E" stroke-width="0.6"/><ellipse cx="${cx - 1.6}" cy="${cy - 1.7}" rx="${r * 0.36}" ry="${r * 0.26}" fill="#FFF6DC" opacity="0.55"/>`;

const GLYPHS = {
  sun: () => `<defs>${SUN_DEFS}</defs><g stroke="#F4A623" stroke-width="1.7" stroke-linecap="round">${RAYS(12, 12, 5.2, 2.1)}</g>${sunDisc(12, 12, 5.2)}`,
  partly: () => `<defs>${SUN_DEFS}${CLOUD_DEFS}</defs><g stroke="#F4A623" stroke-width="1.5" stroke-linecap="round">${RAYS(8.5, 8, 3.1, 1.8)}</g>${sunDisc(8.5, 8, 3.1)}<g transform="translate(1.6 3.4) scale(0.86)">${cloud('url(#wg-cloud)', '#B9C4D0')}</g>`,
  cloud: () => `<defs>${CLOUD_DEFS}</defs>${cloud('url(#wg-cloud)', '#B9C4D0')}<path d="M8.4 11.4a4.4 4.4 0 0 1 5.6-1" fill="none" stroke="#FFFFFF" stroke-width="1" stroke-linecap="round" opacity="0.7"/>`,
  fog: () => `<defs>${CLOUD_DEFS}</defs><g transform="translate(0 -1.4)">${cloud('url(#wg-cloud)', '#B9C4D0')}</g><g stroke="#9AA6B4" stroke-width="1.7" stroke-linecap="round"><line x1="5" y1="19.4" x2="15" y2="19.4"/><line x1="8" y1="22" x2="18.5" y2="22"/></g>`,
  rain: () => `<defs>${CLOUD_DEFS}</defs><g transform="translate(0 -1.6)">${cloud('url(#wg-cloud)', '#B9C4D0')}</g><g stroke="#4AA3F0" stroke-width="1.8" stroke-linecap="round"><line x1="8.5" y1="18.4" x2="7.6" y2="21.4"/><line x1="12" y1="18.4" x2="11.1" y2="21.4"/><line x1="15.5" y1="18.4" x2="14.6" y2="21.4"/></g>`,
  snow: () => `<defs>${CLOUD_DEFS}</defs><g transform="translate(0 -1.6)">${cloud('url(#wg-cloud)', '#B9C4D0')}</g><g fill="#8FC3EC"><circle cx="8.5" cy="19.6" r="1.15"/><circle cx="12" cy="20.6" r="1.15"/><circle cx="15.5" cy="19.6" r="1.15"/></g>`,
  storm: () => `<defs>${GREY_DEFS}${BOLT_DEFS}</defs><g transform="translate(0 -1.6)">${cloud('url(#wg-grey)', '#6F7986')}</g><path d="M12.6 17.3l-3.1 4.3h2.4l-1 3.2 4-4.7h-2.5l1.2-2.8z" fill="url(#wg-bolt)" stroke="#E8901A" stroke-width="0.5" stroke-linejoin="round"/>`,
};

function glyphMarkup(code) {
  const fn = GLYPHS[keyForCode(code)] || GLYPHS.cloud;
  return `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none">${fn()}</svg>`;
}

export function WeatherGlyph({ code, className = 'w-[1.15em] h-[1.15em]' }) {
  return html`<span aria-hidden="true"
    class=${`inline-flex items-center justify-center ${className}`}
    dangerouslySetInnerHTML=${{ __html: glyphMarkup(typeof code === 'number' ? code : -1) }}></span>`;
}

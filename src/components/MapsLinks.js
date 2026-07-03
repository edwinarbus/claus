import { html } from '../html.js';
import { appleMapsUrl, googleMapsUrl } from '../lib/maps.js';
import { IconApple, IconGoogleG } from './icons.js';

// Compact paired map deep-links — Apple Maps + Google Maps for the same place,
// rendered as "[ Apple] Maps  [G] Maps". `parts` (name, city, …) are joined into
// the search query. `linkClass` styles each link to match its host (size/colour);
// pass `stop` inside draggable/clickable rows to keep the tap from bubbling.
export function MapsLinks({
  parts,
  linkClass = '',
  iconClass = 'map-google-glyph',
  appleIconClass = 'map-apple-glyph',
  googleIconClass = iconClass,
  stop = false,
}) {
  const onClick = stop ? (e) => e.stopPropagation() : undefined;
  // `em`-sized glyphs track the label's cap height (~the "M" in Maps) at every
  // host size; gap-3 keeps clear air between the two Maps links.
  const cls = `inline-flex items-center gap-1 ${linkClass}`;
  return html`<span class="inline-flex items-center gap-3 shrink-0">
    <a href=${appleMapsUrl(...parts)} target="_blank" rel="noopener" draggable=${false}
      onClick=${onClick} title="Open in Apple Maps" class=${cls}>
      <${IconApple} className=${appleIconClass} />Maps</a>
    <a href=${googleMapsUrl(...parts)} target="_blank" rel="noopener" draggable=${false}
      onClick=${onClick} title="Open in Google Maps" class=${cls}>
      <${IconGoogleG} className=${googleIconClass} />Maps</a>
  </span>`;
}

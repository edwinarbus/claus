import { html, useState, useRef, useEffect } from '../html.js';
import { personByName } from '../data/profiles.js';

// Circular profile avatar with graceful fallback: a tinted initial is the
// always-present base layer; the photo fades in over it only once it has
// actually loaded, so an expired or blocked photo URL degrades cleanly.
export function Avatar({ name, size = 'w-6 h-6', textSize = 'text-[10px]', className = '', square = false, bordered = true }) {
  const person = personByName(name);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef(null);
  const tint = person?.tint || '#c2bbab';

  // A cached image can finish before React wires up onLoad (the event then
  // never fires and the photo would sit at opacity 0 forever) — so also check
  // `complete` after mount. Covers reopening the settings pane on mobile.
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
  }, [person?.photo]);

  const shape = square ? 'rounded-none' : 'rounded-full';
  const border = bordered ? 'border-[1.5px] border-[#1a1714]' : '';
  return html`<span
    class=${`relative inline-grid place-items-center ${shape} overflow-hidden shrink-0 select-none ${border} ${size} ${className}`}
    style=${{ background: tint }}>
    <span class=${`font-display font-bold text-white leading-none ${textSize}`}>${name ? name[0] : '?'}</span>
    ${person?.photo && html`<img ref=${imgRef} src=${person.photo} alt=${name}
      referrerpolicy="no-referrer"
      onLoad=${() => setLoaded(true)}
      class=${`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`} />`}
  </span>`;
}

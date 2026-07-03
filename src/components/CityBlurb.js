import { html, useState } from '../html.js';

const CLAMP_CHARS = 100;

// City catalog blurbs are long; on phones show a short preview with expand.
export function CityBlurb({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > CLAMP_CHARS;

  function toggle(e) {
    e.preventDefault();
    e.stopPropagation();
    setOpen((v) => !v);
  }

  return html`<span class="block text-xs text-slate-500 leading-snug mt-0.5">
    <span class=${open ? '' : 'line-clamp-2 sm:line-clamp-none'}>${text}</span>
    ${long && html`<button type="button" onClick=${toggle}
      class="sm:hidden text-[11px] font-semibold text-fjord-600 mt-0.5 hover:text-fjord-800">
      ${open ? 'Show less' : 'Read more'}
    </button>`}
  </span>`;
}

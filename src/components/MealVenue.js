import { html, useState, useRef, useEffect } from '../html.js';
import { searchRestaurants } from '../lib/placeSearch.js';
import { appleMapsUrl, googleMapsUrl } from '../lib/maps.js';
import { IconX, IconGoogleG, IconPin } from './icons.js';

// "Where to get it" for a delicacy placed in the day plan: free-type or look up
// a specific restaurant (with address) that pins on the day map, while the item
// keeps its dish name (e.g. "Pastry" → 📍 Sankt Peders Bageri). Shown inline on
// the slot chip so you can see where to get each item at a glance.
export function MealVenue({ item, city, cityName, onPatch }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.venue || '');
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debRef = useRef(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { setText(item.venue || ''); }, [item.venue]);
  useEffect(() => () => clearTimeout(debRef.current), []);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);
  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function onType(val) {
    setText(val);
    setOpen(true);
    clearTimeout(debRef.current);
    const v = val.trim();
    if (v.length < 2) { setHits([]); setSearching(false); return; }
    setSearching(true);
    debRef.current = setTimeout(async () => {
      setHits(await searchRestaurants(v, city));
      setSearching(false);
    }, 350);
  }

  // extra (from a picked search hit): { lat, lng, address }. Free text omits them
  // so the day map geocodes "<venue>, <city>" by name instead.
  function setVenue(name, extra = {}) {
    const n = (name || '').trim();
    if (!n) return;
    onPatch({
      venue: n,
      venueAddress: extra.label || extra.address || '',
      lat: typeof extra.lat === 'number' ? extra.lat : null,
      lng: typeof extra.lng === 'number' ? extra.lng : null,
    });
    setEditing(false);
    setOpen(false);
    setHits([]);
  }
  function clearVenue() {
    onPatch({ venue: '', venueAddress: '', lat: null, lng: null });
    setText('');
    setEditing(false);
  }

  // Set restaurant, shown in the list.
  if (item.venue && !editing) {
    return html`<div class="mt-0.5 flex items-center gap-1 min-w-0 text-[12px] sm:text-[11px]">
      <${IconPin} className="w-3.5 h-3.5 sm:w-3 sm:h-3 shrink-0 text-slate-400" />
      <a href=${appleMapsUrl(item.venue, cityName)} target="_blank" rel="noopener"
        onClick=${(e) => e.stopPropagation()}
        title=${item.venueAddress ? `${item.venue} — ${item.venueAddress}` : `${item.venue} — open in Apple Maps`}
        class="min-w-0 truncate font-medium text-slate-500 hover:text-fjord-700 hover:underline decoration-dotted underline-offset-2">${item.venue}</a>
      <a href=${googleMapsUrl(item.venue, cityName)} target="_blank" rel="noopener"
        onClick=${(e) => e.stopPropagation()} title=${`${item.venue} — open in Google Maps`}
        class="shrink-0 opacity-80 hover:opacity-100"><${IconGoogleG} className="w-3 h-3" /></a>
      <button onClick=${(e) => { e.stopPropagation(); setEditing(true); setOpen(false); }}
        class="shrink-0 text-[10px] text-slate-300 hover:text-slate-500">edit</button>
      <button onClick=${(e) => { e.stopPropagation(); clearVenue(); }} title="Remove restaurant"
        class="shrink-0 text-slate-300 hover:text-rose-500"><${IconX} className="w-3 h-3" /></button>
    </div>`;
  }

  // Collapsed affordance.
  if (!editing) {
    return html`<button onClick=${(e) => { e.stopPropagation(); setEditing(true); }}
      class="mt-0.5 text-[11px] text-slate-400 hover:text-fjord-600 inline-flex items-center gap-1">
      <${IconPin} className="w-3 h-3" /> where to get it</button>`;
  }

  // Editing: search + free text.
  return html`<div ref=${wrapRef} class="relative mt-1" onClick=${(e) => e.stopPropagation()}>
    <input ref=${inputRef} value=${text}
      onInput=${(e) => onType(e.target.value)}
      onKeyDown=${(e) => {
        if (e.key === 'Enter') { e.preventDefault(); setVenue(text); }
        if (e.key === 'Escape') { setEditing(false); setOpen(false); }
      }}
      placeholder="Restaurant where to get it…"
      autocomplete="off"
      class="w-full text-[11px] px-2 py-1 rounded-[2px] border border-[1.5px] border-[#1a1714] bg-white outline-none focus:border-fjord-600" />
    ${open && (searching || hits.length > 0) && html`<ul class="absolute z-30 left-0 right-0 mt-0.5 max-h-40 overflow-y-auto gg-menu rounded-[3px] text-[11px] gg-pop-in origin-top">
      ${searching && html`<li class="px-2 py-1 text-slate-400">Searching…</li>`}
      ${!searching && hits.map((h, i) => html`<li key=${i}>
        <button type="button" onMouseDown=${(e) => { e.preventDefault(); setVenue(h.name, h); }}
          class="w-full text-left px-2 py-1 hover:bg-fjord-50 leading-snug">
          <span class="font-medium text-slate-700">${h.name}</span>
          ${h.label && h.label !== h.name && html`<span class="block text-[10px] text-slate-400 truncate">${h.label}</span>`}
        </button>
      </li>`)}
    </ul>`}
    <div class="mt-1 flex items-center gap-2 text-[10px]">
      <button onClick=${() => setVenue(text)} disabled=${!text.trim()}
        class="font-semibold text-fjord-600 disabled:opacity-40">Save</button>
      <button onClick=${() => { setEditing(false); setOpen(false); setText(item.venue || ''); }}
        class="text-slate-400 hover:text-slate-600">cancel</button>
    </div>
  </div>`;
}

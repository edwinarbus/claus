import { html, useState, useEffect, useRef } from '../html.js';
import { useStore } from '../store/store.js';
import { LODGING_SLOT } from '../data/slots.js';
import { openInAppleMaps, appleMapsUrl, googleMapsUrl, openInGoogleMaps } from '../lib/maps.js';
import { searchHotels } from '../lib/hotelSearch.js';
import { IconExternal, IconX, IconGoogleG } from './icons.js';
import { SlotGlyph } from './slotIcons.js';
import { celebrate } from '../lib/confetti.js';

function mapsUrl(place, cityName) {
  if (place.url && !/google\./i.test(place.url)) return place.url;
  return appleMapsUrl(place.name, cityName);
}

// Per-device, per-person preference (not synced): hide the neighborhood guide so
// the other traveler still sees it. Remembered across sessions for that user.
const GUIDE_HIDE_KEY = 'scandiplan:lodgingGuideHidden';
function readGuideHidden() {
  try { return JSON.parse(localStorage.getItem(GUIDE_HIDE_KEY) || '{}'); } catch { return {}; }
}
function isGuideHidden(who) { return !!readGuideHidden()[who || 'anon']; }
function setGuideHiddenFor(who, hidden) {
  const m = readGuideHidden();
  if (hidden) m[who || 'anon'] = true; else delete m[who || 'anon'];
  try { localStorage.setItem(GUIDE_HIDE_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

// Lodging is your own booked place — type the actual hotel/Airbnb name so it
// can be pinned on the day map. Neighborhood guidance stays as a reference
// until you've entered where you're staying.
// True once every night of the trip has a place to stay, treating `exceptDate`
// as already covered (it's the booking happening right now).
function allNightsBooked(trip, exceptDate) {
  const days = (trip.stops || []).flatMap((s) => s.days || []);
  if (days.length < 2) return false;
  return days.every((d) => d.date === exceptDate || !!(d.slots && d.slots.lodging));
}

export function LodgingSlot({ stop, day, showHints = true }) {
  const { dispatch, who, trip } = useStore();
  const def = LODGING_SLOT;
  const guide = (stop.recs.lodging || [])[0] || null;
  const selected = day.slots.lodging;
  const [text, setText] = useState(selected ? selected.name : '');
  const [guideHidden, setGuideHidden] = useState(() => isGuideHidden(who));
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debRef = useRef(null);
  const wrapRef = useRef(null);
  // Clicking "clear" blurs the input, which schedules a delayed commit() from a
  // now-stale closure. Suppress that one commit so a removal is a single clean
  // dispatch and can never be re-fired/undone by the trailing blur.
  const skipCommitRef = useRef(false);

  const city = { cityId: stop.cityId, name: stop.name, country: stop.country, lat: stop.lat, lng: stop.lng };

  // Resync the field if the slot changes from elsewhere (e.g. apply-to-all).
  useEffect(() => { setText(selected ? selected.name : ''); }, [selected && selected.id, selected && selected.name]);
  // Re-read the per-person preference when the active user switches.
  useEffect(() => { setGuideHidden(isGuideHidden(who)); }, [who]);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function onType(val) {
    skipCommitRef.current = false;
    setText(val);
    setOpen(true);
    clearTimeout(debRef.current);
    if (val.trim().length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debRef.current = setTimeout(async () => {
      const hits = await searchHotels(val, city);
      setSuggestions(hits);
      setSearching(false);
    }, 350);
  }

  function pickHotel(hit) {
    setText(hit.name);
    setSuggestions([]);
    setOpen(false);
    const fresh = !selected;
    setHotelFor(day.date, selected && selected.id, {
      name: hit.name, lat: hit.lat, lng: hit.lng, address: hit.address || hit.label || '',
    });
    if (fresh) {
      if (allNightsBooked(trip, day.date)) celebrate(null, { count: 180, power: 1.3 }); // every night booked!
      else celebrate(wrapRef.current, { count: 70, power: 1 }); // a place to stay — booked!
    }
  }

  function dismissGuide() {
    setGuideHiddenFor(who, true);
    setGuideHidden(true);
  }

  // data: { name, lat?, lng?, address? }. Coords/address come from a picked
  // search hit so the day map can pin the exact spot; free text clears them so
  // the map falls back to geocoding the typed name.
  function setHotelFor(date, itemId, data) {
    const name = data.name;
    const lat = typeof data.lat === 'number' ? data.lat : null;
    const lng = typeof data.lng === 'number' ? data.lng : null;
    const address = data.address || '';
    if (itemId) {
      dispatch({ type: 'UPDATE_SLOT_ITEM', stopId: stop.id, date, slotKey: 'lodging', itemId,
        patch: { name, lat, lng, address, custom: true } });
    } else {
      dispatch({ type: 'ASSIGN_TO_SLOT', stopId: stop.id, date, slotKey: 'lodging',
        item: { name, type: 'lodging', tier: 1, custom: true, lat, lng, address } });
    }
  }

  function commit() {
    if (skipCommitRef.current) { skipCommitRef.current = false; return; }
    const n = text.trim();
    if (!n) { clear(); return; }
    if (n === (selected && selected.name)) return;
    const fresh = !selected;
    // Typed free text (not a picked suggestion): clear stale coords/address.
    setHotelFor(day.date, selected && selected.id, { name: n });
    if (fresh) {
      if (allNightsBooked(trip, day.date)) celebrate(null, { count: 180, power: 1.3 }); // every night booked!
      else celebrate(wrapRef.current, { count: 70, power: 1 }); // a place to stay — booked!
    }
  }

  function clear() {
    clearTimeout(debRef.current);
    skipCommitRef.current = true;
    setSuggestions([]);
    setOpen(false);
    if (selected) dispatch({ type: 'REMOVE_FROM_SLOT', stopId: stop.id, date: day.date, slotKey: 'lodging', itemId: selected.id });
    setText('');
  }

  function applyAllNights() {
    const data = selected
      ? { name: selected.name, lat: selected.lat, lng: selected.lng, address: selected.address }
      : { name: text.trim() };
    if (!data.name) return;
    (stop.days || []).forEach((d) => {
      if (d.date === day.date) return;
      setHotelFor(d.date, d.slots.lodging && d.slots.lodging.id, data);
    });
  }

  const moreNights = (stop.days || []).length > 1;

  return html`<div class="rounded-[3px]">
    <div class="flex items-center gap-1.5 px-3 mb-2 sm:mb-1.5">
      <span class="text-slate-500 inline-flex items-center"><${SlotGlyph} slotKey=${def.key} className="w-4 h-4 sm:w-3.5 sm:h-3.5" /></span>
      <span class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">${def.label}</span>
    </div>

    <div ref=${wrapRef} class="relative">
      <input value=${text}
        onInput=${(e) => onType(e.target.value)}
        onFocus=${() => { if (suggestions.length) setOpen(true); }}
        onBlur=${() => { setTimeout(() => { setOpen(false); commit(); }, 150); }}
        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); e.target.blur(); } if (e.key === 'Escape') setOpen(false); }}
        placeholder="Type your booked hotel / stay…"
        autocomplete="off"
        class="ios-field w-full text-[13px] sm:text-xs px-3 py-2.5 sm:py-2 rounded-[2px] border border-[1.5px] border-[#1a1714] bg-white text-slate-800 outline-none transition-colors focus:border-fjord-600" />
      ${open && (searching || suggestions.length > 0) && html`<ul class="absolute z-20 left-0 right-0 mt-0.5 max-h-40 overflow-y-auto gg-menu rounded-[3px] text-xs gg-pop-in origin-top">
        ${searching && html`<li class="px-2.5 py-1.5 text-slate-400">Searching…</li>`}
        ${!searching && suggestions.map((h, i) => html`<li key=${i}>
          <button type="button" onMouseDown=${(e) => { e.preventDefault(); pickHotel(h); }}
            class="w-full text-left px-2.5 py-1.5 hover:bg-fjord-50 text-slate-800 leading-snug">
            <span class="font-medium">${h.name}</span>
            ${h.label !== h.name && html`<span class="block text-[10px] text-slate-400 truncate">${h.label}</span>`}
          </button>
        </li>`)}
      </ul>`}
    </div>

    ${selected && html`<div class="mt-1 flex items-center justify-end gap-2 text-[11px]">
      ${moreNights && html`<button onClick=${applyAllNights} class="text-fjord-600 hover:underline" title="Set this hotel on every night of this stop">use for all nights</button>`}
      <button onClick=${clear} class="text-slate-400 hover:text-rose-600">clear</button>
    </div>`}

    ${!selected && guide && !guideHidden && showHints && html`<div class="mt-2 rounded-[3px] bg-stone-50 border border-[1.5px] border-[#1a1714] px-2.5 py-2 relative">
      <button onClick=${dismissGuide} title="Hide these neighborhood tips (just for you)" aria-label="Hide neighborhood tips"
        class="absolute top-1 right-1 p-0.5 rounded-[2px] text-slate-400 hover:text-slate-600 hover:bg-stone-200 transition">
        <${IconX} className="w-3 h-3" /></button>
      <p class="text-[11px] text-slate-500 leading-snug pr-4">${guide.blurb}</p>
      ${guide.places && guide.places.length > 0 && html`<ul class="mt-1.5 space-y-1">
        ${guide.places.map((p, i) => html`<li key=${i} class="text-[11px] leading-snug">
          <a href=${mapsUrl(p, stop.name)} target="_blank" rel="noopener"
            class="font-semibold text-fjord-700 hover:underline inline-flex items-center gap-0.5">
            ${p.name} <${IconExternal} className="w-2.5 h-2.5" /></a>
          <a href=${googleMapsUrl(p.name, stop.name)} target="_blank" rel="noopener" title=${`${p.name} — open in Google Maps`}
            class="inline-flex items-center align-middle ml-1 opacity-80 hover:opacity-100"><${IconGoogleG} className="w-3 h-3" /></a>
          ${p.blurb && html`<span class="text-slate-500"> — ${p.blurb}</span>`}
        </li>`)}
      </ul>`}
    </div>`}
  </div>`;
}

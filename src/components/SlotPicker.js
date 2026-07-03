import { html, useState, useRef, useEffect } from '../html.js';
import { createPortal } from 'react-dom';
import { useStore } from '../store/store.js';
import { isItemPlanned } from '../store/selectors.js';
import { searchRestaurants } from '../lib/placeSearch.js';
import { ItemGlyph } from './ItemGlyph.js';
import { TypeDot } from './ItemBits.js';
import { IconX, IconPlus, IconPin } from './icons.js';
import { SlotGlyph } from './slotIcons.js';

const BUCKET_LABEL = { see: 'See', do: 'Do', eat: 'Eat', lodging: 'Stay' };

const MARGIN = 8;
const PANEL_W = 256; // w-64

// Clamp a desired left so the panel of width `w` stays fully on screen.
function clampLeft(left, w) {
  const maxLeft = window.innerWidth - w - MARGIN;
  return Math.max(MARGIN, Math.min(left, maxLeft));
}

// First-paint estimate: center the panel under the anchor (the slot can be
// full-width, so left-aligning would jam it against the screen edge).
function initialPos(rect) {
  if (!rect) return { top: 120, left: MARGIN };
  const w = Math.min(PANEL_W, window.innerWidth - MARGIN * 2);
  const anchorCenter = rect.left + (rect.right - rect.left) / 2;
  return { top: rect.bottom + 4, left: clampLeft(anchorCenter - w / 2, w) };
}

// Popover for filling a day-planner slot by clicking it: pick from this stop's
// recommendations (filtered to what the slot accepts) or type your own.
// Renders fixed-to-viewport so it can't be clipped by `overflow-hidden`
// ancestors (e.g. the StopBlock card).
export function SlotPicker({ stop, day, def, anchorRect, onClose }) {
  const { dispatch } = useStore();
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const [pos, setPos] = useState(() => initialPos(anchorRect));

  // Eat-accepting slots can look up a real restaurant (name + address) and pin
  // it on the day map. Other slots keep the plain pick/type-your-own flow.
  const isEat = def.accepts.includes('eat');
  const city = { name: stop.name, country: stop.country, lat: stop.lat, lng: stop.lng };
  const [places, setPlaces] = useState([]);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const debRef = useRef(null);

  useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);
  useEffect(() => () => clearTimeout(debRef.current), []);

  // After mount, measure the real panel size and place it precisely: centered
  // under the anchor and clamped on screen horizontally, flipped above if it
  // would overflow the bottom.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !anchorRect) return;
    const pw = panel.offsetWidth || PANEL_W;
    const ph = panel.offsetHeight;
    const anchorCenter = anchorRect.left + (anchorRect.right - anchorRect.left) / 2;
    const left = clampLeft(anchorCenter - pw / 2, pw);
    let top = anchorRect.bottom + 4;
    if (top + ph > window.innerHeight - MARGIN) {
      const above = anchorRect.top - ph - 4;
      top = above > MARGIN ? above : Math.max(MARGIN, window.innerHeight - ph - MARGIN);
    }
    setPos({ top, left });
  }, [anchorRect]);

  // Candidate recs from every bucket this slot accepts. Sights/activities drop
  // out once they're already in the plan (you can't do the same thing twice);
  // dining can always repeat.
  const candidates = def.accepts.flatMap((bucket) =>
    (stop.recs?.[bucket] || [])
      .filter((it) => bucket === 'eat' || !isItemPlanned(stop, it))
      .map((it) => ({ ...it, _bucket: bucket })));

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? candidates.filter((it) => it.name.toLowerCase().includes(needle))
    : candidates;
  const exact = candidates.some((it) => it.name.trim().toLowerCase() === needle);

  function onType(val) {
    setQ(val);
    if (!isEat) return;
    clearTimeout(debRef.current);
    const v = val.trim();
    if (v.length < 2) { setPlaces([]); setSearchingPlaces(false); return; }
    setSearchingPlaces(true);
    debRef.current = setTimeout(async () => {
      const hits = await searchRestaurants(v, city);
      setPlaces(hits);
      setSearchingPlaces(false);
    }, 350);
  }

  function assign(item) {
    dispatch({ type: 'ASSIGN_TO_SLOT', stopId: stop.id, date: day.date, slotKey: def.key, item });
    onClose();
  }
  function addCustom() {
    const name = q.trim();
    if (!name) return;
    const type = def.accepts[0];
    // A typed restaurant pins by its name even without a picked address — the
    // map will geocode "<name>, <city>" for it.
    assign({ name, type, tier: 3, custom: true, ...(type === 'eat' ? { pinByName: true } : {}) });
  }
  // A restaurant chosen from the lookup carries its exact coordinates + address.
  function addPlace(p) {
    assign({ name: p.name, type: 'eat', tier: 3, custom: true, pinByName: true, lat: p.lat, lng: p.lng, address: p.label });
  }
  // Travel isn't a recommendation — it's a schedulable block you add yourself
  // (e.g. a local train hop) on top of any auto-detected inbound leg.
  const canAddTravel = def.accepts.includes('travel');
  function addTravel() {
    assign({ name: q.trim() || 'Travel', type: 'travel', durationMin: 120, custom: true });
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length) assign(filtered[0]);
      else addCustom();
    }
  }

  return createPortal(html`<div>
    <div class="fixed inset-0 z-[1100]" onClick=${onClose}></div>
    <div ref=${panelRef}
      style=${{ position: 'fixed', top: `${pos.top}px`, left: `${pos.left}px`, width: '16rem', maxWidth: '90vw' }}
      class="z-[1101] gg-menu gg-rim rounded-[3px] p-2 gg-pop-in">
      <div class="flex items-center gap-1.5 mb-1.5">
        <span class="text-slate-500 inline-flex items-center"><${SlotGlyph} slotKey=${def.key} className="w-3.5 h-3.5" /></span>
        <span class="text-[11px] font-semibold text-slate-500 uppercase tracking-wide flex-1">Add to ${def.label}</span>
        <button onClick=${onClose} class="p-0.5 rounded-[2px] text-slate-400 hover:text-slate-600 hover:bg-stone-100">
          <${IconX} className="w-3.5 h-3.5" /></button>
      </div>

      <input ref=${inputRef} value=${q} onInput=${(e) => onType(e.target.value)} onKeyDown=${onKeyDown}
        placeholder=${isEat ? 'Search picks or type a restaurant…' : 'Search picks or type your own…'}
        class="w-full text-xs px-2 py-1.5 rounded-[2px] border border-[1.5px] border-[#1a1714] outline-none focus:border-fjord-600 mb-1.5" />

      <div class="max-h-52 overflow-y-auto scrollbar-thin space-y-0.5">
        ${canAddTravel && html`<button onClick=${addTravel}
          class="w-full flex items-center gap-1.5 text-left px-1.5 py-1 rounded-[2px] hover:bg-fjord-50 transition mb-0.5">
          <span class="shrink-0 text-slate-500"><${ItemGlyph} item=${{ type: 'travel' }} className="w-4 h-4" /></span>
          <span class="text-xs text-slate-700 leading-snug flex-1 min-w-0 truncate">${needle ? `Travel: ${q.trim()}` : 'Travel block'}</span>
          <span class="shrink-0 text-[9px] uppercase tracking-wide text-slate-400">Travel</span>
        </button>`}
        ${filtered.map((it) => html`<button key=${`${it._bucket}-${it.id}`} onClick=${() => assign(it)}
          class="w-full flex items-center gap-1.5 text-left px-1.5 py-1 rounded-[2px] hover:bg-fjord-50 group/opt transition">
          <span class="shrink-0 text-slate-500"><${ItemGlyph} item=${it} className="w-4 h-4" /></span>
          <span class="text-xs text-slate-700 leading-snug flex-1 min-w-0 truncate">${it.name}</span>
          <span class="shrink-0 inline-flex items-center gap-1">
            <${TypeDot} type=${it._bucket} />
            <span class="text-[9px] uppercase tracking-wide text-slate-400 hidden group-hover/opt:inline">${BUCKET_LABEL[it._bucket] || ''}</span>
          </span>
        </button>`)}

        ${filtered.length === 0 && !needle && html`<div class="text-[11px] text-slate-400 px-1.5 py-2 text-center">
          No saved picks for this slot yet — type to add your own.</div>`}

        ${needle && !exact && html`<button onClick=${addCustom}
          class="w-full flex items-center gap-1.5 text-left px-1.5 py-1.5 rounded-[2px] text-fjord-700 hover:bg-fjord-50 font-semibold transition">
          <${IconPlus} className="w-3.5 h-3.5 shrink-0" />
          <span class="text-xs truncate">Add “${q.trim()}”</span>
        </button>`}

        ${isEat && needle && (searchingPlaces || places.length > 0) && html`<div class="mt-1 pt-1 border-t border-[#1a1714]">
          <div class="px-1.5 pb-0.5 text-[9px] uppercase tracking-wide text-slate-400">
            Restaurants${city.name ? ` near ${city.name}` : ''}</div>
          ${searchingPlaces && html`<div class="px-1.5 py-1 text-[11px] text-slate-400">Searching…</div>`}
          ${!searchingPlaces && places.map((p, i) => html`<button key=${`pl-${i}`} onClick=${() => addPlace(p)}
            class="w-full flex items-start gap-1.5 text-left px-1.5 py-1 rounded-[2px] hover:bg-fjord-50 transition">
            <span class="shrink-0 mt-px text-slate-400"><${IconPin} className="w-3.5 h-3.5" /></span>
            <span class="min-w-0 flex-1">
              <span class="block text-xs text-slate-700 leading-snug truncate">${p.name}</span>
              ${p.label && p.label !== p.name && html`<span class="block text-[10px] text-slate-400 leading-snug truncate">${p.label}</span>`}
            </span>
          </button>`)}
        </div>`}
      </div>
    </div>
  </div>`, document.body);
}

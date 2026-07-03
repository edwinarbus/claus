import { html, useState, useEffect } from '../html.js';
import { createPortal } from 'react-dom';
import { useStore } from '../store/store.js';
import { CITIES, ROUTE_CITY_IDS, EXTRA_CITY_IDS } from '../data/catalog.js';
import { addDays } from '../lib/dates.js';
import { celebrate } from '../lib/confetti.js';
import { TierBadge } from './ItemBits.js';
import { CityBlurb } from './CityBlurb.js';
import { FlagGlyph } from './FlagGlyph.js';
import { IconX, IconPlus } from './icons.js';

const TIER_VERDICT = {
  1: 'Must-see — worth building the trip around',
  2: 'Strong addition if you have the days',
  3: 'A pleasant extra if time allows',
};
const SUGGESTED_NIGHTS = { 1: 3, 2: 2, 3: 1 };
const byTier = (a, b) => (CITIES[a].tier || 3) - (CITIES[b].tier || 3) || CITIES[a].name.localeCompare(CITIES[b].name);
const COUNTRY_CENTROID = {
  Denmark: { lat: 56.0, lng: 10.0 }, Sweden: { lat: 60.1, lng: 15.6 },
  Norway: { lat: 61.0, lng: 8.5 }, Finland: { lat: 61.9, lng: 25.7 }, Estonia: { lat: 58.6, lng: 25.0 },
};

function CityRow({ id, present, onAdd }) {
  const c = CITIES[id];
  const tier = c.tier || 3;
  return html`
    <div role="button" tabIndex=${0}
      onClick=${() => onAdd(id)}
      onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(id); } }}
      class="w-full flex items-start gap-3 p-3 rounded-[2px] hover:bg-fjord-50 border border-transparent hover:border-[1.5px] hover:border-[#1a1714] transition text-left cursor-pointer">
      <${FlagGlyph} country=${c.country} className="w-[1.28rem] h-[0.96rem] mt-[0.18rem]" />
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2 flex-wrap">
          <span class="font-semibold text-slate-800">${c.name}</span>
          <${TierBadge} tier=${tier} />
          <span class="text-xs text-slate-400">${c.country}</span>
          ${present && html`<span class="text-[10px] px-1.5 py-0.5 rounded-[2px] bg-stone-100 text-slate-500 uppercase tracking-wide font-semibold">in trip</span>`}
        </span>
        <span class="block text-[11px] font-medium text-fjord-700 mt-0.5">${TIER_VERDICT[tier]} · suggest ~${SUGGESTED_NIGHTS[tier]} ${SUGGESTED_NIGHTS[tier] === 1 ? 'night' : 'nights'}</span>
        <${CityBlurb} text=${c.blurb} />
      </span>
      <span class="shrink-0 text-fjord-600 mt-1 pointer-events-none"><${IconPlus} className="w-4 h-4" /></span>
    </div>`;
}

export function AddStopModal({ onClose, initialNights }) {
  const { trip, dispatch } = useStore();
  const [q, setQ] = useState('');
  const [nights, setNights] = useState(Math.max(1, initialNights || 2));
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState({ name: '', country: 'Norway' });

  // Close on Escape, like every other overlay.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const present = new Set(trip.stops.map((s) => s.cityId).filter(Boolean));
  const match = (id) => CITIES[id].name.toLowerCase().includes(q.toLowerCase())
    || CITIES[id].country.toLowerCase().includes(q.toLowerCase());

  function newStart() {
    return trip.stops.length ? trip.endDate : (trip.startDate || '2026-07-01');
  }
  function addCity(id) {
    const start = newStart();
    dispatch({ type: 'ADD_STOP', cityId: id, startDate: start, endDate: addDays(start, nights) });
    celebrate(null, { count: 110, power: 1.1 }); // a new destination on the map!
    onClose();
  }
  function addCustom() {
    if (!custom.name.trim()) return;
    const start = newStart();
    const centroid = COUNTRY_CENTROID[custom.country] || { lat: 60, lng: 12 };
    dispatch({
      type: 'ADD_STOP',
      custom: { name: custom.name.trim(), country: custom.country, ...centroid, blurb: '' },
      startDate: start, endDate: addDays(start, nights),
    });
    celebrate(null, { count: 110, power: 1.1 }); // a new destination on the map!
    onClose();
  }

  const routeMatches = ROUTE_CITY_IDS.filter(match).sort(byTier);
  const extraMatches = EXTRA_CITY_IDS.filter(match).sort(byTier);

  return createPortal(html`
    <div class="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center gg-scrim"
      style=${{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))', paddingBottom: 'max(0px, env(safe-area-inset-bottom))' }}
      onClick=${onClose}>
      <div class="gg-sheet gg-rim border-[1.5px] border-[#1a1714] w-full sm:max-w-lg flex flex-col overflow-hidden sheet-enter
          rounded-t-[3px] sm:rounded-[3px] max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)))] sm:max-h-[88vh]"
        onClick=${(e) => e.stopPropagation()}>
        <div class="shrink-0 flex items-center justify-between p-4 border-b border-[#1a1714]">
          <div class="min-w-0 pr-2">
            <h2 class="font-display text-lg font-bold tracking-tight text-slate-900">Add a stop</h2>
            <p class="text-xs text-slate-400">Ranked by tier — fine-tune dates on the timeline.</p>
          </div>
          <button onClick=${onClose} class="p-2 rounded-[2px] hover:bg-stone-100 text-slate-400 shrink-0"><${IconX} className="w-5 h-5" /></button>
        </div>

        <div class="shrink-0 p-4 pb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <input value=${q} onInput=${(e) => setQ(e.target.value)}
            placeholder="Search cities…"
            class="w-full min-w-0 flex-1 px-3 py-2 rounded-[2px] border border-[1.5px] border-[#1a1714] text-sm outline-none focus:border-fjord-300" />
          <label class="flex items-center gap-1.5 text-xs text-slate-500 shrink-0 self-end sm:self-auto">
            nights
            <input type="number" min="1" value=${nights}
              onChange=${(e) => setNights(Math.max(1, Number(e.target.value) || 1))}
              class="w-14 px-2 py-2 rounded-[2px] border border-[1.5px] border-[#1a1714] text-sm text-center no-spin tnum font-bold" />
          </label>
        </div>

        <div class="overflow-y-auto scrollbar-thin px-2 pb-3 flex-1 min-h-0">
          ${routeMatches.length > 0 && html`
            <div class="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">On the classic route</div>
            ${routeMatches.map((id) => html`<${CityRow} key=${id} id=${id} present=${present.has(id)} onAdd=${addCity} />`)}`}
          ${extraMatches.length > 0 && html`
            <div class="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Addable extras</div>
            ${extraMatches.map((id) => html`<${CityRow} key=${id} id=${id} present=${present.has(id)} onAdd=${addCity} />`)}`}
          ${routeMatches.length + extraMatches.length === 0 && html`
            <p class="text-center text-sm text-slate-400 py-6">No catalog city matches “${q}”. Add it as a custom stop below.</p>`}
        </div>

        <div class="shrink-0 border-t border-[#1a1714] p-3 bg-stone-50" style=${{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          ${!showCustom
            ? html`<button onClick=${() => { setShowCustom(true); setCustom((c) => ({ ...c, name: q })); }}
                class="text-sm text-fjord-700 font-medium hover:underline flex items-center gap-1">
                <${IconPlus} className="w-4 h-4" /> Add a custom stop</button>`
            : html`<div class="flex flex-wrap items-center gap-2 animate-fade-in">
                <input autofocus value=${custom.name} onInput=${(e) => setCustom({ ...custom, name: e.target.value })}
                  placeholder="Place name" class="flex-1 min-w-[8rem] px-3 py-2 rounded-[2px] border border-[1.5px] border-[#1a1714] text-sm outline-none focus:border-fjord-300" />
                <select value=${custom.country} onChange=${(e) => setCustom({ ...custom, country: e.target.value })}
                  class="px-2 py-2 rounded-[2px] border border-[1.5px] border-[#1a1714] text-sm bg-white">
                  ${Object.keys(COUNTRY_CENTROID).map((cn) => html`<option key=${cn} value=${cn}>${cn}</option>`)}
                </select>
                <button onClick=${addCustom} class="btn-ink px-3 py-2 rounded-[2px] text-sm font-medium">Add</button>
              </div>`}
        </div>
      </div>
    </div>`, document.body);
}

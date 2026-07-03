import { html, useState, useEffect } from '../html.js';
import { createPortal } from 'react-dom';
import { useStore } from '../store/store.js';
import { CITIES, ROUTE_CITY_IDS, EXTRA_CITY_IDS } from '../data/catalog.js';
import { stopAssignedCount } from '../store/selectors.js';
import { TierBadge } from './ItemBits.js';
import { CityBlurb } from './CityBlurb.js';
import { FlagGlyph } from './FlagGlyph.js';
import { IconX } from './icons.js';
import { confirmDialog } from '../lib/confirmDialog.js';

const byTier = (a, b) => (CITIES[a].tier || 3) - (CITIES[b].tier || 3) || CITIES[a].name.localeCompare(CITIES[b].name);

function CityRow({ id, current, present, onPick }) {
  const c = CITIES[id];
  const tier = c.tier || 3;
  const pick = () => { if (!current) onPick(id); };
  return html`
    <div role="button" tabIndex=${current ? -1 : 0}
      onClick=${pick}
      onKeyDown=${(e) => { if (!current && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick(id); } }}
      class=${`w-full flex items-start gap-3 p-3 rounded-[2px] border text-left transition ${current ? 'bg-fjord-50 border-[1.5px] border-[#1a1714] cursor-default' : 'border-transparent hover:bg-fjord-50 hover:border-[1.5px] hover:border-[#1a1714] cursor-pointer'}`}>
      <${FlagGlyph} country=${c.country} className="w-[1.28rem] h-[0.96rem] mt-[0.18rem]" />
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2 flex-wrap">
          <span class="font-semibold text-slate-800">${c.name}</span>
          <${TierBadge} tier=${tier} />
          <span class="text-xs text-slate-400">${c.country}</span>
          ${current && html`<span class="text-[10px] px-1.5 py-0.5 rounded-[2px] bg-fjord-100 text-fjord-700 uppercase tracking-wide font-semibold">current</span>`}
          ${!current && present && html`<span class="text-[10px] px-1.5 py-0.5 rounded-[2px] bg-stone-100 text-slate-500 uppercase tracking-wide font-semibold">already in trip</span>`}
        </span>
        <${CityBlurb} text=${c.blurb} />
      </span>
    </div>`;
}

export function ChangeCityModal({ stop, onClose }) {
  // Close on Escape, like every other overlay.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { trip, dispatch } = useStore();
  const [q, setQ] = useState('');
  const planned = stopAssignedCount(stop);

  const present = new Set(trip.stops.map((s) => s.cityId).filter(Boolean));
  const match = (id) => CITIES[id].name.toLowerCase().includes(q.toLowerCase())
    || CITIES[id].country.toLowerCase().includes(q.toLowerCase());

  async function pick(id) {
    if (id === stop.cityId) return;
    if (planned > 0 && !(await confirmDialog({ title: `Switch to ${CITIES[id].name}?`, message: `Its ${planned} planned ${planned === 1 ? 'item' : 'items'} will be cleared, but the dates stay the same.`, confirmLabel: 'Switch city', tone: 'destructive' }))) return;
    dispatch({ type: 'CHANGE_STOP_CITY', stopId: stop.id, cityId: id });
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
            <h2 class="font-display text-lg font-bold tracking-tight text-slate-900">Change city</h2>
            <p class="text-xs text-slate-400">Keeps your dates — loads that city's recommendations.</p>
          </div>
          <button onClick=${onClose} class="p-2 rounded-[2px] hover:bg-stone-100 text-slate-400 shrink-0"><${IconX} className="w-5 h-5" /></button>
        </div>

        <div class="shrink-0 p-4 pb-2 space-y-2">
          <input value=${q} onInput=${(e) => setQ(e.target.value)}
            placeholder="Search cities…"
            class="w-full min-w-0 px-3 py-2 rounded-[2px] border border-[1.5px] border-[#1a1714] text-sm outline-none focus:border-fjord-300" />
          ${planned > 0 && html`<p class="text-[11px] text-amber-700 leading-snug">
            This stop has ${planned} planned ${planned === 1 ? 'item' : 'items'} — switching cities will clear ${planned === 1 ? 'it' : 'them'}.
          </p>`}
        </div>

        <div class="overflow-y-auto scrollbar-thin px-2 pb-3 flex-1 min-h-0" style=${{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
          ${routeMatches.length > 0 && html`
            <div class="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">On the classic route</div>
            ${routeMatches.map((id) => html`<${CityRow} key=${id} id=${id} current=${id === stop.cityId} present=${present.has(id)} onPick=${pick} />`)}`}
          ${extraMatches.length > 0 && html`
            <div class="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Addable extras</div>
            ${extraMatches.map((id) => html`<${CityRow} key=${id} id=${id} current=${id === stop.cityId} present=${present.has(id)} onPick=${pick} />`)}`}
          ${routeMatches.length + extraMatches.length === 0 && html`
            <p class="text-center text-sm text-slate-400 py-6">No catalog city matches “${q}”.</p>`}
        </div>
      </div>
    </div>`, document.body);
}

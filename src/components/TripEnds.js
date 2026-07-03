import { html, useState } from '../html.js';
import { useStore } from '../store/store.js';
import { TransportGlyph } from './TransportGlyph.js';
import { TransportPicker } from './TransportEditor.js';
import { formatNumericDate } from '../lib/dates.js';
import { FlagGlyph } from './FlagGlyph.js';
import { IconEdit } from './icons.js';

// Trip bookends: how you arrive into the first city and depart from the last.
export function ArrivalCard({ firstStop }) {
  const { trip, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const a = trip.arrival || {};
  if (!firstStop) return null;
  const set = (patch) => dispatch({ type: 'SET_ARRIVAL', patch });

  return html`<div class="tl-row mb-3">
    <div class="tl-date inset-y-0 flex items-center justify-end text-right uppercase tracking-wide text-[11px] font-semibold text-slate-500 whitespace-nowrap leading-tight tnum">
      ${formatNumericDate(trip.startDate)}
    </div>
    <div class="tl-spine" aria-hidden="true">
      <div class="tl-spine-line tl-spine-line--start"></div>
      <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 tl-spine-mark" title=${a.mode || 'flight'}>
        <${TransportGlyph} mode=${a.mode || 'flight'} className="w-[1.05rem] h-[1.05rem]" />
      </div>
    </div>
    <div class="tl-content tl-end-card min-w-0 rounded-[3px] bg-white border border-[1.5px] border-[#1a1714] px-3 py-2.5 sm:px-4 sm:py-3 overflow-hidden">
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <div class="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-slate-400">Trip starts</div>
        <div class="font-display font-bold tracking-tight text-[17px] sm:text-lg text-slate-900 leading-snug break-words">
          Arrive in <${FlagGlyph} country=${firstStop.country} className="w-[1rem] h-[0.75rem] mx-0.5 align-middle" /> ${firstStop.name}
        </div>
        <div class="text-[10px] sm:text-xs text-slate-400 capitalize leading-snug mt-0.5 break-words">
          ${a.mode || 'flight'}${a.from ? ` from ${a.from}` : ''}${a.note ? ` · ${a.note}` : ''}
        </div>
      </div>
      <button onClick=${() => setOpen(!open)} class="shrink-0 inline-flex items-center gap-0.5 sm:gap-1 uppercase tracking-wide text-[10px] sm:text-[11px] font-semibold text-fjord-600 hover:text-fjord-800 hover:underline p-2 -m-2 mt-0.5 rounded-[2px]">
        <${IconEdit} className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> ${open ? 'done' : 'edit'}
      </button>
    </div>
    ${open && html`<div class="mt-3 pt-3 border-t border-[#1a1714] space-y-2.5 animate-fade-in">
      <div class="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <label class="flex items-center gap-1.5">Start date
          <input type="date" value=${trip.startDate} onChange=${(e) => e.target.value && set({ date: e.target.value })}
            class="border border-[1.5px] border-[#1a1714] rounded-[2px] px-2 py-1 text-slate-700 bg-white" /></label>
        <input value=${a.from || ''} onInput=${(e) => set({ from: e.target.value })} placeholder="Flying in from? (e.g. New York)"
          class="flex-1 min-w-[10rem] px-2 py-1 rounded-[2px] border border-[1.5px] border-[#1a1714]" />
      </div>
      <${TransportPicker} value=${a} onChange=${set} />
    </div>`}
    </div>
  </div>`;
}

export function DepartureCard({ lastStop }) {
  const { trip, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const d = trip.departure || {};
  if (!lastStop) return null;
  const set = (patch) => dispatch({ type: 'SET_DEPARTURE', patch });

  return html`<div class="tl-row mt-4">
    <div class="tl-date inset-y-0 flex items-center justify-end text-right uppercase tracking-wide text-[11px] font-semibold text-slate-500 whitespace-nowrap leading-tight tnum">
      ${formatNumericDate(lastStop.endDate)}
    </div>
    <div class="tl-spine" aria-hidden="true">
      <div class="tl-spine-line tl-spine-line--end"></div>
      <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 tl-spine-mark" title=${d.mode || 'flight'}>
        <${TransportGlyph} mode=${d.mode || 'flight'} className="w-[1.05rem] h-[1.05rem]" />
      </div>
    </div>
    <div class="tl-content tl-end-card min-w-0 rounded-[3px] bg-white border border-[1.5px] border-[#1a1714] px-3 py-2.5 sm:px-4 sm:py-3 overflow-hidden">
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <div class="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-slate-400">Trip ends</div>
        <div class="font-display font-bold tracking-tight text-[17px] sm:text-lg text-slate-900 leading-snug break-words">
          Depart from <${FlagGlyph} country=${lastStop.country} className="w-[1rem] h-[0.75rem] mx-0.5 align-middle" /> ${lastStop.name}
        </div>
        <div class="text-[10px] sm:text-xs text-slate-400 capitalize leading-snug mt-0.5 break-words">
          ${d.mode || 'flight'}${d.to ? ` to ${d.to}` : ''}${d.note ? ` · ${d.note}` : ''}
        </div>
      </div>
      <button onClick=${() => setOpen(!open)} class="shrink-0 inline-flex items-center gap-0.5 sm:gap-1 uppercase tracking-wide text-[10px] sm:text-[11px] font-semibold text-fjord-600 hover:text-fjord-800 hover:underline p-2 -m-2 mt-0.5 rounded-[2px]">
        <${IconEdit} className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> ${open ? 'done' : 'edit'}
      </button>
    </div>
    ${open && html`<div class="mt-3 pt-3 border-t border-[#1a1714] space-y-2.5 animate-fade-in">
      <input value=${d.to || ''} onInput=${(e) => set({ to: e.target.value })} placeholder="Heading home to? (e.g. New York)"
        class="w-full px-2 py-1 rounded-[2px] border border-[1.5px] border-[#1a1714] text-xs" />
      <${TransportPicker} value=${d} onChange=${set} />
    </div>`}
    </div>
  </div>`;
}

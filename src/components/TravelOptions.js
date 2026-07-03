import { html, useState, useEffect } from '../html.js';
import { useStore } from '../store/store.js';
import { travelOptions, normalizeMode } from '../data/travelOptions.js';
import { formatDuration } from '../data/logistics.js';
import { BookingGuide } from './BookingGuide.js';
import { IconChevronDown, IconChevronRight, IconCheck, IconInfo } from './icons.js';
import { TransportGlyph } from './TransportGlyph.js';
import { useReveal } from '../lib/useReveal.js';

function OptionsList({ data, cur, onPick, fromStop, toStop, transport }) {
  const best = data.best;
  const options = [...data.options].sort((a, b) =>
    (a.mode === best ? -1 : 0) - (b.mode === best ? -1 : 0));

  return html`<div class="grid gap-1.5">
    ${options.map((o) => {
      const isBest = o.mode === best;
      const isPick = cur && normalizeMode(o.mode) === cur;
      const clickable = !!onPick && !isPick;
      const select = () => onPick({
        mode: o.mode,
        durationMin: o.duration ?? null,
        note: isBest ? (data.reason || data.note || '') : '',
      });
      return html`<div key=${o.mode}
        onClick=${clickable ? select : null}
        role=${clickable ? 'button' : null}
        tabindex=${clickable ? '0' : null}
        onKeyDown=${clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } } : null}
        class=${`group rounded-[3px] border border-[1.5px] p-2 transition ${isPick
          ? 'border-[#1a1714] bg-fjord-100'
          : 'border-[#1a1714] bg-white'}
          ${clickable ? 'cursor-pointer hover:shadow-[6px_6px_0_0_#1a1714] active:translate-y-px' : ''}`}>
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class=${`inline-flex items-center ${isPick ? 'text-fjord-700' : 'text-slate-500'}`}><${TransportGlyph} mode=${o.mode} className="w-4 h-4" /></span>
          <span class=${`font-semibold capitalize ${isPick ? 'text-fjord-900' : 'text-slate-700'}`}>${o.mode}</span>
          ${o.duration != null && html`<span class=${isPick ? 'text-fjord-500' : 'text-slate-400'}>~${formatDuration(o.duration)}</span>`}
          ${isBest && html`<span class="inline-flex items-center px-1.5 py-px rounded-[2px] bg-[#1a1714] text-[#f4f3ee] font-semibold text-[9px] uppercase tracking-wide">Best</span>`}
          ${isPick && html`<span class="ml-auto inline-flex items-center gap-1 text-fjord-700 font-semibold text-[10px] uppercase tracking-wide"><${IconCheck} className="w-3 h-3" /> Selected</span>`}
          ${clickable && html`<span class="ml-auto text-fjord-600 font-medium opacity-70 group-hover:opacity-100 group-hover:underline">Select</span>`}
        </div>
        ${isBest && data.reason && html`<p class="mt-0.5 text-fjord-700/90 leading-snug">${data.reason}.</p>`}
        <div class="mt-1 grid sm:grid-cols-2 gap-x-3 gap-y-0.5">
          <ul class="space-y-0.5">
            ${o.pros.map((p, i) => html`<li key=${i} class="flex gap-1 text-slate-600 leading-snug">
              <span class="text-emerald-600 font-bold shrink-0">+</span><span>${p}</span></li>`)}
          </ul>
          <ul class="space-y-0.5">
            ${o.cons.map((c, i) => html`<li key=${i} class="flex gap-1 text-slate-500 leading-snug">
              <span class="text-rose-500 font-bold shrink-0">−</span><span>${c}</span></li>`)}
          </ul>
        </div>
        ${isPick && fromStop && toStop && html`<${BookingGuide} embedded=${true}
          fromStop=${fromStop} toStop=${toStop} mode=${o.mode} transport=${transport} />`}
      </div>`;
    })}
    ${data.note && html`<p class="text-slate-400 leading-snug inline-flex items-start gap-1"><span class="inline-flex items-center shrink-0 mt-px" aria-hidden="true"><${IconInfo} className="w-3 h-3" /></span> ${data.note}</p>`}
    ${data.generic && html`<p class="text-slate-400 leading-snug">General trade-offs by distance — confirm routes and times for your dates.</p>`}
  </div>`;
}

// Best-option advice + honest pros/cons for a leg. When embedded=true, renders
// inside the transport edit panel as a collapsible "Compare options" section that
// starts collapsed once the leg is booked or the trip is underway ("Plan only").
export function TravelOptions({ fromStop, toStop, currentMode, onPick, transport, embedded = false, booked = false }) {
  const { hideRecs } = useStore();
  // Embedded: collapse by default when booked or in plan-only mode. Non-embedded
  // keeps its old default (collapsed, opened via its own toggle).
  const [open, setOpen] = useState(embedded ? !(booked || hideRecs) : false);
  // Auto-collapse when the leg gets booked or plan-only turns on.
  useEffect(() => {
    if (embedded && (booked || hideRecs)) setOpen(false);
  }, [embedded, booked, hideRecs]);
  const { mounted, shown } = useReveal(open);
  const data = travelOptions(fromStop, toStop);
  if (!data) return null;

  const cur = normalizeMode(currentMode || '');

  if (embedded) {
    return html`<div class="text-[11px]">
      <button type="button" onClick=${() => setOpen(!open)}
        class="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 transition-colors">
        ${open ? html`<${IconChevronDown} className="w-3 h-3" />` : html`<${IconChevronRight} className="w-3 h-3" />`}
        <span>Compare options (${data.options.length})</span>
      </button>
      ${mounted && html`<div class=${`mt-1.5 reveal ${shown ? 'is-open' : ''}`}><div>
        <${OptionsList} data=${data} cur=${cur} onPick=${onPick}
          fromStop=${fromStop} toStop=${toStop} transport=${transport} />
      </div></div>`}
    </div>`;
  }

  const options = data.options;
  return html`<div class="mt-1.5 text-[11px]">
    <button onClick=${() => setOpen(!open)}
      class="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 transition-colors">
      ${open ? html`<${IconChevronDown} className="w-3 h-3" />` : html`<${IconChevronRight} className="w-3 h-3" />`}
      <span class="font-medium">${open ? 'Hide' : 'Compare'} travel options (${options.length})</span>
    </button>
    ${mounted && html`<div class=${`mt-1.5 reveal ${shown ? 'is-open' : ''}`}><div><${OptionsList} data=${data} cur=${cur} onPick=${onPick} /></div></div>`}
  </div>`;
}

import { html, useRef, useEffect, useState } from '../html.js';
import { TRANSPORT_OPTIONS } from '../data/logistics.js';
import { TransportGlyph } from './TransportGlyph.js';
import { TimeField } from './TimeField.js';
import { DateField } from './DateField.js';

export function TransportPicker({ value = {}, onChange, depDateFallback = '', arrDateFallback = '' }) {
  const mode = value.mode || '';
  // The scroll container is the .glass-segment--scroll element itself (overflow-x
  // lives there), not the inner __track — so scroll/measure that one.
  const segRef = useRef(null);
  const [edges, setEdges] = useState({ l: false, r: false });
  const updateEdges = () => {
    const seg = segRef.current;
    if (!seg) return;
    const max = seg.scrollWidth - seg.clientWidth;
    setEdges({ l: seg.scrollLeft > 1, r: seg.scrollLeft < max - 1 });
  };
  // Centre the selected mode so a far-right pick (e.g. flight) is visible instead
  // of clipped off-screen — but the leg editor reveals with an animation, so wait
  // (rAF-retry) until the track has a real width and is scrollable, then centre.
  useEffect(() => {
    const seg = segRef.current;
    if (!seg) return undefined;
    let raf = 0;
    let tries = 0;
    const run = () => {
      if ((seg.clientWidth < 8 || seg.scrollWidth <= seg.clientWidth + 1) && tries < 60) {
        tries += 1;
        raf = requestAnimationFrame(run);
        return;
      }
      const active = seg.querySelector('[data-active="true"]');
      if (active) {
        const sr = seg.getBoundingClientRect();
        const ar = active.getBoundingClientRect();
        seg.scrollLeft += (ar.left - sr.left) - (seg.clientWidth - active.clientWidth) / 2;
      }
      updateEdges();
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [mode]);
  const field = 'px-2 py-1 rounded-[2px] border border-[1.5px] border-[#1a1714] bg-white outline-none focus:border-fjord-600 text-xs';
  return html`<div class="space-y-2 animate-fade-in">

    <!-- Mode tabs: frosted scrollable chip row. The wrapper carries scroll-aware
         edge fades (like the top stop ribbon) so a half-scrolled chip dissolves
         instead of hard-clipping. -->
    <div class="seg-scroll-wrap">
      <div class="transport-mode-segment glass-segment glass-segment--inline glass-segment--scroll glass-segment--compact"
        ref=${segRef} onScroll=${updateEdges}
        style=${{ '--seg-h': '30px', '--seg-item-h': '23px', '--seg-icon': '13px' }}>
        <div class="glass-segment__track">
          ${TRANSPORT_OPTIONS.map((m) => html`<button key=${m} type="button" onClick=${() => onChange({ mode: m })}
            data-active=${mode === m}
            class="glass-segment__item text-[11px]">
            <${TransportGlyph} mode=${m} className="w-[0.95rem] h-[0.95rem]" />
            <span>${m}</span>
          </button>`)}
        </div>
      </div>
      <div aria-hidden="true" class=${`seg-fade seg-fade--l ${edges.l ? 'is-on' : ''}`}></div>
      <div aria-hidden="true" class=${`seg-fade seg-fade--r ${edges.r ? 'is-on' : ''}`}></div>
    </div>

    <!-- Depart (left) / Arrive (right): label on top, then date + 12-hour time on
         one row (type 24h and it folds, or 12h + AM/PM), then a full-width
         station. The date autopopulates from the timeline; minutes are optional. -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5 text-xs text-slate-500 sm:max-w-md">
      <div class="space-y-1.5 min-w-0">
        <span class="block uppercase tracking-wide font-semibold text-slate-500 text-[11px]">Depart</span>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <${DateField} value=${value.depDate || ''} fallback=${depDateFallback} ariaLabel="Departure date"
            onChange=${(v) => onChange({ depDate: v })} />
          <${TimeField} value=${value.depTime || ''} ariaLabel="Departure time"
            onChange=${(v) => onChange({ depTime: v })} />
        </div>
        <input value=${value.depStation || ''} onInput=${(e) => onChange({ depStation: e.target.value })}
          placeholder="from station" class=${`${field} w-full`} />
      </div>
      <div class="space-y-1.5 min-w-0">
        <span class="block uppercase tracking-wide font-semibold text-slate-500 text-[11px]">Arrive</span>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <${DateField} value=${value.arrDate || ''} fallback=${arrDateFallback} ariaLabel="Arrival date"
            onChange=${(v) => onChange({ arrDate: v })} />
          <${TimeField} value=${value.arrTime || ''} ariaLabel="Arrival time"
            onChange=${(v) => onChange({ arrTime: v })} />
        </div>
        <input value=${value.arrStation || ''} onInput=${(e) => onChange({ arrStation: e.target.value })}
          placeholder="to station" class=${`${field} w-full`} />
      </div>
    </div>

    <input value=${value.note || ''} onInput=${(e) => onChange({ note: e.target.value })}
      placeholder="notes (e.g. change at Odense; reserve seats)"
      class=${`${field} w-full sm:max-w-md`} />
  </div>`;
}

import { html, useState } from '../html.js';
import { useStore } from '../store/store.js';
import { useReveal } from '../lib/useReveal.js';
import { resolveTransport, formatDuration, transportTargetsLeg } from '../data/logistics.js';
import { format12 } from '../lib/time.js';
import { formatNumericDate } from '../lib/dates.js';
import { TransportPicker } from './TransportEditor.js';
import { TravelOptions } from './TravelOptions.js';
import { TicketsButton } from './Tickets.js';
import { celebrate } from '../lib/confetti.js';
import { TransportGlyph } from './TransportGlyph.js';
import { IconTicket, IconWarning, IconCheck } from './icons.js';

// Build a "station time → station time" route label from whatever the traveler
// filled in. Times show in 12-hour form; the leg's DATE lives in the timeline's
// left gutter now, not in the route string.
function legRoute(t) {
  const dep = [t.depStation, format12(t.depTime)].filter(Boolean).join(' ');
  const arr = [t.arrStation, format12(t.arrTime)].filter(Boolean).join(' ');
  if (dep && arr) return `${dep} → ${arr}`;
  if (dep) return `from ${dep}`;
  if (arr) return `to ${arr}`;
  return '';
}

// Vertical connector shown between two stop cards in the timeline list.
// Collapsed: route summary only. One "edit" panel holds times, options, booking.
export function TransportConnector({ stop, nextStop, warning }) {
  const { dispatch, trip } = useStore();
  const [open, setOpen] = useState(false);
  // Keep the editor mounted through its close so the leg slides shut, not pops.
  const { mounted, shown } = useReveal(open);
  const fromStop = trip.stops.find((s) => s.id === stop.id) || stop;
  const toStop = trip.stops.find((s) => s.id === nextStop.id) || nextStop;
  const t = resolveTransport(fromStop, toStop);
  if (!t) return null;
  const raw = transportTargetsLeg(fromStop.transportToNext, fromStop, toStop) ? (fromStop.transportToNext || {}) : {};
  const setT = (patch) => dispatch({ type: 'SET_TRANSPORT', stopId: fromStop.id, transport: patch });
  const route = legRoute(t);
  const hasLeg = !!(raw.mode || raw.note || raw.depTime || raw.arrTime || raw.depDate || raw.arrDate || raw.depStation || raw.arrStation);
  const booked = !!raw.booked;
  const tickets = Array.isArray(raw.tickets) ? raw.tickets : [];

  // Context + autofill for reading an uploaded ticket PDF into this leg.
  const ticketContext = {
    fromCity: fromStop.name,
    toCity: toStop.name,
    year: (trip.startDate || '').slice(0, 4),
    travelDate: t.depDate || '',
    plannedDepDate: t.depDate || '',
    plannedArrDate: t.arrDate || t.depDate || '',
    legLabel: `${fromStop.name} → ${toStop.name}`,
    contextKind: 'timeline',
  };
  const fillFromTicket = (f) => {
    const isTime = (v) => /^\d{1,2}:\d{2}$/.test(v || '');
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
    const MODES = ['train', 'bus', 'car', 'ferry', 'express boat', 'overnight boat', 'flight'];
    const patch = {};
    const labels = [];
    // Override whatever's there with the ticket's values; tag each changed field
    // with a human label (deduped) for the status pill.
    const set = (k, v, label) => {
      if (v && v !== raw[k]) { patch[k] = v; if (label && !labels.includes(label)) labels.push(label); }
    };
    set('depStation', f.depStation, 'departure');
    if (isTime(f.depTime)) set('depTime', f.depTime, 'departure');
    if (isDate(f.depDate)) set('depDate', f.depDate, 'date');
    set('arrStation', f.arrStation, 'arrival');
    if (isTime(f.arrTime)) set('arrTime', f.arrTime, 'arrival');
    if (isDate(f.arrDate)) set('arrDate', f.arrDate, 'date');
    if (MODES.includes(f.mode)) set('mode', f.mode, 'mode');
    set('note', f.bookingRef || f.note, 'booking ref');
    if (Object.keys(patch).length) { setT(patch); return labels; }
    return [];
  };

  return html`
    <div class="tl-row">
      <!-- Col 1 — exact travel date. -->
      <div class="tl-date inset-y-0 flex items-center justify-end text-right uppercase tracking-wide text-[11px] font-semibold text-slate-500 whitespace-nowrap leading-tight tnum">
        ${formatNumericDate(t.depDate)}
      </div>
      <!-- Col 2 — spine with the transport-mode node. Tapping it opens the mode
           options (same as the leg row). -->
      <div class="tl-spine">
        <div class="tl-spine-line" aria-hidden="true"></div>
        <button type="button" onClick=${() => setOpen(!open)}
          aria-label=${`Edit travel method from ${fromStop.name} to ${toStop.name}`}
          title=${open ? 'Close travel options' : 'Choose travel mode'}
          class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 tl-spine-mark cursor-pointer transition active:scale-95">
          <${TransportGlyph} mode=${t.mode} className="w-[1.05rem] h-[1.05rem]" />
        </button>
      </div>
      <!-- Col 3 — leg content. -->
      <div id=${`leg-${fromStop.id}`} class="tl-content tl-leg min-w-0 flex flex-col justify-center py-3.5 min-h-[3.75rem]"
        aria-label=${`${t.mode} from ${fromStop.name} to ${toStop.name}`}>
        <button type="button" onClick=${() => setOpen(!open)} aria-expanded=${open}
          aria-label=${`Edit travel method from ${fromStop.name} to ${toStop.name}`}
          title=${open ? 'Tap to close' : 'Tap to edit travel method'}
          class=${`group flex flex-col items-start gap-0.5 text-left rounded-[2px] -mx-1 px-1.5 py-1 transition cursor-pointer active:translate-y-px ${open ? 'bg-fjord-50 border border-[1.5px] border-[#1a1714]' : 'hover:bg-fjord-50'}`}>
          <!-- Header line: mode · duration · booked. Short pieces only, so the
               middots separate cleanly and never dangle at a wrap. -->
          <span class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
            <span class="capitalize group-hover:text-fjord-600">${t.mode}</span>
            <span class="text-slate-300 leading-none" aria-hidden="true">·</span>
            <span title=${t.timed ? 'from your departure/arrival times' : t.estimated ? 'estimated from distance' : 'guide estimate'}>
              ${t.timed ? '' : '~'}${formatDuration(t.durationMin)}${t.estimated ? '*' : ''}
            </span>
            ${booked && html`<span class="inline-flex items-center text-emerald-600 shrink-0" title="Booked" aria-label="Booked"><${IconTicket} className="w-3.5 h-3.5" /></span>`}
          </span>
          <!-- Route on its own line — no leading bullet, so the station names
               (e.g. "Bergen Strandkaiterminal") read clean on a phone. The note
               lives only in the editor (under the stations), not here. -->
          ${route && html`<span class="text-xs text-slate-500 leading-snug">${route}</span>`}
        </button>
        ${warning && html`<div class="mt-1">
          <span class="gg-chip gg-chip-sm text-amber-700 inline-flex items-center gap-1"><${IconWarning} className="w-3 h-3 shrink-0" /> ${warning}</span>
        </div>`}

        ${mounted && html`<div class=${`reveal reveal--gap ${shown ? 'is-open' : ''}`}><div class="max-w-lg lg:max-w-3xl rounded-[3px] border border-[1.5px] border-[#1a1714] bg-stone-50 p-2.5 sm:p-3.5 space-y-3">
          <${TransportPicker} value=${raw} suggestion=${t.suggested}
            depDateFallback=${t.depDate} arrDateFallback=${t.arrDate}
            onChange=${setT}
            onReset=${hasLeg ? () => dispatch({ type: 'SET_TRANSPORT', stopId: fromStop.id, transport: null }) : null} />

          <div class="pt-2 border-t border-[#1a1714] space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <${TicketsButton} tickets=${tickets}
                title=${`${fromStop.name} → ${toStop.name} tickets`}
                context=${ticketContext} onAutofill=${fillFromTicket}
                onUpload=${() => { if (!booked) setT({ booked: true }); }}
                onChange=${(tk) => setT({ tickets: tk })} />
              <button onClick=${(e) => {
                const next = !booked;
                setT({ booked: next });
                if (!next) return;
                // Booking the final leg = every leg booked → a bigger celebration.
                const legs = (trip.stops || []).slice(0, -1);
                const allBooked = legs.length >= 2
                  && legs.every((s) => s.id === fromStop.id || !!(s.transportToNext && s.transportToNext.booked));
                if (allBooked) celebrate(null, { count: 200, power: 1.35 });
                else celebrate(e.currentTarget, { count: 60, power: 0.95 });
              }}
                title=${booked ? 'Booked — click to mark as still to book' : 'Mark this leg as booked'}
                class=${`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-[2px] border border-[1.5px] font-semibold transition ${booked
                  ? 'bg-fjord-600 text-white border-[#1a1714]'
                  : 'bg-white text-slate-800 border-[#1a1714] hover:bg-[#1a1714] hover:text-[#f4f3ee]'}`}>
                ${booked ? html`<span class="inline-flex items-center gap-1"><${IconCheck} className="w-3.5 h-3.5" /> Marked as booked</span>` : 'Mark as booked'}
              </button>
            </div>

            <${TravelOptions} embedded=${true} booked=${booked} fromStop=${fromStop} toStop=${toStop}
              currentMode=${t.mode} onPick=${setT} transport=${raw} />
          </div>
        </div></div>`}
      </div>
    </div>`;
}

import { html, useState } from '../html.js';
import { useStore } from '../store/store.js';
import {
  monthMatrix, monthName, WEEKDAY_LABELS, todayISO, formatRange,
  formatWithWeekday, addDays, nightsBetween, isPastISO, daysBetween, eachDate,
} from '../lib/dates.js';
import { tripNights } from '../store/selectors.js';
import { FlagGlyph, hasFlag } from './FlagGlyph.js';
import { ChangeCityModal } from './ChangeCityModal.js';
import { AddStopModal } from './AddStopModal.js';
import { STOP_PALETTE as PALETTE } from '../data/palette.js';
import { IconTrash, IconEdit, IconExternal, IconPlus, IconCalendar } from './icons.js';
import { confirmDialog } from '../lib/confirmDialog.js';

function parseISOLocal(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

// Build the list of {year, month} to render across the trip window.
function monthsBetween(startISO, endISO) {
  if (!startISO || !endISO) return [];
  const a = parseISOLocal(startISO); const b = parseISOLocal(endISO);
  const out = [];
  let y = a.getFullYear(); let m = a.getMonth();
  const ey = b.getFullYear(); const em = b.getMonth();
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 36) {
    out.push({ year: y, month: m });
    m += 1; if (m > 11) { m = 0; y += 1; }
    guard += 1;
  }
  return out;
}

const CAL_CELL_H = 'h-16';

// Pre-trip annotation: a grayed, non-interactive band before the trip proper
// (the long-travel days getting to the first stop). Calendar-only — no stop,
// recs, or planning attached. Edit the dates/name here if the window changes.
const PRETRIP = { name: 'Toronto', label: 'Long travel', country: 'Canada', startDate: '2026-07-06', endDate: '2026-07-12' };
const PRETRIP_COLOR = { soft: 'bg-stone-100', edge: 'bg-stone-300', text: 'text-slate-400' };

function blockLabelText(cov, len) {
  if (len >= 3) return cov.name;
  if (len === 2) return cov.name.split('/')[0].trim();
  return cov.name.split('/')[0].trim();
}

function MonthGrid({ year, month, coverage, today, selectedId, onSelect, onAddDay, dnd, tripStartDate }) {
  let weeks = monthMatrix(year, month);
  // Trim fully-empty leading/trailing week rows (e.g. the unused first days of
  // July before anything is covered) so the grid starts and ends on real content.
  const hasCov = (w) => w.some((iso) => iso && coverage[iso]);
  while (weeks.length > 1 && !hasCov(weeks[0])) weeks = weeks.slice(1);
  while (weeks.length > 1 && !hasCov(weeks[weeks.length - 1])) weeks = weeks.slice(0, -1);
  return html`<div class="select-none">
    <div class="font-display text-lg font-bold tracking-tight text-slate-900 text-center mb-2">${monthName(month)} ${year}</div>
    <div class="grid grid-cols-7 uppercase tracking-wide text-[11px] font-semibold text-slate-500 mb-1">
      ${WEEKDAY_LABELS.map((d) => html`<div key=${d} class="text-center">${d}</div>`)}
    </div>
    <div class="space-y-1">
      ${weeks.map((week, wi) => html`<div key=${wi} class="relative grid grid-cols-7">
        ${week.map((iso, di) => {
          if (!iso) return html`<div key=${`e${di}`} class=${CAL_CELL_H}></div>`;
          const cov = coverage[iso];
          const isToday = iso === today;
          const past = !isToday && isPastISO(iso);
          const dayNum = Number(iso.slice(8));
          if (!cov) {
            if (tripStartDate && iso < tripStartDate) {
              return html`<div key=${iso} class=${CAL_CELL_H}></div>`;
            }
            return html`<button key=${iso} onClick=${() => onAddDay && onAddDay(iso)}
              title="Add a stop on this day"
              class=${`group/add relative ${CAL_CELL_H} m-px rounded-[2px] border border-dashed border-[#1a1714]/30 transition hover:border-[#1a1714] hover:bg-fjord-50 ${past ? 'opacity-50' : ''}`}>
              <span class=${`cal-day-num absolute text-[11px] tnum font-bold ${isToday ? 'text-fjord-600' : 'text-slate-400'}`}>${dayNum}</span>
              <span class="absolute inset-0 grid place-items-center opacity-0 group-hover/add:opacity-100 transition-opacity">
                <span class="text-fjord-600 text-lg leading-none">＋</span>
              </span>
            </button>`;
          }
          if (cov.pretrip) {
            const pc = cov.color;
            const lp = di > 0 ? coverage[week[di - 1]] : null;
            const rp = di < 6 ? coverage[week[di + 1]] : null;
            const leftSame = !!(lp && lp.pretrip);
            const rightSame = !!(rp && rp.pretrip);
            const showDayNum = !leftSame || !rightSame;
            return html`<div key=${iso} title=${cov.name}
              class=${`cal-band-cell relative ${CAL_CELL_H} my-px ${pc.soft} overflow-hidden opacity-80
                ${leftSame ? '' : 'rounded-l-[2px] ml-px'} ${rightSame ? '' : 'rounded-r-[2px] mr-px'}`}>
              ${!leftSame && html`<span class=${`absolute left-0 top-0 bottom-0 w-1 rounded-l-[2px] ${pc.edge}`}></span>`}
              ${showDayNum && html`<span class=${`cal-day-num absolute z-20 text-[11px] font-bold tnum leading-none ${pc.text} ${!leftSame ? 'cal-day-num--left' : 'cal-day-num--right'}`}>${dayNum}</span>`}
            </div>`;
          }
          const c = cov.color;
          // Same-stop days within a week join into one continuous band.
          const prev = di > 0 ? coverage[week[di - 1]] : null;
          const next = di < 6 ? coverage[week[di + 1]] : null;
          const leftSame = prev && prev.stopId === cov.stopId;
          const rightSame = next && next.stopId === cov.stopId;
          const showDayNum = !leftSame || !rightSame;
          const selected = cov.stopId === selectedId;
          const dragging = dnd && dnd.dragId === cov.stopId;
          const dropTarget = dnd && dnd.overId === cov.stopId && dnd.dragId && dnd.dragId !== cov.stopId;
          return html`<button key=${iso} onClick=${() => onSelect(cov.stopId)}
            title=${`${cov.name} · ${cov.nights} ${cov.nights === 1 ? 'night' : 'nights'}`}
            draggable=${true}
            onDragStart=${(e) => dnd && dnd.onStart(cov.stopId, e)}
            onDragOver=${(e) => dnd && dnd.onOver(cov.stopId, e)}
            onDragLeave=${() => dnd && dnd.onLeave(cov.stopId)}
            onDrop=${(e) => dnd && dnd.onDrop(cov.stopId, e)}
            onDragEnd=${() => dnd && dnd.onEnd()}
            class=${`cal-band-cell relative ${CAL_CELL_H} my-px ${c.soft} overflow-hidden transition hover:brightness-[0.97] cursor-grab active:cursor-grabbing
              ${leftSame ? '' : 'rounded-l-[2px] ml-px'} ${rightSame ? '' : 'rounded-r-[2px] mr-px'}
              ${past ? 'opacity-50 saturate-50 hover:opacity-100 hover:saturate-100' : ''}
              ${dragging ? 'opacity-40' : ''}
              ${dropTarget ? 'ring-2 ring-inset ring-fjord-600 z-20' : ''}
              ${selected && !dropTarget ? 'ring-[1.5px] ring-inset ring-[#1a1714] z-10' : ''}`}>
            ${!leftSame && html`<span class=${`absolute left-0 top-0 bottom-0 w-1 rounded-l-[2px] ${c.edge}`}></span>`}
            ${showDayNum && html`<span class=${`cal-day-num absolute z-20 text-[11px] font-bold tnum leading-none ${c.text}
              ${!leftSame ? 'cal-day-num--left' : 'cal-day-num--right'}`}>${dayNum}</span>`}
          </button>`;
        })}

        ${week.map((iso, di) => {
            const cov = iso ? coverage[iso] : null;
            if (!cov) return null;
            const prev = di > 0 ? coverage[week[di - 1]] : null;
            if (prev && prev.stopId === cov.stopId) return null;
            let len = 1;
            while (di + len < 7) {
              const n = coverage[week[di + len]];
              if (n && n.stopId === cov.stopId) len += 1; else break;
            }
            const c = cov.color;
            const past = isPastISO(iso) && iso !== today;
            const solo = len === 1;
            return html`<div key=${`lbl-${di}`}
              class=${`cal-block-label pointer-events-none absolute z-10 flex flex-col justify-end min-w-0 ${solo ? 'cal-block-label--solo' : ''} ${past ? 'opacity-50' : ''}`}
              style=${{ left: `${(di / 7) * 100}%`, width: `${(len / 7) * 100}%` }}>
              <div class=${`cal-block-city font-bold ${c.text} flex items-center gap-1 min-w-0`}>
                ${len >= 2 && hasFlag(cov.country) && html`<${FlagGlyph} country=${cov.country} className="w-[0.95rem] h-[0.71rem]" />`}
                <span class="truncate">${blockLabelText(cov, len)}</span>
              </div>
              ${!cov.pretrip && html`<div class="cal-block-nights tnum text-slate-500 truncate">${cov.nights} ${cov.nights === 1 ? 'night' : 'nights'}</div>`}
            </div>`;
          })}
      </div>`)}
    </div>
  </div>`;
}

// Inline editor for one stop's dates. Nights is the real lever — extending or
// shortening a stay re-chains every later stop. The first stop's arrival also
// drives the whole trip start, so we expose a date input there.
function StopDateEditor({ trip, stop, index, color, dispatch, onOpenStop, onClose }) {
  const nights = Math.max(1, nightsBetween(stop.startDate, stop.endDate));
  const isFirst = index === 0;
  const [changingCity, setChangingCity] = useState(false);

  function setNights(n) {
    const next = Math.max(1, n);
    dispatch({
      type: 'SET_STOP_DATES',
      stopId: stop.id,
      startDate: stop.startDate,
      endDate: addDays(stop.startDate, next),
    });
  }

  function setArrival(value) {
    if (!value) return;
    dispatch({ type: 'SET_TRIP_DATES', startDate: value, endDate: trip.endDate });
  }

  async function remove() {
    if (!(await confirmDialog({
      title: `Remove ${stop.name}?`,
      message: 'This removes the stop and everything planned there.',
      confirmLabel: 'Remove',
      tone: 'destructive',
    }))) return;
    dispatch({ type: 'REMOVE_STOP', stopId: stop.id });
    onClose();
  }

  return html`<div class=${`card p-4 mt-5 animate-fade-in border-l-4 ${color.edge.replace('bg-', 'border-l-')}`}>
    <div class="flex items-start justify-between gap-3 mb-4">
      <button onClick=${() => setChangingCity(true)}
        class="group flex items-center gap-2 min-w-0 text-left"
        title="Change this stop's city">
        <span class=${`w-3 h-3 rounded-[1px] ${color.chip} shrink-0`}></span>
        <div class="min-w-0">
          <div class="font-display text-lg font-bold tracking-tight text-slate-900 truncate flex items-center gap-1.5">
            <span class="truncate">${stop.name}</span>
            <${IconEdit} className="w-3.5 h-3.5 shrink-0 text-slate-400 group-hover:text-fjord-600 transition" />
          </div>
          <div class="uppercase tracking-wide text-[11px] font-semibold text-slate-500">Stop ${index + 1} of ${trip.stops.length} · tap the name to change city</div>
        </div>
      </button>
      <button onClick=${onClose} class="btn btn-quiet text-xs px-2.5 py-1 shrink-0">Done</button>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      <div class="rounded-[3px] bg-stone-50 border border-[1.5px] border-[#1a1714] p-3 flex flex-col">
        <div class="section-label mb-1.5">Arrive</div>
        ${isFirst
          ? html`<input type="date" value=${stop.startDate}
              onChange=${(e) => setArrival(e.target.value)}
              class="w-full border border-[1.5px] border-[#1a1714] rounded-[2px] px-2 py-1.5 text-slate-800 text-sm bg-white" />
            <div class="text-[11px] text-slate-500 mt-1">sets the whole trip start</div>`
          : html`<div class="text-sm font-semibold text-slate-800">${formatWithWeekday(stop.startDate)}</div>
              <div class="text-[11px] text-slate-500 mt-auto pt-1">follows the previous stop</div>`}
      </div>

      <div class="rounded-[3px] bg-stone-50 border border-[1.5px] border-[#1a1714] p-3 flex flex-col">
        <div class="section-label mb-1.5">Nights</div>
        <div class="glass-segment glass-segment--stepper self-start">
          <div class="glass-segment__track">
            <button type="button" onClick=${() => setNights(nights - 1)} disabled=${nights <= 1}
              class="glass-segment__item text-lg leading-none" aria-label="One fewer night">−</button>
            <span class="glass-segment__item glass-segment__item--value tnum font-bold">${nights}</span>
            <button type="button" onClick=${() => setNights(nights + 1)}
              class="glass-segment__item text-lg leading-none" aria-label="One more night">＋</button>
          </div>
        </div>
        <div class="text-[11px] text-slate-500 mt-auto pt-1">re-chains later stops</div>
      </div>

      <div class="rounded-[3px] bg-stone-50 border border-[1.5px] border-[#1a1714] p-3 flex flex-col col-span-2 sm:col-span-1">
        <div class="section-label mb-1.5">Depart</div>
        <div class="text-sm font-semibold text-slate-800">${formatWithWeekday(stop.endDate)}</div>
        <div class="text-[11px] text-slate-500 mt-auto pt-1 tnum">${nights} ${nights === 1 ? 'night' : 'nights'} here</div>
      </div>
    </div>

    <div class="mt-3 pt-3 border-t border-[#1a1714] flex flex-wrap items-center gap-2">
      <button onClick=${() => onOpenStop(stop.id)} class="btn btn-accent text-xs inline-flex items-center gap-1">
        Open day plan <${IconExternal} className="w-3.5 h-3.5" />
      </button>
      <button onClick=${remove}
        class="ml-auto inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-[2px] px-2.5 py-1.5 transition">
        <${IconTrash} className="w-3.5 h-3.5" /> Remove
      </button>
    </div>

    ${changingCity && html`<${ChangeCityModal} stop=${stop} onClose=${() => setChangingCity(false)} />`}
  </div>`;
}

export function CalendarView({ onOpenStop }) {
  const { trip, dispatch } = useStore();
  const stops = trip.stops;
  const [selectedId, setSelectedId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [adding, setAdding] = useState(null); // null | { nights }

  // Drag a city block (or legend chip) onto another stop to reorder the
  // itinerary; dates re-chain to stay contiguous.
  const dnd = {
    dragId,
    overId,
    onStart: (stopId, e) => {
      setDragId(stopId);
      if (e && e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', stopId); } catch { /* ignore */ }
      }
    },
    onOver: (stopId, e) => {
      if (!dragId || dragId === stopId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (overId !== stopId) setOverId(stopId);
    },
    onLeave: (stopId) => { if (overId === stopId) setOverId(null); },
    onDrop: (stopId, e) => {
      if (e) e.preventDefault();
      if (dragId && dragId !== stopId) {
        dispatch({ type: 'REORDER_STOPS', stopId: dragId, beforeId: stopId });
        setSelectedId(dragId);
      }
      setDragId(null);
      setOverId(null);
    },
    onEnd: () => { setDragId(null); setOverId(null); },
  };

  // Clicking an empty day adds a stop spanning out to that day; the trip end
  // re-chains to fit it. A bare click (or the button) just appends ~2 nights.
  function addOnDay(iso) {
    if (iso && iso < trip.startDate) return;
    const last = stops[stops.length - 1];
    let nights = 2;
    if (last && iso) {
      const span = daysBetween(last.endDate, iso) + 1;
      if (span >= 1) nights = span;
    }
    setAdding({ nights });
  }

  if (!stops.length) {
    return html`<div class="card p-10 text-center text-slate-400">
      <div class="mb-2 flex justify-center text-slate-300"><${IconCalendar} className="w-9 h-9" /></div>
      <p class="mb-4">Add stops to see them laid out on the calendar.</p>
      <button onClick=${() => setAdding({ nights: 2 })}
        class="btn btn-accent text-sm inline-flex items-center gap-1.5">
        <${IconPlus} className="w-4 h-4" /> Add a stop
      </button>
      ${adding && html`<${AddStopModal} onClose=${() => setAdding(null)} initialNights=${adding.nights} />`}
    </div>`;
  }

  // Map each covered date → which stop, its color, and labels. Stop info is
  // stored on every covered day so a multi-day band can render a spanning label
  // for each week-segment it covers.
  const coverage = {};
  // Pre-trip band first, so any (unlikely) overlap is overwritten by real stops.
  if (PRETRIP.startDate && PRETRIP.endDate) {
    eachDate(PRETRIP.startDate, PRETRIP.endDate).forEach((d) => {
      coverage[d] = { pretrip: true, name: PRETRIP.name, label: PRETRIP.label, country: PRETRIP.country, color: PRETRIP_COLOR };
    });
  }
  stops.forEach((s, idx) => {
    const color = PALETTE[idx % PALETTE.length];
    const nights = nightsBetween(s.startDate, s.endDate);
    s.days.forEach((d) => {
      coverage[d.date] = { stopId: s.id, name: s.name, country: s.country, color, nights };
    });
  });

  // Start the calendar at the pre-trip band if it begins before the trip proper.
  const calStart = PRETRIP.startDate && PRETRIP.startDate < trip.startDate ? PRETRIP.startDate : trip.startDate;
  const months = monthsBetween(calStart, trip.endDate);
  const nights = tripNights(trip);
  const selectedIndex = stops.findIndex((s) => s.id === selectedId);
  const selectedStop = selectedIndex >= 0 ? stops[selectedIndex] : null;

  function setStart(value) {
    if (!value) return;
    dispatch({ type: 'SET_TRIP_DATES', startDate: value, endDate: trip.endDate });
  }

  function setEnd(value) {
    if (!value) return;
    dispatch({ type: 'SET_TRIP_DATES', startDate: trip.startDate, endDate: value });
  }

  const lastStop = stops[stops.length - 1];
  const minEnd = lastStop ? addDays(lastStop.startDate, 1) : trip.startDate;

  const dateField = 'w-full min-w-0 max-w-full border border-[1.5px] border-[#1a1714] rounded-[2px] px-2 py-1.5 text-slate-800 text-sm bg-white';

  return html`<div class="card calendar-card p-4 overflow-hidden">
    <div class="flex flex-col gap-4 mb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div class="min-w-0">
        <h3 class="font-display text-xl font-bold tracking-tight text-slate-900">${formatRange(trip.startDate, trip.endDate)}${' '}
          <span class="text-slate-500 font-sans font-normal text-sm tnum">· ${nights} ${nights === 1 ? 'night' : 'nights'} · ${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}</span></h3>
        <p class="text-xs text-slate-500 mt-0.5">Tap a stop to adjust nights, swap city, or remove it. Tap an empty day to add one · drag a block onto another to reorder.</p>
      </div>
      <div class="w-full sm:w-auto sm:max-w-xs shrink-0">
        <div class="grid grid-cols-2 gap-2.5 w-full min-w-0">
          <label class="flex flex-col gap-1 text-xs text-slate-500 min-w-0">
            <span class="section-label">Trip starts</span>
            <input type="date" value=${trip.startDate}
              onChange=${(e) => setStart(e.target.value)}
              class=${dateField} />
          </label>
          <label class="flex flex-col gap-1 text-xs text-slate-500 min-w-0">
            <span class="section-label">Trip ends</span>
            <input type="date" value=${trip.endDate} min=${minEnd}
              onChange=${(e) => setEnd(e.target.value)}
              class=${dateField} />
          </label>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap justify-center gap-x-12 gap-y-8">
      ${months.map((m) => html`<div key=${`${m.year}-${m.month}`} class="flex-1 basis-[20rem] min-w-[18rem] max-w-2xl">
        <${MonthGrid}
          year=${m.year} month=${m.month} coverage=${coverage} today=${todayISO()}
          selectedId=${selectedId} onSelect=${setSelectedId} onAddDay=${addOnDay} dnd=${dnd}
          tripStartDate=${trip.startDate} />
      </div>`)}
    </div>

    ${selectedStop && html`<${StopDateEditor}
      trip=${trip} stop=${selectedStop} index=${selectedIndex}
      color=${PALETTE[selectedIndex % PALETTE.length]}
      dispatch=${dispatch} onOpenStop=${onOpenStop}
      onClose=${() => setSelectedId(null)} />`}
    <div class="flex flex-wrap gap-1.5 mt-5 pt-4 border-t border-[#1a1714]">
      ${stops.map((s, idx) => {
        const c = PALETTE[idx % PALETTE.length];
        const active = s.id === selectedId;
        const isDragging = dragId === s.id;
        const isOver = overId === s.id && dragId && dragId !== s.id;
        return html`<button key=${s.id} onClick=${() => setSelectedId(s.id)}
          draggable=${true}
          onDragStart=${(e) => dnd.onStart(s.id, e)}
          onDragOver=${(e) => dnd.onOver(s.id, e)}
          onDragLeave=${() => dnd.onLeave(s.id)}
          onDrop=${(e) => dnd.onDrop(s.id, e)}
          onDragEnd=${() => dnd.onEnd()}
          title="Drag to reorder"
          class=${`inline-flex items-center gap-1.5 text-xs font-semibold rounded-[2px] border border-[1.5px] px-2 py-1 cursor-grab active:cursor-grabbing transition
            ${isOver ? 'border-fjord-600 bg-fjord-50' : 'border-[#1a1714]'}
            ${isDragging ? 'opacity-40' : ''}
            ${active ? 'bg-[#1a1714] text-[#f4f3ee]' : 'text-slate-700 hover:text-slate-900'}`}>
          <span class=${`w-2.5 h-2.5 rounded-[1px] ${c.chip}`}></span>${s.name}</button>`;
      })}
      <button onClick=${() => setAdding({ nights: 2 })}
        title="Add a stop"
        class="inline-flex items-center gap-1 text-xs font-semibold rounded-[2px] border border-dashed border-[#1a1714]/40 px-2 py-1 text-slate-500 hover:text-fjord-700 hover:border-[#1a1714] transition">
        <${IconPlus} className="w-3.5 h-3.5" /> Add stop
      </button>
    </div>

    ${adding && html`<${AddStopModal} onClose=${() => setAdding(null)} initialNights=${adding.nights} />`}
  </div>`;
}

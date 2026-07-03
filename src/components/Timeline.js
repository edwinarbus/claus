import { html, useState, useRef, useEffect } from '../html.js';
import { createPortal } from 'react-dom';
import { useStore } from '../store/store.js';
import { StopBlock } from './StopBlock.js';
import { TransportConnector } from './TransportConnector.js';
import { AddStopModal } from './AddStopModal.js';
import { ArrivalCard, DepartureCard } from './TripEnds.js';
import { transitionWarnings, routeAdvisory } from '../data/warnings.js';
import { isStopPast } from '../store/selectors.js';
import { stopColor } from '../data/palette.js';
import { formatNumericDate, nightsBetween, addDays } from '../lib/dates.js';
import { FlagGlyph } from './FlagGlyph.js';
import { IconPlus, IconRoute, IconCompass } from './icons.js';

const PX_PER_NIGHT = 42;

// The ribbon tiles are proportional to nights. Compress them on phones (the
// strip was running too long) and let them breathe on desktop (they were too
// stubby). Updates on resize.
function useRibbonPxPerNight() {
  const get = () => (typeof window !== 'undefined' && window.innerWidth < 640 ? 44 : 78);
  const [ppn, setPpn] = useState(get);
  useEffect(() => {
    const onResize = () => setPpn(get());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return ppn;
}

// One resizable block in the horizontal ribbon. Drag the right edge to add or
// remove nights; drag the block itself to reorder (or up & out to delete).
function RibbonStop({ stop, index, onSelect, dnd, pxPerNight = PX_PER_NIGHT }) {
  const { dispatch } = useStore();
  const color = stopColor(index);
  const baseNights = nightsBetween(stop.startDate, stop.endDate);
  const [drag, setDrag] = useState(null); // { startX, startNights, nights, x, y } while resizing
  const committed = useRef(baseNights);

  const nights = drag ? drag.nights : baseNights;
  const width = Math.max(pxPerNight < 40 ? 46 : 74, nights * pxPerNight);
  const past = isStopPast(stop);
  const dragging = dnd && dnd.dragId === stop.id;
  const dropTarget = dnd && dnd.overId === stop.id && dnd.dragId && dnd.dragId !== stop.id;

  function commit(n) {
    if (n === committed.current) return;
    committed.current = n;
    dispatch({ type: 'SET_STOP_DATES', stopId: stop.id, startDate: stop.startDate, endDate: addDays(stop.startDate, n) });
  }

  function onHandleDown(e) {
    e.preventDefault();
    e.stopPropagation();
    committed.current = baseNights;
    const startX = e.clientX;
    const startNights = baseNights;
    setDrag({ startX, startNights, nights: startNights, x: e.clientX, y: e.clientY });
    try { e.target.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    const move = (ev) => {
      const delta = Math.round((ev.clientX - startX) / pxPerNight);
      const n = Math.max(1, startNights + delta);
      setDrag((d) => (d ? { ...d, nights: n, x: ev.clientX, y: ev.clientY } : d));
      commit(n);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return html`<div
    onDragOver=${(e) => dnd && dnd.onOver(stop.id, e)}
    onDragLeave=${() => dnd && dnd.onLeave(stop.id)}
    onDrop=${(e) => dnd && dnd.onDrop(stop.id, e)}
    class=${`relative flex items-stretch shrink-0 transition ${past ? 'opacity-55 saturate-50 hover:opacity-100 hover:saturate-100' : ''} ${dragging ? 'opacity-40' : ''}`}
    style=${{ width: `${width}px` }}>
    <button
      draggable=${true}
      onDragStart=${(e) => dnd && dnd.onStart(stop.id, e)}
      onDrag=${(e) => dnd && dnd.onDragMove(e)}
      onDragEnd=${() => dnd && dnd.onEnd(stop.id)}
      onClick=${() => onSelect(stop.id)}
      class=${`group gg-stop-tile relative flex-1 rounded-[2px] pl-2.5 pr-1.5 py-1.5 text-left overflow-hidden cursor-grab active:cursor-grabbing
        ${dropTarget ? 'border-[1.5px] border-[#1a1714] z-10' : ''}`}>
      <span class=${`absolute left-0 top-0 bottom-0 w-1 ${color.edge}`}></span>
      <div class="pl-1 pr-0.5 min-w-0">
        <div class="flex items-center gap-1 mb-0.5">
          <span class=${`w-[1.05rem] h-[1.05rem] rounded-[2px] ${color.chip} flex items-center justify-center text-[8px] font-bold text-white shrink-0 leading-none tnum`}>
            ${index + 1}
          </span>
          <span class="uppercase tracking-wide text-[10px] text-slate-500 font-semibold tnum">${formatNumericDate(stop.startDate)}</span>
        </div>
        <div class="font-display font-bold tracking-tight text-[13px] text-slate-900 truncate flex items-center gap-1.5"><${FlagGlyph} country=${stop.country} className="w-[0.95rem] h-[0.71rem]" /><span class="truncate">${stop.name}</span></div>
        <div class="uppercase tracking-wide text-[10px] text-slate-500 font-semibold">${nights} ${nights === 1 ? 'night' : 'nights'}</div>
      </div>
    </button>
    <div onPointerDown=${onHandleDown}
      title="Drag to change nights"
      class=${`absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize flex items-center justify-center rounded-r-[2px] transition-opacity
        ${drag ? 'opacity-100 bg-fjord-600' : 'opacity-0 group-hover:opacity-100 hover:bg-stone-100'}`}>
      <span class="w-0.5 h-4 rounded-[1px] bg-stone-400"></span>
    </div>
    ${drag && createPortal(
      html`<div class="fixed z-[2000] -translate-x-1/2 -translate-y-full bg-[#1a1714] text-[11px] font-semibold text-[#f4f3ee] rounded-[2px] px-2 py-1 whitespace-nowrap pointer-events-none tnum"
        style=${{ left: `${drag.x}px`, top: `${drag.y - 12}px` }}>
        ${nights} ${nights === 1 ? 'night' : 'nights'}</div>`,
      document.body)}
  </div>`;
}

// The horizontal "ribbon" — proportional blocks across the trip dates. Blocks
// can be reordered by dragging onto each other, or dragged up & out to delete.
function Ribbon({ stops, onSelect }) {
  const { dispatch } = useStore();
  const pxPerNight = useRibbonPxPerNight();
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [poof, setPoof] = useState(null); // { x, y }
  const containerRef = useRef(null);
  const scrollerRef = useRef(null);
  const lastPos = useRef({ x: null, y: null });
  const droppedRef = useRef(false);
  // Show a soft fade at whichever edge has more tiles off-screen, so the strip
  // reads as "scroll for more" instead of a tile looking awkwardly clipped.
  const [edges, setEdges] = useState({ l: false, r: false });
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ l: el.scrollLeft > 1, r: el.scrollLeft < max - 1 });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [stops, pxPerNight]);

  function poofDelete(stopId) {
    const { x, y } = lastPos.current;
    if (x != null && y != null) {
      setPoof({ x, y });
      setTimeout(() => setPoof(null), 520);
    }
    dispatch({ type: 'REMOVE_STOP', stopId });
  }

  const dnd = {
    dragId,
    overId,
    onStart: (stopId, e) => {
      setDragId(stopId);
      droppedRef.current = false;
      lastPos.current = { x: e.clientX, y: e.clientY };
      if (e && e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', stopId); } catch { /* ignore */ }
      }
    },
    onDragMove: (e) => { if (e.clientX || e.clientY) lastPos.current = { x: e.clientX, y: e.clientY }; },
    onOver: (stopId, e) => {
      if (!dragId || dragId === stopId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (overId !== stopId) setOverId(stopId);
    },
    onLeave: (stopId) => { if (overId === stopId) setOverId(null); },
    onDrop: (stopId, e) => {
      if (e) e.preventDefault();
      droppedRef.current = true;
      if (dragId && dragId !== stopId) dispatch({ type: 'REORDER_STOPS', stopId: dragId, beforeId: stopId });
      setDragId(null);
      setOverId(null);
    },
    onEnd: (stopId) => {
      // Released without dropping on another block: if dragged up & out of the
      // ribbon, poof it away (dock-style delete).
      const el = containerRef.current;
      const y = lastPos.current.y;
      if (!droppedRef.current && el && y != null) {
        const r = el.getBoundingClientRect();
        if (y < r.top - 10) poofDelete(stopId);
      }
      setDragId(null);
      setOverId(null);
      droppedRef.current = false;
    },
  };

  return html`
    <div class="relative mb-4">
      ${dragId && html`<div class="absolute -top-2 left-0 right-0 z-10 flex justify-center pointer-events-none">
        <span class="uppercase tracking-wide text-[11px] font-semibold text-rose-600 bg-white border border-[1.5px] border-[#1a1714] rounded-[2px] px-3 py-1">
          Drag up & out to remove
        </span>
      </div>`}
      <!-- The rim highlight lives on the outer tray; the scroll container is a
           separate inner box so the lighting never scrolls with the tiles. -->
      <div ref=${containerRef} class="gg-tray gg-tray--inset overflow-hidden" data-swipe-ignore>
        <div ref=${scrollerRef} class="p-1 overflow-x-auto scrollbar-none rounded-[inherit]">
          <div class="flex items-stretch gap-1 min-w-max">
            ${stops.map((s, i) => html`<${RibbonStop} key=${s.id} stop=${s} index=${i} onSelect=${onSelect} dnd=${dnd} pxPerNight=${pxPerNight} />`)}
          </div>
        </div>
        <div aria-hidden="true" class=${`ribbon-fade ribbon-fade--l ${edges.l ? 'is-on' : ''}`}></div>
        <div aria-hidden="true" class=${`ribbon-fade ribbon-fade--r ${edges.r ? 'is-on' : ''}`}></div>
      </div>
      ${poof && createPortal(
        html`<div class="fixed z-[2000] pointer-events-none" style=${{ left: `${poof.x}px`, top: `${poof.y}px`, transform: 'translate(-50%, -50%)' }}>
          <span class="poof-puff inline-block w-8 h-8 text-slate-400"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="14.5" r="3"/><circle cx="13.5" cy="11.5" r="4"/><circle cx="17.5" cy="15" r="2.4"/></svg></span>
        </div>`,
        document.body)}
    </div>`;
}

function EmptyState({ onAdd }) {
  const { dispatch, trip } = useStore();
  return html`
    <div class="bg-white border border-[1.5px] border-[#1a1714] rounded-[3px] p-6 sm:p-10 text-center">
      <div class="mb-3 flex justify-center text-fjord-600"><${IconCompass} className="w-10 h-10" /></div>
      <h3 class="font-display font-bold tracking-tight text-slate-900 text-xl">Start planning your Scandinavia trip</h3>
      <p class="text-sm text-slate-400 mt-1 mb-5 max-w-sm mx-auto">
        Load the classic three-week route to get going instantly, or add your own first stop.
      </p>
      <div class="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-center gap-2.5 sm:gap-3">
        <button onClick=${() => dispatch({ type: 'LOAD_DEFAULT_ROUTE', startDate: trip.startDate })}
          class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[2px] bg-fjord-600 text-white font-semibold border border-[1.5px] border-[#1a1714] hover:bg-[#1a1714] transition-colors duration-150 active:translate-y-px whitespace-nowrap">
          <${IconRoute} className="w-5 h-5 shrink-0" /> Load the Rick Steves route
        </button>
        <button onClick=${onAdd}
          class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[2px] bg-white border border-[1.5px] border-[#1a1714] text-slate-800 font-semibold hover:bg-[#1a1714] hover:text-[#f4f3ee] transition-colors duration-150 active:translate-y-px whitespace-nowrap">
          <${IconPlus} className="w-5 h-5 shrink-0" /> Add a stop
        </button>
      </div>
    </div>`;
}

export function Timeline() {
  const { trip, dispatch, expandStop } = useStore();
  const [modal, setModal] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const stops = trip.stops;
  const warnings = transitionWarnings(trip);
  const advisory = routeAdvisory(trip);

  // Drag a stop card onto another to reorder; dates re-chain to stay contiguous.
  const dnd = {
    dragId,
    overId,
    onStart: (id, e) => {
      setDragId(id);
      if (e && e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', id); } catch { /* ignore */ }
      }
    },
    onOver: (id) => { if (dragId && dragId !== id && overId !== id) setOverId(id); },
    onLeave: (id) => { if (overId === id) setOverId(null); },
    onDrop: (id, after) => {
      if (dragId && dragId !== id) {
        const idx = stops.findIndex((s) => s.id === id);
        const beforeId = after ? (stops[idx + 1] ? stops[idx + 1].id : null) : id;
        dispatch({ type: 'REORDER_STOPS', stopId: dragId, beforeId });
      }
      setDragId(null);
      setOverId(null);
    },
    onEnd: () => { setDragId(null); setOverId(null); },
  };

  function select(stopId) {
    expandStop(stopId);
    setTimeout(() => {
      const el = document.getElementById(`stop-${stopId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }

  if (!stops.length) {
    return html`<div>
      <${EmptyState} onAdd=${() => setModal(true)} />
      ${modal && html`<${AddStopModal} onClose=${() => setModal(false)} />`}
    </div>`;
  }

  return html`
    <div>
      <${Ribbon} stops=${stops} onSelect=${select} />

      ${advisory && html`<div class="mb-4 flex items-start gap-3 rounded-[3px] bg-white border border-[1.5px] border-[#1a1714] text-amber-800 px-4 py-3">
        <span class="shrink-0 inline-flex items-center mt-0.5 text-fjord-600"><${IconCompass} className="w-4 h-4" /></span>
        <div class="text-sm text-amber-900">
          <div class="font-semibold">This route backtracks about <span class="tnum font-bold">${advisory.savedKm}</span> km.</div>
          <div class="text-amber-800 mt-0.5">A tighter loop from your first stop would be:
            <span class="font-medium">${advisory.order.join(' → ')}</span>.
            Reorder with the ↑ ↓ arrows on each stop (or keep it if you’re routing around flights or events).</div>
        </div>
      </div>`}

      <div class="timeline-rail">
        <${ArrivalCard} firstStop=${stops[0]} />
        <div class="mt-2 stagger">
          ${stops.map((stop, i) => html`
            <div key=${stop.id} class="timeline-stop-group">
              <${StopBlock} stop=${stop} index=${i} dnd=${dnd} />
              ${i < stops.length - 1 && html`<${TransportConnector}
                stop=${stop} nextStop=${stops[i + 1]} warning=${warnings.connector[stop.id]} />`}
            </div>`)}
        </div>
        <${DepartureCard} lastStop=${stops[stops.length - 1]} />
      </div>

      <button onClick=${() => setModal(true)}
        class="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-[3px] bg-white border border-[1.5px] border-[#1a1714] text-slate-800 hover:bg-[#1a1714] hover:text-[#f4f3ee] transition-colors duration-150 active:translate-y-px font-semibold group">
        <${IconPlus} className="w-5 h-5 transition-transform duration-200 group-hover:rotate-90" /> Add a stop
      </button>

      ${modal && html`<${AddStopModal} onClose=${() => setModal(false)} />`}
    </div>`;
}

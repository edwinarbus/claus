import { html, useState, useEffect } from '../html.js';
import { useStore } from '../store/store.js';
import { HeatFlag, ClosedFlag } from './ItemBits.js';
import { isClosedOn } from '../data/closures.js';
import { NotesLinksView, NotesLinksEditor } from './NotesLinks.js';
import { SlotPicker } from './SlotPicker.js';
import { drag, startDrag, endDrag, setTiltDragImage } from './dnd.js';
import { beginTouchDrag } from './touchDrag.js';
import { ItemGlyph } from './ItemGlyph.js';
import { TransportGlyph } from './TransportGlyph.js';
import { sunChipForSlot } from '../lib/sun.js';
import { format12 } from '../lib/time.js';
import { daySlotForClock, asSlotArray } from '../data/slots.js';
import { formatDuration, minutesBetweenClock } from '../data/logistics.js';
import { IconX, IconNote, IconPlus, IconSunrise, IconSunset, IconGrip, IconSun, IconMoon, IconCoffee, IconUtensils, IconBed, IconTicket } from './icons.js';
import { RecDetailModal } from './RecDetailModal.js';
import { MealVenue } from './MealVenue.js';
import { TicketsButton, TicketsModal } from './Tickets.js';
import { useReveal } from '../lib/useReveal.js';

// Custom glyph per day-plan section (replaces the old slot emoji).
const SLOT_ICON = {
  morning: IconSunrise, afternoon: IconSun, evening: IconMoon,
  breakfast: IconCoffee, lunch: IconUtensils, dinner: IconUtensils, lodging: IconBed,
};

// Per-daypart accent tint for the section header (icon + label). Mid-tone
// shades chosen to read on both the cream light theme and dark surfaces.
const SLOT_TINT = {
  morning: 'text-amber-500', afternoon: 'text-sky-600', evening: 'text-indigo-500',
  breakfast: 'text-orange-500', lunch: 'text-emerald-600', dinner: 'text-rose-500',
  lodging: 'text-violet-500',
};

const TRAVEL_SLOT_KEYS = new Set(['morning', 'afternoon', 'evening']);
const TRANSPORT_MODES = ['train', 'bus', 'car', 'ferry', 'express boat', 'overnight boat', 'flight'];

function isClock(v) {
  return /^\d{1,2}:\d{2}$/.test(v || '');
}

function isDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '');
}

function modeLabel(mode) {
  return String(mode || 'travel').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function stationTime(station, time) {
  return [station, format12(time)].filter(Boolean).join(' ');
}

function travelSummary(item) {
  const dep = stationTime(item.depStation, item.depTime);
  const arr = stationTime(item.arrStation, item.arrTime);
  const route = dep && arr ? `${dep} -> ${arr}` : dep ? `from ${dep}` : arr ? `to ${arr}` : '';
  const times = item.depTime && item.arrTime
    ? `${format12(item.depTime)} - ${format12(item.arrTime)}`
    : item.depTime ? `depart ${format12(item.depTime)}`
      : item.arrTime ? `arrive ${format12(item.arrTime)}` : '';
  const duration = item.durationMin ? formatDuration(item.durationMin) : '';
  const mode = item.mode || '';
  return { route, times, duration, mode };
}

function ticketNoteBlock(fields) {
  const dep = stationTime(fields.depStation, fields.depTime);
  const arr = stationTime(fields.arrStation, fields.arrTime);
  const lines = [];
  if (dep) lines.push(`Depart: ${dep}`);
  if (arr) lines.push(`Arrive: ${arr}`);
  if (fields.bookingRef) lines.push(`Booking: ${fields.bookingRef}`);
  if (fields.note) lines.push(`Note: ${fields.note}`);
  return lines.join('\n');
}

function mergeTicketNotes(existing, fields) {
  const block = ticketNoteBlock(fields);
  if (!block) return existing || '';
  const manual = String(existing || '')
    .replace(/\n*Ticket details:\n(?:(?:Depart|Arrive|Booking|Note):[^\n]*(?:\n|$))*/gi, '\n')
    .trim();
  return [manual, `Ticket details:\n${block}`].filter(Boolean).join('\n\n');
}

function travelTitleFromTicket(fields) {
  const mode = modeLabel(fields.mode);
  if (fields.depStation && fields.arrStation) return `${mode}: ${fields.depStation} to ${fields.arrStation}`;
  if (fields.arrStation) return `${mode} to ${fields.arrStation}`;
  if (fields.depStation) return `${mode} from ${fields.depStation}`;
  return fields.mode ? mode : '';
}

// A single placed item chip inside a slot. Draggable to reorder; the name opens
// a detail modal showing the full recommendation card.
function SlotItem({ stop, day, def, item, nextId, onDragState }) {
  const { dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const detailReveal = useReveal(open);
  const [showDetail, setShowDetail] = useState(false);
  const [viewingTickets, setViewingTickets] = useState(false);
  const [insert, setInsert] = useState(null); // 'before' | 'after' while reordering
  const [dragging, setDragging] = useState(false);
  const remove = () => dispatch({ type: 'REMOVE_FROM_SLOT', stopId: stop.id, date: day.date, slotKey: def.key, itemId: item.id });
  const patch = (p) => dispatch({ type: 'UPDATE_SLOT_ITEM', stopId: stop.id, date: day.date, slotKey: def.key, itemId: item.id, patch: p });
  const isTravel = item.type === 'travel';
  const tickets = Array.isArray(item.tickets) ? item.tickets : [];
  const ticketTimedTravel = isTravel && tickets.length > 0 && !!(item.depTime || item.arrTime);
  const canDragItem = !ticketTimedTravel;
  const summary = isTravel ? travelSummary(item) : null;
  const ticketContext = isTravel ? {
    fromCity: stop.name || '',
    toCity: '',
    year: (day.date || '').slice(0, 4),
    travelDate: day.date || '',
    plannedDepDate: day.date || '',
    plannedArrDate: day.date || '',
    strictMatch: false,
    contextKind: 'schedule',
    blockTitle: item.name || '',
  } : null;

  function fillTravelFromTicket(fields) {
    if (!isTravel) return [];
    const patchFields = {};
    const labels = [];
    const set = (key, value, label) => {
      if (value && value !== item[key]) {
        patchFields[key] = value;
        if (label && !labels.includes(label)) labels.push(label);
      }
    };
    set('depStation', fields.depStation, 'departure');
    if (isClock(fields.depTime)) set('depTime', fields.depTime, 'departure');
    if (isDate(fields.depDate)) set('depDate', fields.depDate, 'date');
    set('arrStation', fields.arrStation, 'arrival');
    if (isClock(fields.arrTime)) set('arrTime', fields.arrTime, 'arrival');
    if (isDate(fields.arrDate)) set('arrDate', fields.arrDate, 'date');
    if (TRANSPORT_MODES.includes(fields.mode)) {
      set('mode', fields.mode, 'mode');
    }
    set('bookingRef', fields.bookingRef, 'booking ref');

    const duration = minutesBetweenClock(fields.depTime, fields.arrTime);
    if (duration != null && duration !== item.durationMin) {
      patchFields.durationMin = duration;
      if (!labels.includes('duration')) labels.push('duration');
    }

    const title = travelTitleFromTicket(fields);
    if (title && title !== item.name) {
      patchFields.name = title;
      if (!labels.includes('title')) labels.push('title');
    }

    const notes = mergeTicketNotes(item.notes, fields);
    if (notes !== (item.notes || '')) {
      patchFields.notes = notes;
      if (!labels.includes('notes')) labels.push('notes');
    }

    const targetSlot = daySlotForClock(fields.depTime || fields.arrTime);
    const moveTo = targetSlot && TRAVEL_SLOT_KEYS.has(targetSlot) ? targetSlot : def.key;
    const willMove = moveTo !== def.key;
    if (Object.keys(patchFields).length || willMove) {
      dispatch({
        type: 'MOVE_SLOT_ITEM',
        stopId: stop.id,
        date: day.date,
        fromSlotKey: def.key,
        toSlotKey: moveTo,
        itemId: item.id,
        patch: patchFields,
      });
      if (willMove && !labels.includes('slot')) labels.push('slot');
    }
    return labels;
  }

  function onDragStart(e) {
    if (!canDragItem) {
      e.preventDefault();
      return;
    }
    startDrag(item, { type: 'slot', stopId: stop.id, date: day.date, slotKey: def.key, itemId: item.id });
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', item.name); } catch { /* ignore */ }
    setTiltDragImage(e, e.currentTarget);
    setDragging(true);
    onDragState && onDragState(item);
    e.stopPropagation();
  }

  // True when the item being dragged lives in this same slot (so a drop here is
  // a reorder, not a cross-slot move — those still bubble to the Slot).
  function isReorder() {
    const src = drag.source;
    return !!src && src.type === 'slot' && src.stopId === stop.id
      && src.date === day.date && src.slotKey === def.key && src.itemId !== item.id;
  }
  function onItemDragOver(e) {
    if (!isReorder()) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setInsert((e.clientY - r.top) < r.height / 2 ? 'before' : 'after');
  }
  function onItemDrop(e) {
    if (!isReorder()) return;
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const before = (e.clientY - r.top) < r.height / 2;
    dispatch({ type: 'REORDER_SLOT', stopId: stop.id, date: day.date, slotKey: def.key,
      itemId: drag.source.itemId, beforeId: before ? item.id : nextId });
    setInsert(null);
    endDrag();
    onDragState && onDragState(null);
  }

  // Coerce to a real boolean: item.links is often [] (length 0), and a bare
  // `0 && html` would render a stray "0" in the chip.
  const hasMeta = !!((item.notes && item.notes.trim()) || (item.links && item.links.length));
  const hasDetails = hasMeta || isTravel;
  const closedToday = isClosedOn(item, day.date);
  // Eat items show a "where to get it" sub-line, so the row is two lines tall and
  // the grip/emoji should hug the top. Everything else is a single line and reads
  // best vertically centered.
  const stacked = (item.type === 'eat' && !item.pinByName) || isTravel;

  // Touch/pen: drive a custom pointer drag from the grip (HTML5 DnD is mouse-only).
  // Mouse keeps the native draggable card, so the grip is just a visual affordance.
  function onGripPointerDown(e) {
    if (!canDragItem) return;
    if (e.pointerType === 'mouse') return;
    const itemEl = e.currentTarget.closest('[data-item-id]');
    beginTouchDrag(e, {
      item,
      source: { stopId: stop.id, date: day.date, slotKey: def.key, itemId: item.id },
      itemEl,
      dispatch,
    });
  }

  return html`<div draggable=${canDragItem} onDragStart=${onDragStart} onDragEnd=${() => { endDrag(); setInsert(null); setDragging(false); onDragState && onDragState(null); }}
    onDragOver=${onItemDragOver} onDragLeave=${() => setInsert(null)} onDrop=${onItemDrop}
    data-item-id=${item.id}
    data-drag-locked=${ticketTimedTravel ? 'true' : 'false'}
    class=${`group/item ios-row relative px-3 py-2.5 sm:px-3 sm:py-2 transition-transform duration-150 ${canDragItem ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${dragging ? 'is-dragging' : ''} ${closedToday ? 'bg-rose-50' : ''}`}>
    ${insert === 'before' && html`<div class="absolute top-0 left-0 right-0 h-0.5 bg-[#1a1714] z-10"></div>`}
    ${insert === 'after' && html`<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1a1714] z-10"></div>`}
    <div class="flex items-start gap-2 sm:gap-1.5">
      <span onPointerDown=${onGripPointerDown} title=${canDragItem ? 'Drag to reorder' : 'Ticket time fixed'}
        class=${`touch-grip shrink-0 inline-flex items-center justify-center h-[1.55rem] sm:h-[1.3rem] ${canDragItem ? 'text-slate-300 hover:text-slate-500' : 'text-slate-200'}`}>
        <${IconGrip} className="w-3.5 h-3.5" /></span>
      <span class="shrink-0 inline-flex items-center justify-center h-[1.55rem] sm:h-[1.3rem] text-slate-500" aria-hidden="true">${isTravel ? html`<${TransportGlyph} mode=${item.mode} className="w-[1.2rem] h-[1.2rem] sm:w-[1.1rem] sm:h-[1.1rem]" />` : html`<${ItemGlyph} item=${item} className="w-[1.2rem] h-[1.2rem] sm:w-[1.1rem] sm:h-[1.1rem]" />`}</span>
      <!-- Name + "where to get it" stack in one column so the venue line aligns
           neatly under the name instead of being manually indented. Bumped a
           notch larger on phones (where the plan is one roomy column) while
           desktop keeps the compact 13px that fits the 3-column grid. -->
      <div class="flex-1 min-w-0">
        ${isTravel
          ? html`<div title=${ticketTimedTravel ? 'Ticket time fixed' : 'Drag to move this travel block'}
              class="block w-full text-[15.5px] sm:text-[13px] font-semibold text-slate-800 leading-snug text-left break-words">
              ${item.name}</div>`
          : html`<button onClick=${() => setShowDetail(true)} title=${`${item.name} — view details`}
              class="block w-full text-[15.5px] sm:text-[13px] font-semibold text-slate-800 leading-snug text-left cursor-pointer hover:text-fjord-700 hover:underline decoration-dotted underline-offset-2 break-words">
              ${item.name}</button>`}
        ${isTravel && (summary.route || tickets.length > 0) && html`<div class="mt-0.5 space-y-0.5 text-[12px] sm:text-[11px] leading-snug text-slate-500">
          ${tickets.length > 0 && html`<div><button type="button"
            onClick=${(e) => { e.stopPropagation(); setViewingTickets(true); }}
            class="inline-flex items-center gap-1 text-emerald-600 font-medium hover:underline decoration-dotted underline-offset-2"
            title="View ticket full screen"><${IconTicket} className="w-3.5 h-3.5 shrink-0" /> ${tickets.length === 1 ? 'ticket' : `${tickets.length} tickets`}</button></div>`}
          ${summary.route && html`<div class="break-words">${summary.route}</div>`}
        </div>`}
        ${item.type === 'eat' && !item.pinByName && html`<${MealVenue} item=${item} city=${{ name: stop.name, country: stop.country, lat: stop.lat, lng: stop.lng }} cityName=${stop.name} onPatch=${patch} />`}
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        ${item.heatSensitive && html`<span class="leading-none mt-px"><${HeatFlag} /></span>`}
        <!-- A "has notes" pin always shows (it's meaningful); the rest collapse to
             zero width on desktop until hover so the name gets the room. -->
        ${hasDetails && html`<button onClick=${() => setOpen(!open)} title=${isTravel ? 'Travel details & tickets' : 'Notes & links'}
          class="p-1 sm:p-0.5 rounded-[2px] text-fjord-600 hover:bg-stone-100 transition-colors"><${IconNote} className="w-4 h-4 sm:w-3.5 sm:h-3.5" /></button>`}
        <div class="flex items-center gap-0.5 transition-all duration-150 opacity-100 max-w-[4rem] sm:opacity-0 sm:max-w-0 sm:overflow-hidden sm:group-hover/item:opacity-100 sm:group-hover/item:max-w-[3rem]">
          ${!hasDetails && html`<button onClick=${() => setOpen(!open)} title="Notes & links"
            class="p-1 sm:p-0.5 rounded-[2px] text-slate-400 hover:text-slate-600 hover:bg-stone-100 transition-colors"><${IconNote} className="w-4 h-4 sm:w-3.5 sm:h-3.5" /></button>`}
          <button onClick=${remove} title="Remove"
            class="p-1 sm:p-0.5 rounded-[2px] text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"><${IconX} className="w-4 h-4 sm:w-3.5 sm:h-3.5" /></button>
        </div>
      </div>
    </div>
    ${closedToday && html`<div class="mt-1"><${ClosedFlag} item=${item} conflict=${true} /></div>`}
    ${!open && !isTravel && html`<${NotesLinksView} item=${item} onClick=${() => setOpen(true)} inline=${true} />`}
    ${detailReveal.mounted && html`<div class=${`reveal mt-1 ${detailReveal.shown ? 'is-open' : ''}`}><div class="space-y-2">
      ${isTravel && html`<div class="flex flex-wrap items-center gap-2">
        <${TicketsButton} tickets=${tickets}
          title=${`${item.name || 'Travel'} tickets`}
          context=${ticketContext} onAutofill=${fillTravelFromTicket}
          onChange=${(tk) => patch({ tickets: tk })} />
      </div>`}
      <${NotesLinksEditor} item=${item} onPatch=${patch} />
    </div></div>`}
    ${showDetail && html`<${RecDetailModal} item=${item} stopName=${stop && stop.name} onPatch=${patch} onClose=${() => setShowDetail(false)} />`}
    ${viewingTickets && tickets.length > 0 && html`<${TicketsModal}
      title=${`${item.name || 'Travel'} tickets`} tickets=${tickets}
      onAdd=${() => { setViewingTickets(false); setOpen(true); }}
      onRemove=${(id) => patch({ tickets: tickets.filter((t) => t.id !== id) })}
      onClose=${() => setViewingTickets(false)} />`}
  </div>`;
}

export function Slot({ stop, day, def, draggingItem, onDragState, injected }) {
  const { dispatch } = useStore();
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const openPicker = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAnchorRect({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    setPicking(true);
  };
  const value = day.slots[def.key];
  const isMulti = def.kind === 'multi';
  // Multi slots hold an array, but legacy saves may still carry a single object
  // (meal slots were single before) — coerce so the map() below never chokes.
  const items = isMulti ? asSlotArray(value) : (value ? [value] : []);
  const lead = injected || [];
  const accepts = !draggingItem || def.accepts.includes(draggingItem.type);
  const canDrop = !!draggingItem && accepts;

  // Drop targets can stay highlighted if the source unmounts before dragend fires.
  useEffect(() => {
    if (!draggingItem) setOver(false);
  }, [draggingItem]);

  function clearDragUi() {
    endDrag();
    onDragState && onDragState(null);
  }

  function handleDrop(e) {
    e.preventDefault();
    setOver(false);
    try {
      const item = drag.item;
      const source = drag.source;
      if (!item || !def.accepts.includes(item.type)) return;
      // Move from another slot, or copy from the rec palette.
      if (source && source.type === 'slot'
        && !(source.stopId === stop.id && source.date === day.date && source.slotKey === def.key)) {
        dispatch({ type: 'REMOVE_FROM_SLOT', stopId: source.stopId, date: source.date, slotKey: source.slotKey, itemId: source.itemId });
      }
      if (!(source && source.type === 'slot' && source.stopId === stop.id && source.date === day.date && source.slotKey === def.key)) {
        dispatch({ type: 'ASSIGN_TO_SLOT', stopId: stop.id, date: day.date, slotKey: def.key, item });
      }
    } finally {
      clearDragUi();
    }
  }

  const ring = over && canDrop ? 'ring-[1.5px] ring-[#1a1714] bg-fjord-50'
    : canDrop ? 'ring-[1.5px] ring-[#1a1714]/40'
    : 'ring-[1.5px] ring-transparent';

  // Single slots are "full" once occupied; multi slots always allow more.
  const canAddMore = isMulti || items.length === 0;
  // Sunrise on the Morning header, sunset on the Evening header (null elsewhere).
  const sun = sunChipForSlot(def.key, stop, day.date);

  return html`<div
    onDragOver=${(e) => { if (canDrop) { e.preventDefault(); } }}
    onDragEnter=${() => canDrop && setOver(true)}
    onDragLeave=${() => setOver(false)}
    onDrop=${handleDrop}
    data-droppable-slot
    data-slot-key=${def.key}
    data-stop-id=${stop.id}
    data-date=${day.date}
    data-accepts=${def.accepts.join(',')}
    class=${`relative rounded-[3px] ${ring} transition`}>
    <div class="flex items-center gap-1.5 px-3 mb-2 sm:mb-1.5">
      <span class=${`${SLOT_TINT[def.key] || 'text-slate-500'} inline-flex items-center`}>${SLOT_ICON[def.key] && html`<${SLOT_ICON[def.key]} className="w-4 h-4 sm:w-3.5 sm:h-3.5" />`}</span>
      <span class=${`text-[11px] font-semibold uppercase tracking-wide ${SLOT_TINT[def.key] || 'text-slate-500'}`}>${def.label}</span>
      ${sun && html`<span class="ml-auto inline-flex items-center gap-1 text-[11px] sm:text-[10px] font-medium text-slate-400 normal-case tracking-normal whitespace-nowrap" title=${sun.title}>
        <${sun.dir === 'up' ? IconSunrise : IconSunset} className="w-3 h-3 text-slate-400" />${sun.text}</span>`}
    </div>
    <div data-slot-body class="min-h-[2rem]">
      ${lead.length > 0 && html`<div class="space-y-2 mb-2">${lead}</div>`}
      ${items.length === 0
        ? html`<button type="button" onClick=${(e) => { if (!canDrop) openPicker(e); }}
            class=${`slot-add-btn w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-[2px] border-[1.5px] border-dotted text-[11px] font-semibold uppercase tracking-wide transition ${canDrop ? 'border-[#1a1714] text-[#f4f3ee] bg-[#1a1714]' : 'border-[#1a1714]/45 text-slate-500 hover:border-[#1a1714] hover:bg-[#1a1714] hover:text-[#f4f3ee]'}`}>
            ${canDrop ? 'Drop here' : html`<span class="inline-flex items-center gap-1.5"><${IconPlus} className="w-3.5 h-3.5" /> Add</span>`}
          </button>`
        : html`<div class="ios-group">
            ${items.map((it, i) => html`<${SlotItem} key=${it.id} stop=${stop} day=${day} def=${def} item=${it}
              nextId=${isMulti && items[i + 1] ? items[i + 1].id : null} onDragState=${onDragState} />`)}
            ${canAddMore && !canDrop && html`<button type="button" onClick=${openPicker}
              class="slot-add-btn w-full flex items-center justify-center gap-1.5 px-3 py-2 border-t border-dotted border-[#1a1714]/45 text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-[#1a1714] hover:text-[#f4f3ee] transition">
              <${IconPlus} className="w-3.5 h-3.5" /> Add</button>`}
          </div>`}
    </div>
    ${picking && html`<${SlotPicker} stop=${stop} day=${day} def=${def} anchorRect=${anchorRect} onClose=${() => setPicking(false)} />`}
  </div>`;
}

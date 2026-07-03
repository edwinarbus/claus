import { html } from '../html.js';
import { useStore } from '../store/store.js';
import { ALL_SLOTS } from '../data/slots.js';
import { formatShort, parseISO } from '../lib/dates.js';
import { SlotGlyph } from './slotIcons.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Inline picker: choose a day + slot to drop this item into.
export function AssignMenu({ stop, item, onClose }) {
  const { dispatch } = useStore();
  const slots = ALL_SLOTS.filter((s) => s.accepts.includes(item.type));

  function assign(date, slotKey) {
    dispatch({ type: 'ASSIGN_TO_SLOT', stopId: stop.id, date, slotKey, item });
    onClose();
  }
  const occupied = (day, slotKey) => {
    const v = day.slots[slotKey];
    return Array.isArray(v) ? v.length : !!v;
  };

  if (!stop.days.length) {
    return html`<div class="text-xs text-slate-400 p-2">Give this stop at least one night first.</div>`;
  }

  return html`<div class="mt-2 p-2 rounded-[3px] bg-stone-50 border border-[1.5px] border-[#1a1714] space-y-1.5 animate-fade-in origin-top">
    <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500 px-1">Add to which day & slot?</div>
    ${stop.days.map((day) => {
      const d = parseISO(day.date);
      return html`<div key=${day.id} class="flex items-center gap-2">
        <div class="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500 tnum">${WD[d.getDay()]} ${formatShort(day.date)}</div>
        <div class="flex flex-wrap gap-1">
          ${slots.map((s) => html`<button key=${s.key}
            onClick=${() => assign(day.date, s.key)}
            title=${s.label + (occupied(day, s.key) && s.kind === 'single' ? ' (will replace)' : '')}
            class=${`text-xs px-1.5 py-0.5 rounded-[2px] border border-[1.5px] transition flex items-center gap-1 ${occupied(day, s.key) ? 'bg-[#1a1714] border-[#1a1714] text-[#f4f3ee]' : 'bg-white border-[#1a1714] text-slate-500 hover:bg-[#1a1714] hover:text-[#f4f3ee]'}`}>
            <span class="inline-flex items-center"><${SlotGlyph} slotKey=${s.key} className="w-3 h-3" /></span><span class="hidden sm:inline">${s.label}</span></button>`)}
        </div>
      </div>`;
    })}
  </div>`;
}

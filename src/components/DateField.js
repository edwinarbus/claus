import { html } from '../html.js';
import { formatShort } from '../lib/dates.js';

// Compact date control: shows "Jul 17" (no year, to save space) and opens the
// native date picker via a transparent input on top. `fallback` is the leg date
// autopopulated from the timeline — shown, and used as the picker's starting
// point, until the traveler picks an explicit date.
export function DateField({ value = '', fallback = '', onChange, ariaLabel = 'Date' }) {
  const effective = value || fallback || '';
  const label = effective ? formatShort(effective) : 'date';
  return html`<label
    class=${`relative inline-flex items-center justify-center px-2 py-1 rounded-[2px] border-[1.5px] border-[#1a1714] bg-white text-xs font-semibold cursor-pointer min-w-[3.5rem] ${effective ? 'text-slate-900' : 'text-slate-500'}`}>
    <span class="pointer-events-none whitespace-nowrap">${label}</span>
    <input type="date" value=${effective} aria-label=${ariaLabel}
      onInput=${(e) => onChange(e.target.value)}
      onClick=${(e) => { try { e.currentTarget.showPicker && e.currentTarget.showPicker(); } catch { /* not supported */ } }}
      class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
  </label>`;
}

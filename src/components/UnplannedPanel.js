import { html } from '../html.js';
import { unassignedTier1, missingIconicSights } from '../store/selectors.js';
import { IconWarning } from './icons.js';

const TYPE_LABEL = { see: 'See', do: 'Do', eat: 'Eat' };

function joinNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export function UnplannedPanel({ stop }) {
  const iconic = missingIconicSights(stop);
  const items = unassignedTier1(stop);
  if (!iconic.length && !items.length) return null;

  // Don't repeat an iconic sight in the quieter must-do list below.
  const iconicKeys = new Set(iconic.map((it) => it.sourceId || it.id));
  const rest = items.filter((it) => !iconicKeys.has(it.sourceId || it.id));

  return html`<div class="mb-4 space-y-2">
    ${iconic.length > 0 && html`<div class="rounded-[3px] border border-[1.5px] border-[#1a1714] bg-rose-50 px-3 py-2.5 flex items-start gap-2.5 animate-fade-in">
      <span class="shrink-0 inline-flex items-center text-rose-600 mt-px"><${IconWarning} className="w-4 h-4" /></span>
      <div class="min-w-0 text-xs text-rose-900 leading-snug">
        <span class="font-semibold">${joinNames(iconic.map((it) => it.name))}</span>
        ${iconic.length === 1 ? ' is' : ' are'} ${stop.name}’s signature sight${iconic.length === 1 ? '' : 's'} — and not in your plan yet.
        <span class="text-rose-700"> Add ${iconic.length === 1 ? 'it' : 'them'} so you don’t miss out.</span>
      </div>
    </div>`}

    ${rest.length > 0 && html`<div class="rounded-[3px] border border-[1.5px] border-[#1a1714] bg-amber-50 px-3 py-2.5">
      <div class="text-[11px] font-semibold uppercase tracking-wide text-amber-800 mb-1.5">
        Must-dos not yet planned (${rest.length})
      </div>
      <ul class="space-y-1">
        ${rest.map((it) => html`<li key=${it.id} class="flex items-center gap-2 text-xs text-amber-900">
          <span class="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-700 w-7">${TYPE_LABEL[it.bucket] || it.type}</span>
          <span class="font-medium">${it.name}</span>
        </li>`)}
      </ul>
    </div>`}
  </div>`;
}

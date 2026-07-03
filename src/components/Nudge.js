import { html } from '../html.js';
import { useStore, useTrip } from '../store/store.js';
import { dayNudges, heatNudges } from '../data/nudges.js';
import { IconX, IconUtensils, IconHeat } from './icons.js';

const NUDGE_GLYPH = { eat: IconUtensils, heat: IconHeat };

function NudgeBanner({ tone, text, actionLabel, onAction, onDismiss }) {
  const tones = {
    eat: 'bg-amber-50 border-amber-300 text-amber-800',
    heat: 'bg-sky-50 border-sky-300 text-sky-800',
  };
  const Glyph = NUDGE_GLYPH[tone] || IconUtensils;
  return html`<div class=${`flex items-start gap-2 rounded-[3px] border border-[1.5px] px-2.5 py-1.5 mb-2 text-xs animate-fade-in ${tones[tone]}`}>
    <span class="shrink-0 inline-flex items-center mt-0.5"><${Glyph} className="w-3.5 h-3.5" /></span>
    <span class="flex-1 leading-snug">${text}</span>
    ${actionLabel && html`<button onClick=${onAction}
      class="shrink-0 font-semibold underline decoration-dotted hover:decoration-solid">${actionLabel}</button>`}
    <button onClick=${onDismiss} class="shrink-0 opacity-50 hover:opacity-100" title="Dismiss"><${IconX} className="w-3.5 h-3.5" /></button>
  </div>`;
}

export function DayNudge({ stop, day }) {
  const { dispatch } = useStore();
  const trip = useTrip();
  const dismissed = trip.dismissedNudges;
  const eats = dayNudges(stop, day, dismissed);
  const heats = heatNudges(stop, day, dismissed, trip.filterPrefs.avoidHeatPM);

  if (!eats.length && !heats.length) return null;

  return html`<div>
    ${eats.map((n) => html`<${NudgeBanner} key=${n.id} tone="eat" text=${n.text}
      actionLabel=${`Add to ${n.slotKey}`}
      onAction=${() => dispatch({ type: 'ASSIGN_TO_SLOT', stopId: stop.id, date: day.date, slotKey: n.slotKey, item: n.item })}
      onDismiss=${() => dispatch({ type: 'DISMISS_NUDGE', nudgeId: n.id })} />`)}
    ${heats.map((n) => html`<${NudgeBanner} key=${n.id} tone="heat" text=${n.text}
      actionLabel="Move to morning"
      onAction=${() => {
        dispatch({ type: 'REMOVE_FROM_SLOT', stopId: stop.id, date: day.date, slotKey: n.fromSlot, itemId: n.item.id });
        dispatch({ type: 'ASSIGN_TO_SLOT', stopId: stop.id, date: day.date, slotKey: 'morning', item: n.item });
      }}
      onDismiss=${() => dispatch({ type: 'DISMISS_NUDGE', nudgeId: n.id })} />`)}
  </div>`;
}

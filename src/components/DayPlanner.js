import { html } from '../html.js';
import { DayCard } from './DayCard.js';

export function DayPlanner({ stop, weather, draggingItem, onDragState, showHints = true }) {
  if (!stop.days.length) {
    return html`<div class="text-sm text-slate-500 text-center py-8 border border-[1.5px] border-dashed border-[#1a1714] rounded-[3px] bg-stone-50">
      This stop has no nights yet — give it a date range to plan day by day.
    </div>`;
  }
  return html`<div>
    ${stop.days.map((day, i) => html`<${DayCard} key=${day.id}
      stop=${stop} day=${day} index=${i}
      weatherData=${weather?.byDate?.[day.date]} weatherLoading=${weather?.loading}
      draggingItem=${draggingItem} onDragState=${onDragState} showHints=${showHints} />`)}
  </div>`;
}

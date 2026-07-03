import { html } from '../html.js';
import { dayFullness, hasFullDayTravel } from '../data/pacing.js';

// Subtle per-day meter + label shown inside a day card. `extraMin` folds in
// non-sightseeing time that still eats the day (e.g. inbound travel).
export function PacingMeter({ day, extraMin = 0, coveredSlots = [] }) {
  const f = dayFullness(day, extraMin);
  const travelDay = f.level === 'overstuffed' && hasFullDayTravel(day, extraMin, coveredSlots);
  const planned = f.hours >= 0.1 ? `~${(Math.round(f.hours * 2) / 2)}h planned` : 'nothing planned yet';
  const hrs = extraMin > 0 ? `${planned} (incl. travel)` : planned;
  const label = travelDay ? 'Travel day' : f.label;
  return html`
    <div class="flex items-center gap-2" title=${`${hrs} · tuned for a quick pace`}>
      <div class="w-16 h-2 rounded-[1px] bg-white border border-[1.5px] border-[#1a1714] overflow-hidden">
        <div class="h-full ${f.color} transition-all" style=${{ width: `${Math.max(6, f.fillPct)}%` }}></div>
      </div>
      <span class="text-[11px] font-semibold ${f.text}">${label}</span>
    </div>`;
}

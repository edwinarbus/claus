import { html } from '../html.js';
import { useStore } from '../store/store.js';
import { useDayGeo } from './useDayGeo.js';
import { analyzeDayRoute, collectActivityItems } from '../lib/dayRoute.js';
import { IconMap } from './icons.js';

function joinOrder(names) {
  if (names.length <= 4) return names.join(' → ');
  return `${names.slice(0, 3).join(' → ')} → … → ${names[names.length - 1]}`;
}

export function DayRouteAdvice({ stop, day }) {
  const { dispatch } = useStore();
  const rows = collectActivityItems(day);
  const points = rows.map((r) => r.item);
  const city = { id: stop.cityId || stop.id, name: stop.name, country: stop.country, lat: stop.lat, lng: stop.lng };
  const coords = useDayGeo(points, city);

  const resolved = points.filter((p) => p.id in coords).length;
  if (resolved < points.length) return null;

  const analysis = analyzeDayRoute(day, coords);
  if (!analysis) return null;

  const optimize = () => {
    dispatch({
      type: 'OPTIMIZE_DAY_ROUTE',
      stopId: stop.id,
      date: day.date,
      slots: analysis.optimizedSlots,
    });
  };

  const backtrackLine = analysis.backtracks.length
    ? analysis.backtracks[0].between.length
      ? `You return to the ${analysis.backtracks[0].area} area after visiting ${analysis.backtracks[0].between.join(' and ')}.`
      : `Stops in the ${analysis.backtracks[0].area} area are split across the day.`
    : null;

  return html`<div class="flex flex-col gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-[1.5px] border-[#1a1714] rounded-[3px] px-2.5 py-2 mb-2 animate-fade-in">
    <div class="flex items-start gap-2">
      <span class="shrink-0 inline-flex items-center text-amber-600 mt-px" aria-hidden="true"><${IconMap} className="w-4 h-4" /></span>
      <div class="flex-1 min-w-0 leading-snug">
        <div class="font-semibold text-amber-900">Today's route looks zig-zaggy</div>
        ${backtrackLine && html`<div class="mt-0.5">${backtrackLine}</div>`}
        ${analysis.wastedMin >= 8 && html`<div class="mt-0.5">Roughly ${analysis.wastedMin} extra min criss-crossing the city.</div>`}
        <div class="mt-1 text-amber-900/90">
          <span class="font-medium">Smoother order:</span> ${joinOrder(analysis.optimalOrder)}
        </div>
      </div>
    </div>
    <button
      onClick=${optimize}
      class="self-start ml-6 px-2.5 py-1 rounded-[2px] border border-[1.5px] border-[#1a1714] bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700 transition">
      Reorder day to optimize route
    </button>
  </div>`;
}

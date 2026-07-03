import { html } from '../html.js';
import { useTrip } from '../store/store.js';
import { RecCard } from './RecCard.js';
import { RecAutocomplete } from './RecAutocomplete.js';
import { BUCKETS } from '../data/slots.js';
import { sortRecs } from '../store/selectors.js';
import { IconEye, IconBoot, IconUtensils } from './icons.js';

const BUCKET_ICON = { see: IconEye, do: IconBoot, eat: IconUtensils };

function Bucket({ stop, bucket, weights, avoidHeatPM, onDragState }) {
  const items = sortRecs(stop.recs[bucket.key] || [], weights);
  const isEat = bucket.key === 'eat';
  return html`<section class="mb-5">
    <div class="flex items-center gap-2 mb-2.5 text-slate-800">
      <span class="text-slate-800 inline-flex items-center">${BUCKET_ICON[bucket.key] && html`<${BUCKET_ICON[bucket.key]} className="w-4 h-4" />`}</span>
      <h4 class="font-display text-sm font-bold uppercase tracking-wide">${bucket.label}</h4>
      <span class="text-xs font-bold text-slate-500 tnum">${items.length}</span>
      ${isEat && html`<span class="uppercase tracking-wide text-[11px] font-semibold text-slate-500">where to get them</span>`}
    </div>
    <div class="grid grid-cols-1 2xl:grid-cols-2 gap-x-4 gap-y-3 items-start pr-1.5 pb-1.5">
      ${items.map((it) => html`<${RecCard} key=${it.id} stop=${stop} bucket=${bucket.key}
        item=${it} avoidHeatPM=${avoidHeatPM} onDragState=${onDragState} />`)}
    </div>
    <${RecAutocomplete} stop=${stop} bucket=${bucket.key} />
  </section>`;
}

export function RecPanel({ stop, onDragState }) {
  const trip = useTrip();
  const { weights, avoidHeatPM } = trip.filterPrefs;
  return html`<div class="w-full">
    ${BUCKETS.map((b) => html`<${Bucket} key=${b.key} stop=${stop} bucket=${b}
      weights=${weights} avoidHeatPM=${avoidHeatPM} onDragState=${onDragState} />`)}
  </div>`;
}

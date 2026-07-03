import { html } from '../html.js';
import { IconSun, IconClock, IconWarning } from './icons.js';
import { hasClosedDays, closedLabel, closedLabelLong } from '../data/closures.js';

const TIER_TIP = { 1: 'Unmissable', 2: 'High value if you have time', 3: 'Nice extra', 4: 'Deep cut — only with spare time' };

// Quiet tier ranking: a small dot + label in one muted accent (no bright fills).
export function TierBadge({ tier }) {
  const t = tier || 3;
  return html`<span class=${`tier tier-${t}`} title=${TIER_TIP[t] || TIER_TIP[3]}>
    <span class="tier-dot"></span>Tier ${t}
  </span>`;
}

export function formatDurShort(min) {
  if (!min) return '';
  if (min < 60) return `~${min}m`;
  const h = min / 60;
  const rounded = Math.round(h * 2) / 2;
  return `~${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}h`;
}

// Rough time-estimate chip for an activity.
export function DurationChip({ min }) {
  if (!min) return null;
  return html`<span class="chip" title="Rough time estimate (tuned for a quick pace)"><span class="inline-flex items-center gap-1"><${IconClock} className="w-3 h-3" /> ${formatDurShort(min)}</span></span>`;
}

export function TagChips({ tags }) {
  if (!tags || !tags.length) return null;
  return html`<span class="inline-flex flex-wrap gap-1">
    ${tags.map((t) => html`<span key=${t} class="badge">${t}</span>`)}
  </span>`;
}

// Subtle flag for heat-sensitive (strenuous/sun-exposed) activities.
export function HeatFlag({ active = true, emphasized = false, reason = '' }) {
  const tip = reason || 'Sun exposure warning';
  return html`<span
    class=${`inline-flex items-center gap-0.5 text-[10px] font-medium ${emphasized ? 'text-amber-600' : 'text-amber-500/80'}`}
    title=${tip}>
    <${IconSun} className="w-3.5 h-3.5" />${emphasized ? html`<span>AM</span>` : ''}
  </span>`;
}

export function heatReasonText(item) {
  if (!item || !item.heatSensitive) return '';
  if (item.heatReason) return item.heatReason;
  const n = (item.name || '').toLowerCase();
  if (/bike|cycl/i.test(n)) return 'Morning rides beat afternoon heat and rush-hour traffic.';
  if (/hike|trail|walk|climb/i.test(n)) return 'Cooler and less crowded before midday — you’ll enjoy it more.';
  return 'Best before the warm afternoon — less sun exposure and fewer crowds.';
}

// Weekly-closure flag. In rec lists it's a quiet info chip ("Closed Mon");
// when an item is scheduled on a day it's actually closed, pass conflict=true
// for a red warning treatment.
export function ClosedFlag({ item, conflict = false }) {
  if (!hasClosedDays(item)) return null;
  const short = closedLabel(item);
  const long = closedLabelLong(item);
  if (conflict) {
    return html`<span class="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-700 bg-rose-50 border border-[1.5px] border-rose-300 rounded-[2px] px-1.5 py-0.5"
      title=${`Usually closed ${long} — this day is closed`}><${IconWarning} className="w-3 h-3 shrink-0" /> Closed ${short}</span>`;
  }
  return html`<span class="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-600 bg-stone-50 border border-[1.5px] border-[#1a1714] rounded-[2px] px-1.5 py-0.5"
    title=${`Usually closed ${long}`}><${IconClock} className="w-3 h-3 shrink-0" /> Closed ${short}</span>`;
}

export function TypeDot({ type }) {
  const map = { see: 'bg-sky-400', do: 'bg-emerald-400', eat: 'bg-amber-400' };
  return html`<span class=${`inline-block w-1.5 h-1.5 rounded-[1px] ${map[type] || 'bg-slate-300'}`}></span>`;
}

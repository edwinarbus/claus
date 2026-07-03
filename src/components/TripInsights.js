import { html, useState, Fragment, useRef, useLayoutEffect } from '../html.js';
import { useTrip } from '../store/store.js';
import { pacingSummary, transitionWarnings, bookingGaps, stayLengthAdvice } from '../data/warnings.js';
import { dayFullness, hasFullDayTravel } from '../data/pacing.js';
import { dayItemCount } from '../store/selectors.js';
import { resolveTransport, formatDuration } from '../data/logistics.js';
import { formatShort, formatWithWeekday, formatRange } from '../lib/dates.js';
import { dayClosedConflicts, closedLabelLong } from '../data/closures.js';
import { SLOT_BY_KEY } from '../data/slots.js';
import { InsightModal } from './InsightModal.js';
import { IconTicket, IconBed, IconCompass, IconMoon, IconCalendar, IconCheck, IconWarning } from './icons.js';
import { TransportGlyph } from './TransportGlyph.js';

// A row/header icon that draws the transport glyph for a given mode.
const transportRowIcon = (mode) => ({ className }) => html`<${TransportGlyph} mode=${mode} className=${className || 'w-4 h-4'} />`;

// Trip-health chips as flat editorial tokens: a rectangular bordered chip whose
// fill, border and label all share one tonal hue family (amber bookings, rose
// pacing, neutral empties), in uppercase poster-label type.
function Pill({ tone, icon, text, onClick }) {
  const tones = {
    rose: 'border-rose-300 bg-rose-50 text-rose-700',
    amber: 'border-amber-300 bg-amber-50 text-amber-800',
    slate: 'border-[#1a1714] bg-white text-slate-600',
    emerald: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  };
  const base = `inline-flex items-center gap-1.5 rounded-[2px] border-[1.5px] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap shrink-0 ${tones[tone]}`;
  const glyph = typeof icon === 'function'
    ? html`<${icon} className="w-3.5 h-3.5 shrink-0" />`
    : html`<span class="text-[12px] leading-none">${icon}</span>`;
  const inner = html`${glyph} ${text}`;
  if (!onClick) return html`<span class=${base}>${inner}</span>`;
  return html`<button onClick=${onClick} class=${`${base} transition hover:shadow-[4px_4px_0_0_#1a1714] active:translate-y-px`} title="See the list">${inner}</button>`;
}

// ---- Specific rows behind each pill (shown in the InsightModal) -------------

function legRows(trip, legs) {
  return legs.map(({ stopId, index }) => {
    const from = trip.stops[index];
    const to = trip.stops[index + 1];
    const t = resolveTransport(from, to);
    return {
      icon: t ? transportRowIcon(t.mode) : IconTicket,
      title: `${from.name} → ${to.name}`,
      sub: t ? `${t.mode} · ~${formatDuration(t.durationMin)} · ${formatWithWeekday(from.endDate)}` : formatWithWeekday(from.endDate),
      target: { kind: 'leg', stopId },
    };
  });
}

function nightRows(trip, nights) {
  // Group the unbooked nights per stop so 4 nights in one city read as one row.
  const byStop = new Map();
  nights.forEach((n) => {
    if (!byStop.has(n.stopId)) byStop.set(n.stopId, []);
    byStop.get(n.stopId).push(n.date);
  });
  return [...byStop.entries()].map(([stopId, dates]) => {
    const stop = trip.stops.find((s) => s.id === stopId);
    const shown = dates.slice(0, 4).map(formatShort).join(', ');
    const more = dates.length > 4 ? ` +${dates.length - 4} more` : '';
    return {
      icon: IconBed,
      title: stop ? stop.name : '',
      sub: `${dates.length} ${dates.length === 1 ? 'night' : 'nights'} without a hotel: ${shown}${more}`,
      target: { kind: 'stop', stopId },
    };
  });
}

function dayRows(trip, level, icon, subFor) {
  const rows = [];
  trip.stops.forEach((stop) => (stop.days || []).forEach((d) => {
    if (dayFullness(d).level !== level) return;
    if (level === 'overstuffed' && hasFullDayTravel(d)) return;
    rows.push({
      icon,
      title: `${stop.name} — ${formatWithWeekday(d.date)}`,
      sub: subFor(d),
      target: { kind: 'stop', stopId: stop.id },
    });
  }));
  return rows;
}

function oneNightRows(trip, stopWarnings) {
  return trip.stops
    .filter((s) => (stopWarnings[s.id] || []).some((w) => w.includes('1 night')))
    .map((s) => ({
      icon: IconMoon,
      title: s.name,
      sub: `${formatRange(s.startDate, s.endDate)} · 1 night — barely time to settle in`,
      target: { kind: 'stop', stopId: s.id },
    }));
}

function closureConflictRows(trip) {
  const rows = [];
  const seen = new Set();
  trip.stops.forEach((stop) => (stop.days || []).forEach((day) => {
    dayClosedConflicts(day).forEach(({ item, slotKey }) => {
      const key = `${stop.id}|${day.date}|${slotKey}|${item.id || item.sourceId || item.name}`;
      if (seen.has(key)) return;
      seen.add(key);
      const slot = SLOT_BY_KEY[slotKey];
      const closed = closedLabelLong(item);
      rows.push({
        icon: IconWarning,
        title: item.name,
        sub: `${stop.name} — ${formatWithWeekday(day.date)} · ${slot ? slot.label : slotKey}${closed ? ` · usually closed ${closed}` : ''}`,
        target: { kind: 'day', stopId: stop.id, date: day.date },
      });
    });
  }));
  return rows;
}

export function TripInsights({ onJump }) {
  const trip = useTrip();
  const [detail, setDetail] = useState(null);
  const scrollRef = useRef(null);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [trip.stops.length]);

  if (!trip.stops.length) return null;
  const pace = pacingSummary(trip);
  const warn = transitionWarnings(trip);
  const gaps = bookingGaps(trip);
  const stay = stayLengthAdvice(trip);
  const oneNighters = Object.values(warn.stop).filter((a) => a.some((w) => w.includes('1 night'))).length;
  const closureRows = closureConflictRows(trip);

  const jump = (target) => (onJump && target ? () => onJump(target) : undefined);
  // Multi-item pills open the detail list instead of teleporting the page.
  const open = (title, icon, rows) => () => setDetail({ title, icon, rows });

  const pills = [];
  if (pace.over) pills.push({ tone: 'rose', icon: IconWarning, text: `${pace.over} overstuffed ${pace.over === 1 ? 'day' : 'days'}`,
    onClick: open('Overstuffed days', IconWarning, dayRows(trip, 'overstuffed', '', (d) => `${dayItemCount(d).total} things planned — pace yourselves`)) });
  if (gaps.legs.length) pills.push({ tone: 'amber', icon: IconTicket, text: `${gaps.legs.length} ${gaps.legs.length === 1 ? 'leg' : 'legs'} to book`,
    onClick: open(`${gaps.legs.length === 1 ? 'Leg' : 'Legs'} to book`, IconTicket, legRows(trip, gaps.legs)) });
  if (gaps.nights.length) pills.push({ tone: 'amber', icon: IconBed, text: `${gaps.nights.length} ${gaps.nights.length === 1 ? 'night' : 'nights'} without a hotel`,
    onClick: open('Nights without a hotel', IconBed, nightRows(trip, gaps.nights)) });
  if (oneNighters) pills.push({ tone: 'amber', icon: IconMoon, text: `${oneNighters} one-night ${oneNighters === 1 ? 'stop' : 'stops'}`,
    onClick: open(`One-night ${oneNighters === 1 ? 'stop' : 'stops'}`, IconMoon, oneNightRows(trip, warn.stop)) });
  if (closureRows.length) pills.push({ tone: 'rose', icon: IconWarning, text: `${closureRows.length} closed planned ${closureRows.length === 1 ? 'place' : 'places'}`,
    onClick: open(`Closed planned ${closureRows.length === 1 ? 'place' : 'places'}`, IconWarning, closureRows) });
  stay.list.forEach((a) => pills.push(a.level === 'short'
    ? { tone: 'amber', icon: IconBed, text: `${a.name} wants ${a.min}+ nights`,
        onClick: jump({ kind: 'stop', stopId: a.stopId }) }
    : { tone: 'rose', icon: IconWarning, text: `${a.name}: ${a.min}–${a.max} nights is plenty`,
        onClick: jump({ kind: 'stop', stopId: a.stopId }) }));
  if (pace.empty) pills.push({ tone: 'amber', icon: IconCalendar, text: `${pace.empty} empty ${pace.empty === 1 ? 'day' : 'days'}`,
    onClick: open('Empty days', IconCalendar, dayRows(trip, 'empty', '', () => 'Nothing planned yet — a blank slate')) });

  // Mobile: one edge-to-edge swipeable row so the pills never stack into a
  // wall of badges. Larger screens: the familiar centered wrap.
  // InsightModal is rendered OUTSIDE the overflow-x-auto container: iOS Safari
  // does not handle position:fixed descendants of overflow:auto correctly, so
  // the modal would silently fail to appear if kept inside the scrollable row.
  return html`<${Fragment}>
    <div ref=${scrollRef} class="flex items-center justify-start gap-1.5 overflow-x-auto scrollbar-none -mx-4 px-4 py-1.5 -my-1.5 sm:mx-0 sm:px-0 sm:my-0 sm:py-0 sm:justify-center sm:flex-wrap sm:overflow-visible">
      ${pills.length === 0
        ? html`<${Pill} tone="emerald" icon=${IconCheck} text="Nicely balanced so far" />`
        : pills.map((p, i) => html`<${Pill} key=${i} ...${p} />`)}
    </div>
    ${detail && html`<${InsightModal} title=${detail.title} icon=${detail.icon} rows=${detail.rows}
      onJump=${onJump} onClose=${() => setDetail(null)} />`}
  </${Fragment}>`;
}

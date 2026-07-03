import { html } from '../html.js';
import { useStore } from '../store/store.js';
import { Slot } from './Slot.js';
import { LodgingSlot } from './LodgingSlot.js';
import { DayMap } from './DayMap.js';
import { WeatherChip } from './WeatherChip.js';
import { PacingMeter } from './PacingMeter.js';
import { DayNudge } from './Nudge.js';
import { DayRouteAdvice } from './DayRouteAdvice.js';
import { TransportGlyph } from './TransportGlyph.js';
import { IconCheck, IconWarning, IconCalendar } from './icons.js';
import { DAY_SLOTS, MEAL_SLOTS, coveredDaySlots } from '../data/slots.js';
import { dayFullness, hasFullDayTravel } from '../data/pacing.js';
import { resolveTransport, formatDuration, transportTargetsLeg } from '../data/logistics.js';
import { formatShort } from '../lib/dates.js';
import { format12 } from '../lib/time.js';
import { isDayPast } from '../store/selectors.js';
import { dayClosedConflicts, weekdayLong } from '../data/closures.js';

const LONG_TRAVEL_MIN = 240; // 4h+ eats most of an arrival day
const SLOTWORTHY_MIN = 60;   // shorter hops aren't worth their own day-plan block

function legDur(leg) {
  return `${leg.timed ? '' : '~'}${formatDuration(leg.durationMin)}${leg.estimated ? '*' : ''}`;
}

// Overnight legs land you in the morning without eating a daytime slot, so they
// get a top-of-day banner (context) rather than a Morning block.
function OvernightBanner({ leg, fromName }) {
  if (!leg) return null;
  return html`<div class="flex items-start gap-2 rounded-[3px] border border-[1.5px] bg-indigo-50 border-[#1a1714] text-indigo-900 px-2.5 py-1.5 mb-2 text-[12px] sm:text-[11px]">
    <span class="shrink-0 inline-flex items-center text-indigo-900"><${TransportGlyph} mode=${leg.mode} className="w-[1.2rem] h-[1.2rem] sm:w-4 sm:h-4" /></span>
    <span class="flex-1 min-w-0 leading-snug">
      <span class="font-semibold capitalize">${leg.mode}</span>
      <span> from ${fromName} · ${legDur(leg)}</span>
      <span class="block opacity-90">Arrive in the morning — you sleep en route.</span>
    </span>
  </div>`;
}

// A daytime inbound leg is real time out of the arrival day, so it shows up as
// an actual block in the Morning slot. It's derived from the leg (mode, times,
// booked state), so it always reflects what's been edited/booked — and it isn't
// a recommendation, so it never appears in the rec palette.
function TravelChip({ leg, fromName, booked }) {
  const long = leg.durationMin >= LONG_TRAVEL_MIN;
  // Method lives in the title; times/details live in the note (no duplicate
  // mode·duration·time line).
  return html`<div class=${`relative rounded-[3px] border border-[1.5px] border-[#1a1714] px-2.5 py-2 sm:px-2 sm:py-1.5 ${long ? 'bg-amber-50' : 'bg-fjord-50'}`}>
    <div class="flex items-start gap-2 sm:gap-1.5">
      <span class="shrink-0 inline-flex items-center mt-px" aria-hidden="true"><${TransportGlyph} mode=${leg.mode} className="w-[1.2rem] h-[1.2rem] sm:w-4 sm:h-4" /></span>
      <div class="flex-1 min-w-0 leading-snug">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class=${`text-[14.5px] sm:text-[13px] font-semibold capitalize ${long ? 'text-amber-900' : 'text-fjord-800'}`}>${leg.mode} from ${fromName}</span>
          ${booked && html`<span class="inline-flex items-center gap-1 text-[11px] sm:text-[10px] font-medium text-emerald-600"><${IconCheck} className="w-3 h-3" /> booked</span>`}
        </div>
        ${leg.note && html`<div class=${`text-[12px] sm:text-[11px] whitespace-pre-line ${long ? 'text-amber-800' : 'text-slate-500'}`}>${leg.note}</div>`}
        ${long && html`<div class="text-[10px] text-amber-700 mt-0.5">Most of today is in transit — keep the rest light.</div>`}
      </div>
    </div>
  </div>`;
}

// Shown in the later slots a long booked leg spills into, so it's clear that
// time is taken by travel (not free to plan).
function TravelContinuation({ leg }) {
  return html`<div class="relative rounded-[3px] border border-[1.5px] border-dashed border-[#1a1714] bg-fjord-50 px-2.5 py-2 sm:px-2 sm:py-1.5">
    <div class="flex items-center gap-1.5 text-[12px] sm:text-[11px] text-fjord-700">
      <span class="shrink-0 inline-flex items-center" aria-hidden="true"><${TransportGlyph} mode=${leg.mode} className="w-[1.2rem] h-[1.2rem] sm:w-4 sm:h-4" /></span>
      <span class="font-medium">Still in transit${leg.arrTime ? html` · arrive ${format12(leg.arrTime)}` : ''}</span>
    </div>
  </div>`;
}

function joinNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export function DayCard({ stop, day, index, weatherData, weatherLoading, draggingItem, onDragState, showHints = true }) {
  const { trip } = useStore();
  const slotProps = { stop, day, draggingItem, onDragState };

  // The inbound leg lands on this stop's first day — it shares the calendar
  // date with the previous stop's checkout, so day 0 is also the travel day.
  const stopIdx = trip.stops.findIndex((s) => s.id === stop.id);
  const prevStop = stopIdx > 0 ? trip.stops[stopIdx - 1] : null;
  const incoming = index === 0 && prevStop ? resolveTransport(prevStop, stop) : null;
  const overnight = incoming && /overnight/i.test(incoming.mode);
  // A daytime leg becomes a block in the day plan (and counts toward pacing). We
  // show it for any leg worth its own block, and always once it's been booked
  // with times — a booking explicitly reserves that part of the day.
  const showTravelBlock = !!incoming && !overnight
    && (incoming.durationMin >= SLOTWORTHY_MIN || incoming.timed);
  const travelMin = showTravelBlock ? incoming.durationMin : 0;
  const booked = !!(prevStop && prevStop.transportToNext
    && transportTargetsLeg(prevStop.transportToNext, prevStop, stop)
    && prevStop.transportToNext.booked);

  // Drop the travel block into the slot(s) its departure/arrival times cover, so
  // the plan reflects which parts of the day the trip actually consumes. The
  // first covered slot gets the full chip; later slots get an "in transit" mark.
  const travelSlots = showTravelBlock ? coveredDaySlots(incoming.depTime, incoming.arrTime) : [];
  const injectedBySlot = {};
  travelSlots.forEach((key, i) => {
    injectedBySlot[key] = [i === 0
      ? html`<${TravelChip} key="travel" leg=${incoming} fromName=${prevStop.name} booked=${booked} />`
      : html`<${TravelContinuation} key="travel-cont" leg=${incoming} />`];
  });

  const fullness = dayFullness(day, travelMin);
  const suppressOverstuffed = hasFullDayTravel(day, travelMin, travelSlots);
  const conflicts = dayClosedConflicts(day);
  const dayName = weekdayLong(day.date);
  const past = isDayPast(day);

  return html`<div id=${`day-${stop.id}-${day.date}`} class=${`py-3 ${index > 0 ? 'border-t border-[#1a1714]' : ''} ${past ? 'opacity-55 saturate-50 hover:opacity-100 hover:saturate-100' : ''}`}>
    <div class="flex items-center justify-between gap-2 mb-2">
      <div class="flex items-center gap-2 min-w-0 flex-wrap">
        <span class="inline-flex items-center px-2 py-1 rounded-[2px] bg-[#1a1714] text-[#f4f3ee] text-[11px] font-bold uppercase tracking-wide shrink-0">Day ${index + 1}</span>
        <span class="font-display text-[16px] font-bold tracking-tight text-slate-900 leading-tight">${dayName}<span class="text-slate-500 font-normal">, ${formatShort(day.date)}</span></span>
        ${past && html`<span class="inline-flex items-center px-1.5 py-0.5 rounded-[2px] bg-stone-100 border border-[1.5px] border-[#1a1714] text-slate-500 text-[10px] font-semibold uppercase tracking-wide">Past</span>`}
        <${WeatherChip} data=${weatherData} loading=${weatherLoading} showLow=${true} />
      </div>
      <${PacingMeter} day=${day} extraMin=${travelMin} coveredSlots=${travelSlots} />
    </div>

    ${overnight && html`<${OvernightBanner} leg=${incoming} fromName=${prevStop.name} />`}

    ${conflicts.length > 0 && html`<div class="flex items-start gap-2 text-[11px] text-rose-700 bg-rose-50 border border-[1.5px] border-[#1a1714] rounded-[3px] px-2.5 py-1.5 mb-2 animate-fade-in">
      <span class="shrink-0 inline-flex items-center"><${IconWarning} className="w-4 h-4" /></span>
      <span class="flex-1 leading-snug">
        <span class="font-semibold">It's a ${dayName}.</span> ${joinNames(conflicts.map((c) => c.item.name))}
        ${conflicts.length === 1 ? ' is' : ' are'} usually closed on ${dayName}s — move ${conflicts.length === 1 ? 'it' : 'them'} to another day, or double-check this date's hours.
      </span>
    </div>`}

    ${showHints && html`<${DayNudge} stop=${stop} day=${day} />`}

    <${DayRouteAdvice} stop=${stop} day=${day} />

    ${showHints && fullness.level === 'overstuffed' && !suppressOverstuffed && html`<div class="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-[1.5px] border-[#1a1714] rounded-[3px] px-2.5 py-1.5 mb-2">
      <span class="shrink-0 inline-flex items-center"><${IconWarning} className="w-3.5 h-3.5" /></span><span>Overstuffed (~${Math.round(fullness.hours)}h planned). Even at your quick pace this is a lot — consider moving one thing to a lighter day.</span>
    </div>`}
    ${showHints && fullness.under && html`<div class="flex items-start gap-2 text-[11px] text-sky-700 bg-sky-50 border border-[1.5px] border-[#1a1714] rounded-[3px] px-2.5 py-1.5 mb-2">
      <span class="shrink-0 inline-flex items-center"><${IconCalendar} className="w-3.5 h-3.5" /></span><span>${fullness.level === 'empty' ? 'Nothing planned yet' : 'Room for more'} — drag a few more sights in to pack the day.</span>
    </div>`}

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-2.5 mb-3.5 sm:mb-2.5">
      ${DAY_SLOTS.map((def) => html`<${Slot} key=${def.key} def=${def} ...${slotProps}
        injected=${injectedBySlot[def.key] || null} />`)}
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-2.5 mb-3.5 sm:mb-2.5">
      ${MEAL_SLOTS.map((def) => html`<${Slot} key=${def.key} def=${def} ...${slotProps} />`)}
    </div>
    <div>
      <${LodgingSlot} stop=${stop} day=${day} showHints=${showHints} />
    </div>

    ${showHints && html`<${DayMap} stop=${stop} day=${day} />`}
  </div>`;
}

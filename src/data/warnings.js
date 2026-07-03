// Gentle logistics + pacing warnings. Never blocking — just advisory strings.
import { haversineKm, transportTargetsLeg } from './logistics.js';
import { nightsBetween } from '../lib/dates.js';
import { dayFullness, hasFullDayTravel } from './pacing.js';
import { nightsAdviceFor } from './cityNights.js';

// Returns:
//   connector: { [stopId]: warningText }  — for the leg leaving that stop
//   stop:      { [stopId]: [warningText] } — about the stop itself
export function transitionWarnings(trip) {
  const connector = {};
  const stop = {};
  const stops = trip.stops;

  stops.forEach((s) => {
    const nights = nightsBetween(s.startDate, s.endDate);
    const warns = [];
    if (nights <= 1) warns.push('Only 1 night — barely time to settle in');
    // (Long-travel-day warnings removed — they flag legs the traveler can't
    // avoid, so they were noise rather than something actionable.)
    if (warns.length) stop[s.id] = warns;
  });

  return { connector, stop };
}

function pathDistance(list) {
  let total = 0;
  for (let i = 0; i < list.length - 1; i++) total += haversineKm(list[i], list[i + 1]);
  return total;
}

// Nearest-neighbour reordering that keeps the first stop fixed (your entry city).
function nearestNeighbourOrder(stops) {
  if (stops.length < 3) return stops.slice();
  const remaining = stops.slice(1);
  const order = [stops[0]];
  let cur = stops[0];
  while (remaining.length) {
    let bestI = 0; let bestD = Infinity;
    remaining.forEach((s, i) => {
      const d = haversineKm(cur, s);
      if (d < bestD) { bestD = d; bestI = i; }
    });
    cur = remaining.splice(bestI, 1)[0];
    order.push(cur);
  }
  return order;
}

// If the current order backtracks a lot, propose a tighter loop. Advisory only —
// the traveler may have good reasons (events, flights) for their order.
export function routeAdvisory(trip) {
  const s = trip.stops;
  if (s.length < 4) return null;
  const current = pathDistance(s);
  const tighter = nearestNeighbourOrder(s);
  const optimized = pathDistance(tighter);
  const savedKm = Math.round(current - optimized);
  if (current > optimized * 1.3 && savedKm >= 300) {
    return { savedKm, order: tighter.map((x) => x.name) };
  }
  return null;
}

// What still needs booking. Travel legs are "booked" once the traveler ticks
// the Booked toggle on the connector (the route ships with suggested modes, so
// "has a mode" can't mean booked). A night counts as booked once a hotel name
// is typed into its lodging slot. Both lists are in trip order, so item 0 is
// always the earliest unbooked entry — handy for "jump to it" pills.
export function bookingGaps(trip) {
  const stops = trip.stops || [];
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const t = stops[i].transportToNext;
    if (!transportTargetsLeg(t, stops[i], stops[i + 1]) || !t || !t.booked) {
      legs.push({ stopId: stops[i].id, index: i });
    }
  }
  const nights = [];
  stops.forEach((s, stopIndex) => {
    (s.days || []).forEach((d) => {
      if (!d.slots || !d.slots.lodging) nights.push({ stopId: s.id, date: d.date, stopIndex });
    });
  });
  return { legs, nights };
}

// Recommended length-of-stay advice per stop. Recommended night ranges live in
// the catalog-keyed cityNights table and are read here at compute time — nothing
// is stored on the stop. Nights are derived from the stop's own dates via the
// shared date helper. Returns:
//   byStop: { [stopId]: advice }      — only stops that warrant a nudge
//   list:   [{ stopId, name, ...advice }] — flat & trip-ordered, for pills
// where advice is { level: 'short' | 'long', min, max, ideal, nights, message }.
export function stayLengthAdvice(trip) {
  const byStop = {};
  const list = [];
  (trip.stops || []).forEach((s) => {
    const nights = nightsBetween(s.startDate, s.endDate);
    const advice = nightsAdviceFor(s.cityId, nights);
    if (advice) {
      byStop[s.id] = advice;
      list.push({ stopId: s.id, name: s.name, ...advice });
    }
  });
  return { byStop, list };
}

// Trip-wide pacing summary: counts of empty / overstuffed days.
export function pacingSummary(trip) {
  let empty = 0; let over = 0; let total = 0;
  trip.stops.forEach((s) => s.days.forEach((d) => {
    total += 1;
    const f = dayFullness(d);
    if (f.level === 'empty') empty += 1;
    if (f.level === 'overstuffed' && !hasFullDayTravel(d)) over += 1;
  }));
  return { empty, over, total };
}

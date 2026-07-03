// Derived/computed views over the trip state. Pure functions.
import { daysBetween, nightsBetween, eachDate, addDays, isPastISO } from '../lib/dates.js';

// A single day is "past" once its date is behind us.
export function isDayPast(day) {
  return !!day && isPastISO(day.date);
}

// A stop is "past" once you've checked out — i.e. every one of its days is
// behind us. (Partial stays you're currently in are not greyed at stop level.)
export function isStopPast(stop) {
  if (!stop) return false;
  if (stop.days && stop.days.length) return stop.days.every((d) => isPastISO(d.date));
  return isPastISO(stop.endDate);
}

// Score a rec item by the user's interest weights. Must-eats get a small boost
// so local delicacies stay prominent (per the brief's emphasis).
export function scoreItem(item, weights) {
  let score = 0;
  (item.tags || []).forEach((t) => { score += weights[t] || 0; });
  if (item.type === 'eat') score += 1;
  return score;
}

// Return items sorted by weight (desc), stable on original order for ties.
export function sortByWeight(items, weights) {
  return items
    .map((it, i) => ({ it, i, s: scoreItem(it, weights) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.it);
}

// Rank recommendations: Tier 1 first, then by interest-weight score, stable.
export function sortRecs(items, weights) {
  return items
    .map((it, i) => ({ it, i, tier: it.tier || 3, s: scoreItem(it, weights) }))
    .sort((a, b) => (a.tier - b.tier) || (b.s - a.s) || (a.i - b.i))
    .map((x) => x.it);
}

export function tripNights(trip) {
  return trip.stops.reduce((n, s) => n + nightsBetween(s.startDate, s.endDate), 0);
}

export function tripSpanDays(trip) {
  if (!trip.startDate || !trip.endDate) return 0;
  return daysBetween(trip.startDate, trip.endDate) + 1;
}

// All dates covered by the timeline window (inclusive).
export function tripDates(trip) {
  if (!trip.startDate || !trip.endDate) return [];
  return eachDate(trip.startDate, trip.endDate);
}

// Position a stop on the timeline as a fraction [0..1] of the trip window.
export function stopBounds(trip, stop) {
  const total = Math.max(1, daysBetween(trip.startDate, trip.endDate));
  const offset = Math.max(0, daysBetween(trip.startDate, stop.startDate));
  const len = Math.max(1, nightsBetween(stop.startDate, stop.endDate));
  return { leftPct: (offset / total) * 100, widthPct: (len / total) * 100, offset, len };
}

// How many items are assigned across a day's slots.
export function dayItemCount(day) {
  const s = day.slots;
  const multi = ['morning', 'afternoon', 'evening'].reduce((n, k) => n + (s[k]?.length || 0), 0);
  const single = ['breakfast', 'lunch', 'dinner', 'lodging'].reduce((n, k) => n + (s[k] ? 1 : 0), 0);
  return { multi, single, total: multi + single };
}

export function stopAssignedCount(stop) {
  return stop.days.reduce((n, d) => n + dayItemCount(d).total, 0);
}

function itemKey(it) {
  if (it.sourceId) return `id:${it.sourceId}`;
  return `name:${(it.name || '').toLowerCase()}`;
}

function stopPlannedKeys(stop) {
  const keys = new Set();
  stop.days.forEach((day) => {
    const s = day.slots;
    ['morning', 'afternoon', 'evening'].forEach((k) => {
      (s[k] || []).forEach((it) => keys.add(itemKey(it)));
    });
    ['breakfast', 'lunch', 'dinner', 'lodging'].forEach((k) => {
      if (s[k]) keys.add(itemKey(s[k]));
    });
  });
  return keys;
}

export function isItemPlanned(stop, item) {
  const keys = stopPlannedKeys(stop);
  return keys.has(itemKey(item));
}

// The one unmissable, signature sight per catalog city — the "you'd be crazy to
// skip it" landmark (Golden-Gate-Bridge-level). Used to warn when it's not in
// the day plan. Keyed by city id → catalog item sourceIds. Minor stops with no
// single obvious icon (e.g. Malmö, Gothenburg) are intentionally omitted.
export const ICONIC_SIGHTS = {
  copenhagen: ['cph-nyhavn'],
  aarhus: ['aar-aros'],
  aero: ['aero-town'],
  kalmar: ['kal-castle'],
  stockholm: ['sto-gamlastan'],
  helsinki: ['hel-senate'],
  oslo: ['osl-vigeland'],
  flam: ['flam-railway'],
  bergen: ['ber-bryggen'],
  geiranger: ['gei-fjordcruise'],
  stavanger: ['sta-preikestolen'],
  tromso: ['tro-fjellheisen'],
  lofoten: ['lof-reine'],
  tallinn: ['tal-oldtown'],
  munich: ['mun-marienplatz'],
};

// Signature sights for this stop's city that exist in its recs but aren't placed
// in any day — i.e. a major landmark the traveler is about to miss.
export function missingIconicSights(stop) {
  const ids = ICONIC_SIGHTS[stop.cityId];
  if (!ids || !ids.length) return [];
  const planned = stopPlannedKeys(stop);
  const out = [];
  ids.forEach((iconId) => {
    let found = null;
    ['see', 'do', 'eat'].forEach((bucket) => {
      (stop.recs[bucket] || []).forEach((it) => {
        if ((it.sourceId || it.id) === iconId) found = { ...it, bucket };
      });
    });
    if (found && !planned.has(itemKey(found))) out.push(found);
  });
  return out;
}

// Tier-1 see/do/eat recs not yet assigned to any day slot.
export function unassignedTier1(stop) {
  const out = [];
  ['see', 'do', 'eat'].forEach((bucket) => {
    (stop.recs[bucket] || []).forEach((it) => {
      if ((it.tier || 3) === 1 && !isItemPlanned(stop, it)) out.push({ ...it, bucket });
    });
  });
  return out;
}

export function tripUnassignedTier1(trip) {
  const out = [];
  trip.stops.forEach((stop) => {
    unassignedTier1(stop).forEach((item) => out.push({ stop, item }));
  });
  return out;
}

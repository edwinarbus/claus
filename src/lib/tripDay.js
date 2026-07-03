// Resolve "today on trip" — the day context the chat's briefing receipt (and
// its local-brief fallback) is built from.

import { todayISO, daysBetween } from './dates.js';
import { isLocalDev, devSimulatedDateISO } from './devTripDay.js';

// A specific calendar day inside the trip window.
export function findDayOnTrip(trip, dateISO) {
  if (!trip?.stops?.length || !dateISO) return null;
  if (daysBetween(trip.startDate, dateISO) < 0 || daysBetween(dateISO, trip.endDate) < 0) return null;
  for (const stop of trip.stops) {
    const day = (stop.days || []).find((d) => d.date === dateISO);
    if (day) {
      const dayIndex = typeof day.index === 'number' ? day.index : stop.days.indexOf(day);
      return { stop, day, dayIndex: Math.max(0, dayIndex) };
    }
  }
  return null;
}

// Today falls inside the trip window AND matches a planned day on a stop.
export function findTodayOnTrip(trip) {
  return findDayOnTrip(trip, todayISO());
}

// Real today, or a simulated trip day on localhost only.
export function resolveTripDayContext(trip) {
  if (!trip?.stops?.length) return null;
  const dateISO = isLocalDev() ? devSimulatedDateISO(trip) : todayISO();
  const ctx = findDayOnTrip(trip, dateISO);
  if (!ctx) return null;
  return { ...ctx, devSimulated: isLocalDev() && dateISO !== todayISO() };
}

// Today's trip day if you're on the trip, otherwise the very first day of the
// trip — used to build a brief even before/after the trip window.
export function previewTripDayContext(trip) {
  if (!trip?.stops?.length) return null;
  const todays = findTodayOnTrip(trip);
  if (todays) return todays;
  for (const stop of trip.stops) {
    const day = (stop.days || [])[0];
    if (day) return { stop, day, dayIndex: 0 };
  }
  return null;
}

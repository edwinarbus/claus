// Canonical itinerary dates for Tyler & Edwin's 2026 trip. Edits that move
// stops on the calendar require explicit human confirmation; the lock updates
// only after a confirmed change.

import { formatWithWeekday, nightsBetween } from './dates.js';

/** Approved schedule — Jul 13 2026 Scandinavia/Baltics (4n Flåm), + a Munich detour. */
export const CANONICAL_TRIP_DATES = {
  version: 1,
  startDate: '2026-07-13',
  endDate: '2026-08-07',
  stops: [
    { cityId: 'copenhagen', startDate: '2026-07-13', endDate: '2026-07-17' },
    { cityId: 'bergen', startDate: '2026-07-17', endDate: '2026-07-20' },
    { cityId: 'flam', startDate: '2026-07-20', endDate: '2026-07-24' },
    { cityId: 'oslo', startDate: '2026-07-24', endDate: '2026-07-27' },
    { cityId: 'stockholm', startDate: '2026-07-27', endDate: '2026-07-31' },
    { cityId: 'helsinki', startDate: '2026-07-31', endDate: '2026-08-02' },
    { cityId: 'tallinn', startDate: '2026-08-02', endDate: '2026-08-04' },
    { cityId: 'munich', startDate: '2026-08-04', endDate: '2026-08-07' },
  ],
};

export const DATE_CHANGING_ACTIONS = new Set([
  'SET_TRIP_DATES',
  'SET_STOP_DATES',
  'LOAD_DEFAULT_ROUTE',
  'ADD_STOP',
  'REMOVE_STOP',
  'MOVE_STOP',
  'REORDER_STOPS',
  'RESET_ALL',
]);

export function fingerprintFromTrip(trip) {
  if (!trip) return null;
  return {
    version: 1,
    startDate: trip.startDate || '',
    endDate: trip.endDate || '',
    stops: (trip.stops || []).map((s) => ({
      cityId: s.cityId || s.id || '',
      name: s.name || '',
      startDate: s.startDate || '',
      endDate: s.endDate || '',
      dayDates: (s.days || []).map((d) => d.date),
    })),
  };
}

export function getDateLock(trip) {
  const lock = trip?.meta?.dateLock;
  if (lock?.stops?.length) return lock;
  return CANONICAL_TRIP_DATES;
}

export function withDateLock(trip, lock = fingerprintFromTrip(trip)) {
  if (!trip || !lock) return trip;
  return {
    ...trip,
    meta: {
      ...(trip.meta || {}),
      dateLock: lock,
    },
  };
}

function stopLabel(s) {
  return s.name || s.cityId || 'Stop';
}

function fmtRange(start, end) {
  if (!start || !end) return '—';
  const n = nightsBetween(start, end);
  return `${formatWithWeekday(start)} – ${formatWithWeekday(end)} (${n} ${n === 1 ? 'night' : 'nights'})`;
}

/** Human-readable rows for the confirmation modal. */
export function diffDateSchedules(beforeTrip, afterTrip) {
  const before = fingerprintFromTrip(beforeTrip);
  const after = fingerprintFromTrip(afterTrip);
  if (!before || !after) return [];
  const rows = [];

  if (before.startDate !== after.startDate || before.endDate !== after.endDate) {
    rows.push({
      kind: 'trip',
      label: 'Trip window',
      before: fmtRange(before.startDate, before.endDate),
      after: fmtRange(after.startDate, after.endDate),
    });
  }

  const beforeByKey = new Map(before.stops.map((s) => [s.cityId || s.name, s]));
  const afterByKey = new Map(after.stops.map((s) => [s.cityId || s.name, s]));
  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);

  keys.forEach((key) => {
    const b = beforeByKey.get(key);
    const a = afterByKey.get(key);
    if (!b && a) {
      rows.push({
        kind: 'stop',
        label: stopLabel(a),
        before: '—',
        after: fmtRange(a.startDate, a.endDate),
      });
      return;
    }
    if (b && !a) {
      rows.push({
        kind: 'stop',
        label: stopLabel(b),
        before: fmtRange(b.startDate, b.endDate),
        after: 'Removed',
      });
      return;
    }
    if (!b || !a) return;
    const same = b.startDate === a.startDate && b.endDate === a.endDate
      && JSON.stringify(b.dayDates) === JSON.stringify(a.dayDates);
    if (!same) {
      rows.push({
        kind: 'stop',
        label: stopLabel(a),
        before: fmtRange(b.startDate, b.endDate),
        after: fmtRange(a.startDate, a.endDate),
      });
    }
  });

  return rows;
}

export function seedDateLock(trip) {
  const fp = fingerprintFromTrip(trip);
  if (!fp?.stops?.length) return CANONICAL_TRIP_DATES;
  const lock = CANONICAL_TRIP_DATES;
  if (fp.startDate !== lock.startDate || fp.endDate !== lock.endDate) return fp;
  if (fp.stops.length !== lock.stops.length) return fp;
  for (let i = 0; i < lock.stops.length; i++) {
    const a = fp.stops[i];
    const b = lock.stops[i];
    if (!a || !b || a.cityId !== b.cityId || a.startDate !== b.startDate || a.endDate !== b.endDate) {
      return fp;
    }
  }
  return lock;
}

export function datesChangedBetween(beforeTrip, afterTrip) {
  return diffDateSchedules(beforeTrip, afterTrip).length > 0;
}

export function tripDatesDifferFromLock(trip) {
  const lock = getDateLock(trip);
  const fp = fingerprintFromTrip(trip);
  if (!fp) return false;
  if (fp.startDate !== lock.startDate || fp.endDate !== lock.endDate) return true;
  if (fp.stops.length !== lock.stops.length) return true;
  for (let i = 0; i < lock.stops.length; i++) {
    const a = fp.stops[i];
    const b = lock.stops[i];
    if (!a || !b) return true;
    if (a.startDate !== b.startDate || a.endDate !== b.endDate) return true;
    if ((a.cityId || '') !== (b.cityId || '')) return true;
  }
  return false;
}

// Klaus mode — a one-day (well, rest-of-trip) gag rename. Once the trip
// reaches its Munich stop, "Claus" becomes "Klaus" everywhere the brand name
// is shown. Mirrors the same real/dev-simulated "today" resolution as
// lib/tripDay.js so `?simulateDay=` on localhost previews it too.
import { todayISO } from './dates.js';
import { isLocalDev, devSimulatedDateISO } from './devTripDay.js';

const KLAUS_CITY_ID = 'munich';

function currentDateISO(trip) {
  return isLocalDev() ? devSimulatedDateISO(trip) : todayISO();
}

/** True from the day the Munich stop starts through the rest of the trip. */
export function isKlausMode(trip) {
  const stop = trip?.stops?.find((s) => s.cityId === KLAUS_CITY_ID);
  if (!stop?.startDate) return false;
  return currentDateISO(trip) >= stop.startDate;
}

/** Swap the default "Claus" brand name for "Klaus"; leaves a custom trip name alone. */
export function brandName(trip) {
  const name = trip?.name || 'Claus';
  return isKlausMode(trip) && name === 'Claus' ? 'Klaus' : name;
}

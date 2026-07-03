// Transport metadata + simple distance/time estimates + transition warnings.
import { guideDurationMin } from './routeDurations.js';

export const MODE_ICONS = [
  { match: ['overnight'], icon: '🛳️', label: 'Overnight boat' },
  { match: ['flight', 'fly', 'plane', 'air'], icon: '✈️', label: 'Flight' },
  { match: ['express boat', 'boat', 'ferry', 'cruise', 'sail'], icon: '⛴️', label: 'Boat' },
  { match: ['train', 'rail'], icon: '🚆', label: 'Train' },
  { match: ['bus', 'coach'], icon: '🚌', label: 'Bus' },
  { match: ['car', 'drive'], icon: '🚗', label: 'Car' },
  { match: ['walk', 'foot'], icon: '🚶', label: 'Walk' },
];

// Single primary modes only — pick the main way you travel a leg.
export const TRANSPORT_OPTIONS = ['train', 'bus', 'car', 'ferry', 'express boat', 'overnight boat', 'flight'];

export function transportIcon(mode = '') {
  const m = mode.toLowerCase();
  // Combined modes: show the "biggest" leg first by checking in priority order.
  for (const entry of MODE_ICONS) {
    if (entry.match.some((k) => m.includes(k))) return entry.icon;
  }
  return '➡️';
}

export function haversineKm(a, b) {
  if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return 0;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const MODE_SPEED_KMH = { flight: 600, train: 90, bus: 70, car: 75, ferry: 35, boat: 35, overnight: 30 };

// Opinionated, geography-aware recommendation for getting between two stops.
// Returns { mode, reason } — used both as the default and as a "guide tip" the
// traveler can apply when they've picked something less sensible (e.g. driving).
export function suggestTransport(a, b) {
  const d = Math.round(haversineKm(a, b));
  const ca = a.country; const cb = b.country;
  const ids = [a.cityId, b.cityId];
  const has = (x) => ids.includes(x);
  const between = (x, y) => has(x) && has(y);

  // Baltic Sea crossings — no sensible land route.
  if ((ca === 'Sweden' && cb === 'Finland') || (ca === 'Finland' && cb === 'Sweden')) {
    return { mode: 'overnight boat', reason: 'the overnight Stockholm–Helsinki ferry turns a long haul into a free hotel night' };
  }
  if ((ca === 'Finland' && cb === 'Estonia') || (ca === 'Estonia' && cb === 'Finland')) {
    return { mode: 'ferry', reason: 'a fast ferry crosses the Gulf of Finland in about 2 hours' };
  }
  // Norway fjords + Danish islands need boats.
  if (between('flam', 'bergen')) return { mode: 'train', reason: 'the Norway-in-a-Nutshell route — Bergen Railway, the Nærøyfjord cruise and the Flåm Railway — is the classic scenic way between Bergen and the fjord' };
  if (has('flam')) return { mode: 'train', reason: 'the scenic railway (including the Flåm Line) is the classic fjord approach' };
  if (between('copenhagen', 'malmo')) return { mode: 'train', reason: 'the Øresund Bridge train links the two cities in ~35 minutes' };
  // The two Arctic stops pair naturally by road; anything else to/from them flies.
  if (between('lofoten', 'tromso')) return { mode: 'car', reason: 'the Lofoten–Tromsø drive along the E10 and the fjords is one of Norway’s great road trips' };
  if (has('lofoten')) return { mode: 'flight', reason: 'Lofoten has no rail — fly via Bodø to Svolvær/Leknes (or to Evenes and drive the E10 in)' };
  if (has('tromso')) return { mode: 'flight', reason: 'Tromsø is far above the Arctic Circle — flying spares you an enormous overland day' };

  if (d > 600) return { mode: 'flight', reason: `it's ~${d} km apart — a short flight beats a full day in transit` };
  if (d > 300) return { mode: 'train', reason: 'a comfortable train distance, and the scenery is part of the trip' };
  return { mode: 'train', reason: 'an easy train hop' };
}

export function estimateDurationMin(distanceKm, mode) {
  const m = (mode || '').toLowerCase();
  let speed = MODE_SPEED_KMH.train;
  for (const k of Object.keys(MODE_SPEED_KMH)) { if (m.includes(k)) { speed = MODE_SPEED_KMH[k]; break; } }
  const overhead = m.includes('flight') ? 120 : 40; // stations/airports
  return Math.round((distanceKm / speed) * 60 + overhead);
}

export function formatDuration(min) {
  if (min == null) return '';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Minutes between two "HH:MM" clock times, rolling past midnight if arrival
// reads earlier than departure (e.g. an overnight ferry).
export function minutesBetweenClock(dep, arr) {
  if (!dep || !arr) return null;
  const [dh, dm] = dep.split(':').map(Number);
  const [ah, am] = arr.split(':').map(Number);
  if ([dh, dm, ah, am].some((n) => Number.isNaN(n))) return null;
  let mins = (ah * 60 + am) - (dh * 60 + dm);
  if (mins < 0) mins += 24 * 60;
  return mins;
}

export function transportTargetsLeg(transport, stop, nextStop) {
  if (!transport || !nextStop) return true;
  const hasStopTarget = transport.fromStopId || transport.toStopId;
  if (hasStopTarget && (transport.fromStopId !== stop?.id || transport.toStopId !== nextStop.id)) return false;
  const hasCityTarget = Object.prototype.hasOwnProperty.call(transport, 'fromCityId')
    || Object.prototype.hasOwnProperty.call(transport, 'toCityId');
  if (hasCityTarget) {
    const fromCity = stop?.cityId || null;
    const toCity = nextStop.cityId || null;
    if ((transport.fromCityId || null) !== fromCity || (transport.toCityId || null) !== toCity) return false;
  }
  return true;
}

// Resolve a stop's transport-to-next into a display-ready leg.
export function resolveTransport(stop, nextStop) {
  if (!nextStop) return null;
  const t = transportTargetsLeg(stop.transportToNext, stop, nextStop) ? (stop.transportToNext || {}) : {};
  const distanceKm = Math.round(haversineKm(stop, nextStop));
  const suggested = suggestTransport(stop, nextStop);
  const mode = t.mode || suggested.mode;
  // Prefer a duration derived from the traveler's own departure/arrival times,
  // then the route-option guide duration, then any explicit stored duration,
  // then a distance-based estimate as the last resort. Guide durations come
  // before stored values because older saved/default trips can carry stale
  // app-generated minutes, while users edit real times via dep/arr clocks.
  const timed = minutesBetweenClock(t.depTime, t.arrTime);
  const explicitDuration = t.durationMin != null ? t.durationMin : null;
  const guideDuration = guideDurationMin(stop, nextStop, mode);
  const durationMin = timed != null ? timed
    : (guideDuration != null ? guideDuration
      : (explicitDuration != null ? explicitDuration : estimateDurationMin(distanceKm, mode)));
  // "Off-advice" = the user picked a mode the guide wouldn't recommend here.
  const offAdvice = !!t.mode && t.mode.toLowerCase() !== suggested.mode.toLowerCase();
  // Dates autopopulate from the itinerary: the leg leaves on the stop's checkout
  // day, and arrival defaults to the same day. Either can be overridden, and an
  // explicit value always wins so edits stick even if the timeline shifts.
  const travelDate = stop?.endDate || stop?.startDate || '';
  const depDate = t.depDate || travelDate;
  const arrDate = t.arrDate || depDate;
  return {
    mode,
    note: t.note || '',
    durationMin,
    distanceKm,
    icon: transportIcon(mode),
    estimated: timed == null && explicitDuration == null && guideDuration == null,
    timed: timed != null,
    depTime: t.depTime || '',
    arrTime: t.arrTime || '',
    depDate,
    arrDate,
    depStation: t.depStation || '',
    arrStation: t.arrStation || '',
    custom: !!t.mode,
    suggested,
    offAdvice,
  };
}

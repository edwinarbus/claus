// The single reducer for the whole trip. Pure; every change returns a new trip
// object so persistence + React see fresh references.
import {
  makeItem, makeStopFromCity, makeCustomStop, buildDays, buildDaysForCity,
  buildDefaultRoute, initialTrip, recsFromCity,
} from './builders.js';
import { addDays, nightsBetween, daysBetween } from '../lib/dates.js';
import { SLOT_BY_KEY, asSlotArray } from '../data/slots.js';
import { CITIES } from '../data/catalog.js';
import { defaultTransportForLeg } from '../data/travelOptions.js';

function mapStop(trip, stopId, fn) {
  return { ...trip, stops: trip.stops.map((s) => (s.id === stopId ? fn(s) : s)) };
}

// Identity of the leg a transportToNext was chosen for. Catalog stops key on
// the city (so re-adding the same city pair keeps working), custom stops on
// their stable stop id.
function legKeyFor(fromStop, toStop) {
  const k = (s) => (s && (s.cityId || s.id)) || '';
  return `${k(fromStop)}>${k(toStop)}`;
}

// Keep stored travel methods honest after the stop list changes. A stop's
// transportToNext describes ONE specific city pair; when a stop is removed,
// reordered, or re-targeted to another city, the legs around it now connect a
// different pair — so a stale mode/times/booked flag must not survive. Dropping
// it lets resolveTransport/travelOptions fall back to the route-aware best
// suggestion for the new pair. Legs whose pair is unchanged are left alone.
// Legs without a legKey (older saves, curated default route) are assumed to
// describe the pair they currently sit between and are stamped in place.
export function reconcileTransports(trip) {
  if (!trip || !Array.isArray(trip.stops) || !trip.stops.length) return trip;
  let changed = false;
  const stops = trip.stops.map((s, i) => {
    const t = s.transportToNext;
    if (!t) return s;
    const next = trip.stops[i + 1] || null;
    if (!next) { changed = true; return { ...s, transportToNext: null }; }
    const key = legKeyFor(s, next);
    if (t.legKey === key) return s;
    changed = true;
    return { ...s, transportToNext: t.legKey == null ? { ...t, legKey: key } : null };
  });
  return changed ? { ...trip, stops } : trip;
}

function mapDay(stop, date, fn) {
  return { ...stop, days: stop.days.map((d) => (d.date === date ? fn(d) : d)) };
}

function stopPairKey(fromStop, toStop) {
  return fromStop?.id && toStop?.id ? `${fromStop.id}>${toStop.id}` : '';
}

function cityPairKey(fromStop, toStop) {
  return fromStop?.cityId && toStop?.cityId ? `${fromStop.cityId}>${toStop.cityId}` : '';
}

function tagTransportLeg(transport, fromStop, toStop) {
  if (!transport || !toStop) return null;
  return {
    ...transport,
    fromStopId: fromStop.id,
    toStopId: toStop.id,
    fromCityId: fromStop.cityId || null,
    toCityId: toStop.cityId || null,
  };
}

function sameTaggedCityPair(transport, fromStop, toStop) {
  return (transport.fromCityId || null) === (fromStop.cityId || null)
    && (transport.toCityId || null) === (toStop.cityId || null);
}

function rememberLegs(stops = []) {
  const byStop = new Map();
  const byCity = new Map();
  for (let i = 0; i < stops.length - 1; i++) {
    const fromStop = stops[i];
    const toStop = stops[i + 1];
    if (!fromStop.transportToNext) continue;
    const tagged = tagTransportLeg(fromStop.transportToNext, fromStop, toStop);
    const stopKey = stopPairKey(fromStop, toStop);
    const cityKey = cityPairKey(fromStop, toStop);
    if (stopKey && !byStop.has(stopKey)) byStop.set(stopKey, tagged);
    if (cityKey && !byCity.has(cityKey)) byCity.set(cityKey, tagged);
  }
  return { byStop, byCity };
}

function transportForLeg(fromStop, toStop, previousLegs) {
  const stopKey = stopPairKey(fromStop, toStop);
  const cityKey = cityPairKey(fromStop, toStop);
  const byStop = stopKey ? previousLegs?.byStop.get(stopKey) : null;
  if (byStop && sameTaggedCityPair(byStop, fromStop, toStop)) return tagTransportLeg(byStop, fromStop, toStop);
  const byCity = cityKey ? previousLegs?.byCity.get(cityKey) : null;
  if (byCity) return tagTransportLeg(byCity, fromStop, toStop);
  return tagTransportLeg(defaultTransportForLeg(fromStop, toStop), fromStop, toStop);
}

function refreshLegTransports(stops, previousStops) {
  const previousLegs = rememberLegs(previousStops);
  return stops.map((s, i) => ({
    ...s,
    transportToNext: i < stops.length - 1 ? transportForLeg(s, stops[i + 1], previousLegs) : null,
  }));
}

// Re-chain every stop's dates from the trip start, preserving each stop's night
// count. Keeps the timeline contiguous when a stop is added/removed/reordered.
function rechain(trip, fromStart = trip.startDate, { refreshTransport = false, previousStops = trip.stops } = {}) {
  let cursor = fromStart;
  let stops = trip.stops.map((s) => {
    const nights = Math.max(1, nightsBetween(s.startDate, s.endDate));
    const start = cursor;
    const end = addDays(start, nights);
    cursor = end;
    return { ...s, startDate: start, endDate: end, days: buildDaysForCity(s.cityId, start, end, s.days) };
  });
  if (refreshTransport) stops = refreshLegTransports(stops, previousStops);
  const endDate = stops.length ? stops[stops.length - 1].endDate : trip.endDate;
  // Every list mutation funnels through here, so this is also where travel
  // methods tied to pairs that no longer exist get reset to the suggestion.
  return reconcileTransports({ ...trip, stops, endDate });
}

export function reducer(trip, action) {
  switch (action.type) {
    case 'SET_STATE':
      return action.trip;

    case 'RESET_ALL':
      return initialTrip();

    case 'SET_TRIP_NAME':
      return { ...trip, name: action.name };

    case 'SET_TRIP_DATES': {
      // Calendar selection. New start slides the whole stop chain.
      // End can extend past the last stop (buffer days) or shorten the last stop.
      let next = { ...trip, startDate: action.startDate, endDate: action.endDate };
      if (trip.stops.length && action.startDate !== trip.startDate) {
        next = rechain(next, action.startDate);
      }
      const last = next.stops[next.stops.length - 1];
      const derivedEnd = last ? last.endDate : action.startDate;
      const end = action.endDate || derivedEnd;

      // Pull end earlier → shorten the last stop (min 1 night).
      if (last && daysBetween(end, derivedEnd) < 0) {
        const nights = nightsBetween(last.startDate, end);
        if (nights >= 1) {
          const stops = [...next.stops];
          stops[stops.length - 1] = {
            ...last,
            endDate: end,
            days: buildDays(last.startDate, end, last.days),
          };
          return { ...next, stops, endDate: end };
        }
        return { ...next, endDate: derivedEnd };
      }

      next.endDate = daysBetween(derivedEnd, end) > 0 ? end : derivedEnd;
      return next;
    }

    case 'LOAD_DEFAULT_ROUTE': {
      const start = action.startDate || trip.startDate || '2026-07-01';
      const { stops, endDate } = buildDefaultRoute(start);
      // Stamp the curated route's transport legs with the pairs they belong to.
      return reconcileTransports({ ...trip, startDate: start, endDate, stops });
    }

    case 'ADD_STOP': {
      const start = action.startDate;
      const end = action.endDate;
      const stop = action.cityId
        ? makeStopFromCity(action.cityId, start, end)
        : makeCustomStop(action.custom || {}, start, end);
      if (!stop) return trip;
      const stops = [...trip.stops];
      const at = action.atIndex == null ? stops.length : action.atIndex;
      stops.splice(at, 0, stop);
      // Re-chain so the new stop sits contiguously and following stops shift.
      return rechain({ ...trip, stops }, trip.startDate, { refreshTransport: true, previousStops: trip.stops });
    }

    case 'REMOVE_STOP': {
      const stops = trip.stops.filter((s) => s.id !== action.stopId);
      return rechain({ ...trip, stops }, trip.startDate, { refreshTransport: true, previousStops: trip.stops });
    }

    case 'MOVE_STOP': {
      const idx = trip.stops.findIndex((s) => s.id === action.stopId);
      if (idx < 0) return trip;
      const target = idx + action.dir;
      if (target < 0 || target >= trip.stops.length) return trip;
      const stops = [...trip.stops];
      const [moved] = stops.splice(idx, 1);
      stops.splice(target, 0, moved);
      return rechain({ ...trip, stops }, trip.startDate, { refreshTransport: true, previousStops: trip.stops });
    }

    // Drag-to-reorder: move `stopId` to sit immediately before `beforeId`
    // (null/unknown => append to the end). Dates re-chain to stay contiguous.
    case 'REORDER_STOPS': {
      const from = trip.stops.findIndex((s) => s.id === action.stopId);
      if (from < 0) return trip;
      if (action.stopId === action.beforeId) return trip;
      const stops = [...trip.stops];
      const [moved] = stops.splice(from, 1);
      let to = action.beforeId ? stops.findIndex((s) => s.id === action.beforeId) : stops.length;
      if (to < 0) to = stops.length;
      stops.splice(to, 0, moved);
      return rechain({ ...trip, stops }, trip.startDate, { refreshTransport: true, previousStops: trip.stops });
    }

    case 'SET_STOP_DATES': {
      // Change one stop's length; following stops re-chain to stay contiguous.
      const updated = mapStop(trip, action.stopId, (s) => ({
        ...s,
        startDate: action.startDate,
        endDate: action.endDate,
        days: buildDaysForCity(s.cityId, action.startDate, action.endDate, s.days),
      }));
      return rechain(updated);
    }

    case 'UPDATE_STOP':
      return mapStop(trip, action.stopId, (s) => ({ ...s, ...action.patch }));

    // Re-target a stop to a different catalog city, keeping its position and
    // dates. Recommendations, map location, weather, and country come from the
    // new city; planned day slots are reset since they belonged to the previous
    // city, and the travel legs in/out are reconciled — a method picked for the
    // old city pair must not stick to the new one.
    case 'CHANGE_STOP_CITY': {
      const city = CITIES[action.cityId];
      if (!city) return trip;
      return reconcileTransports(mapStop(trip, action.stopId, (s) => ({
        ...s,
        cityId: action.cityId,
        name: city.name,
        country: city.country,
        lat: city.lat,
        lng: city.lng,
        blurb: city.blurb,
        delicacies: city.delicacies || null,
        tier: city.tier || 2,
        guideUrl: city.guideUrl || null,
        recs: recsFromCity(city),
        days: buildDaysForCity(action.cityId, s.startDate, s.endDate),
      })));
    }

    case 'SET_TRANSPORT': {
      // Stamp which pair of stops this leg was chosen for — both the city-level
      // legKey (reconcileTransports) and the stop/city tags (transportTargetsLeg
      // + refreshLegTransports) — so later list edits can tell a still-valid
      // leg from a stale one through either mechanism.
      const idx = trip.stops.findIndex((s) => s.id === action.stopId);
      const next = idx >= 0 ? trip.stops[idx + 1] || null : null;
      return mapStop(trip, action.stopId, (s) => ({
        ...s,
        transportToNext: action.transport
          ? {
              ...s.transportToNext,
              ...action.transport,
              legKey: legKeyFor(s, next),
              fromStopId: s.id,
              toStopId: next ? next.id : null,
              fromCityId: s.cityId || null,
              toCityId: next ? next.cityId || null : null,
            }
          : null,
      }));
    }

    case 'SET_ARRIVAL': {
      const patch = action.patch || {};
      let next = { ...trip, arrival: { ...(trip.arrival || {}), ...patch } };
      // Editing the arrival date == moving the whole trip start.
      if (patch.date && patch.date !== trip.startDate) {
        next = { ...next, startDate: patch.date };
        if (next.stops.length) next = rechain(next, patch.date);
      }
      return next;
    }

    case 'SET_DEPARTURE':
      return { ...trip, departure: { ...(trip.departure || {}), ...(action.patch || {}) } };

    // ---- Recommendation palette items ----
    case 'ADD_ITEM': {
      const custom = action.custom !== undefined ? action.custom : true;
      const addedBy = custom ? (action.item.addedBy || action.who || '') : '';
      const item = makeItem({ ...action.item, type: action.bucket, addedBy }, { custom });
      return mapStop(trip, action.stopId, (s) => ({
        ...s,
        recs: { ...s.recs, [action.bucket]: [...s.recs[action.bucket], item] },
      }));
    }

    case 'UPDATE_ITEM':
      return mapStop(trip, action.stopId, (s) => ({
        ...s,
        recs: {
          ...s.recs,
          [action.bucket]: s.recs[action.bucket].map((it) =>
            it.id === action.itemId ? { ...it, ...action.patch } : it),
        },
      }));

    case 'DELETE_ITEM':
      return mapStop(trip, action.stopId, (s) => ({
        ...s,
        recs: {
          ...s.recs,
          [action.bucket]: s.recs[action.bucket].filter((it) => it.id !== action.itemId),
        },
      }));

    // ---- Slot assignments (slots hold COPIES with their own ids) ----
    case 'ASSIGN_TO_SLOT': {
      const def = SLOT_BY_KEY[action.slotKey];
      if (!def) return trip;
      const copy = makeItem({
        ...action.item,
        addedBy: action.item.custom ? (action.item.addedBy || action.who || '') : '',
      }, { custom: !!action.item.custom });
      return mapStop(trip, action.stopId, (s) =>
        mapDay(s, action.date, (d) => {
          const slots = { ...d.slots };
          if (def.kind === 'multi') {
            slots[action.slotKey] = [...asSlotArray(slots[action.slotKey]), copy];
          } else {
            slots[action.slotKey] = copy;
          }
          return { ...d, slots };
        }));
    }

    case 'REMOVE_FROM_SLOT': {
      const def = SLOT_BY_KEY[action.slotKey];
      if (!def) return trip;
      return mapStop(trip, action.stopId, (s) =>
        mapDay(s, action.date, (d) => {
          const slots = { ...d.slots };
          if (def.kind === 'multi') {
            slots[action.slotKey] = asSlotArray(slots[action.slotKey]).filter((it) => it.id !== action.itemId);
          } else {
            slots[action.slotKey] = null;
          }
          return { ...d, slots };
        }));
    }

    case 'UPDATE_SLOT_ITEM': {
      const def = SLOT_BY_KEY[action.slotKey];
      if (!def) return trip;
      return mapStop(trip, action.stopId, (s) =>
        mapDay(s, action.date, (d) => {
          const slots = { ...d.slots };
          if (def.kind === 'multi') {
            slots[action.slotKey] = asSlotArray(slots[action.slotKey]).map((it) =>
              it.id === action.itemId ? { ...it, ...action.patch } : it);
          } else if (slots[action.slotKey] && slots[action.slotKey].id === action.itemId) {
            slots[action.slotKey] = { ...slots[action.slotKey], ...action.patch };
          }
          return { ...d, slots };
        }));
    }

    case 'MOVE_SLOT_ITEM': {
      const fromDef = SLOT_BY_KEY[action.fromSlotKey];
      const toDef = SLOT_BY_KEY[action.toSlotKey];
      if (!fromDef || !toDef || fromDef.kind !== 'multi' || toDef.kind !== 'multi') return trip;
      const patch = action.patch || {};
      return mapStop(trip, action.stopId, (s) =>
        mapDay(s, action.date, (d) => {
          const slots = { ...d.slots };
          if (action.fromSlotKey === action.toSlotKey) {
            slots[action.fromSlotKey] = asSlotArray(slots[action.fromSlotKey]).map((it) =>
              it.id === action.itemId ? { ...it, ...patch } : it);
            return { ...d, slots };
          }
          const fromItems = [...asSlotArray(slots[action.fromSlotKey])];
          const idx = fromItems.findIndex((it) => it.id === action.itemId);
          if (idx < 0) return d;
          const [item] = fromItems.splice(idx, 1);
          const toItems = [...asSlotArray(slots[action.toSlotKey])].filter((it) => it.id !== action.itemId);
          toItems.push({ ...item, ...patch });
          slots[action.fromSlotKey] = fromItems;
          slots[action.toSlotKey] = toItems;
          return { ...d, slots };
        }));
    }

    // Drag-reorder within a multi slot: move itemId to just before beforeId
    // (or to the end when beforeId is null).
    case 'REORDER_SLOT': {
      const def = SLOT_BY_KEY[action.slotKey];
      if (!def || def.kind !== 'multi') return trip;
      return mapStop(trip, action.stopId, (s) =>
        mapDay(s, action.date, (d) => {
          const arr = [...asSlotArray(d.slots[action.slotKey])];
          const from = arr.findIndex((it) => it.id === action.itemId);
          if (from < 0) return d;
          const [moved] = arr.splice(from, 1);
          let to = action.beforeId == null ? arr.length : arr.findIndex((it) => it.id === action.beforeId);
          if (to < 0) to = arr.length;
          arr.splice(to, 0, moved);
          return { ...d, slots: { ...d.slots, [action.slotKey]: arr } };
        }));
    }

    // Replace morning/afternoon/evening after geographic route optimization.
    case 'OPTIMIZE_DAY_ROUTE':
      return mapStop(trip, action.stopId, (s) =>
        mapDay(s, action.date, (d) => ({
          ...d,
          slots: { ...d.slots, ...action.slots },
        })));

    // ---- Filters & nudges ----
    case 'SET_FILTER':
      return {
        ...trip,
        filterPrefs: {
          ...trip.filterPrefs,
          ...action.patch,
          weights: { ...trip.filterPrefs.weights, ...(action.patch.weights || {}) },
        },
      };

    case 'DISMISS_NUDGE':
      return { ...trip, dismissedNudges: { ...trip.dismissedNudges, [action.nudgeId]: true } };

    default:
      return trip;
  }
}

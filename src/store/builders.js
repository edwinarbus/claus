// Pure factory helpers for building trip/stop/day/item objects.
import { uid } from '../lib/ids.js';
import { addDays, eachDate, nightsBetween } from '../lib/dates.js';
import { CITIES, DEFAULT_ROUTE, CATALOG_ITEM_INDEX } from '../data/catalog.js';
import { patchKnownLodgingItem } from '../data/knownPlaces.js';
import { emptySlots } from '../data/slots.js';
import { IDEAL_PLANS } from '../data/idealPlans.js';

const REC_BUCKETS = ['see', 'do', 'eat', 'lodging'];

function itemFromRecs(recs, sourceId) {
  if (!sourceId || !recs) return null;
  for (const b of REC_BUCKETS) {
    const src = (recs[b] || []).find((it) => it.sourceId === sourceId || it.id === sourceId);
    if (src) return makeItem(src);
  }
  return null;
}

// Light meals that belong at breakfast (kept off the lunch/dinner rotation).
const BREAKFAST_HINT = /pastry|fika|coffee|bun|korvapuusti|wienerbr|cinnamon|bakery|breakfast/i;
// Heftier eats we'd rather steer toward dinner.
const DINNER_HINT = /dinner|dining|destination|fine|seafood|nordic|fjordside|smoked/i;

const MORNING_TARGET = 1;   // a marquee sight to open the day
const AFTERNOON_TARGET = 2;  // pack the afternoon
const EVENING_TARGET = 1;   // one evening highlight

function rankedSights(recs) {
  return [...(recs.see || []), ...(recs.do || [])]
    .map((it, i) => ({ it, i, tier: it.tier || 3 }))
    .sort((a, b) => (a.tier - b.tier) || (a.i - b.i))
    .map((x) => x.it);
}

function rankedMeals(recs) {
  return [...(recs.eat || [])]
    .map((it, i) => ({ it, i, tier: it.tier || 3 }))
    .sort((a, b) => (a.tier - b.tier) || (a.i - b.i))
    .map((x) => x.it);
}

function srcId(it) { return it.sourceId || it.id; }

// Split the eat list into a breakfast pick + rotating lunch/dinner pools so each
// day can get a different meal without repeating yesterday's.
function mealPlan(recs) {
  const meals = rankedMeals(recs);
  const breakfast = meals.find((m) => BREAKFAST_HINT.test(m.name)) || null;
  const bId = breakfast ? srcId(breakfast) : null;
  const rest = meals.filter((m) => srcId(m) !== bId);
  let dinners = rest.filter((m) => DINNER_HINT.test(m.name));
  if (!dinners.length) dinners = rest.slice();
  let lunches = rest.filter((m) => !DINNER_HINT.test(m.name));
  if (!lunches.length) lunches = rest.slice();
  return { breakfast, lunches, dinners };
}

// Pull the next sight from the pool. mode 'heat' grabs a heat-sensitive sight
// (best done in the cool morning), 'cool' avoids them (for the hot afternoon).
function popSight(pool, mode) {
  if (!pool.length) return null;
  if (mode === 'heat') {
    const i = pool.findIndex((s) => s.heatSensitive);
    if (i >= 0) return pool.splice(i, 1)[0];
  } else if (mode === 'cool') {
    const i = pool.findIndex((s) => !s.heatSensitive);
    if (i >= 0) return pool.splice(i, 1)[0];
  }
  return pool.shift();
}

function curatedDaySlots(plan, recs) {
  const slots = emptySlots();
  if (plan.breakfast) { const it = itemFromRecs(recs, plan.breakfast); if (it) slots.breakfast.push(it); }
  if (plan.lunch) { const it = itemFromRecs(recs, plan.lunch); if (it) slots.lunch.push(it); }
  if (plan.dinner) { const it = itemFromRecs(recs, plan.dinner); if (it) slots.dinner.push(it); }
  ['morning', 'afternoon', 'evening'].forEach((k) => {
    (plan[k] || []).forEach((id) => { const it = itemFromRecs(recs, id); if (it) slots[k].push(it); });
  });
  return slots;
}

// Top a day's slots up to the opinionated targets, consuming from the shared
// sight pool. Heat-sensitive sights land in the morning, the rest pack the
// afternoon/evening. Meals are filled (breakfast only on day 0 — assume a quick
// hotel breakfast otherwise). Empty days (pool exhausted) stay open.
function fillDay(slots, pool, meals, dayIndex) {
  while (slots.morning.length < MORNING_TARGET) { const it = popSight(pool, 'heat'); if (!it) break; slots.morning.push(makeItem(it)); }
  while (slots.afternoon.length < AFTERNOON_TARGET) { const it = popSight(pool, 'cool'); if (!it) break; slots.afternoon.push(makeItem(it)); }
  while (slots.evening.length < EVENING_TARGET) { const it = popSight(pool, 'any'); if (!it) break; slots.evening.push(makeItem(it)); }

  const sightCount = slots.morning.length + slots.afternoon.length + slots.evening.length;
  if (sightCount === 0) return slots; // nothing to do here — leave the day open
  if (dayIndex === 0 && meals.breakfast && !slots.breakfast.length) slots.breakfast.push(makeItem(meals.breakfast));
  if (!slots.lunch.length && meals.lunches.length) slots.lunch.push(makeItem(meals.lunches[dayIndex % meals.lunches.length]));
  if (!slots.dinner.length && meals.dinners.length) slots.dinner.push(makeItem(meals.dinners[dayIndex % meals.dinners.length]));
  return slots;
}

// Build opinionated slot plans for `numDays` consecutive days of a city, drawing
// from its catalog recs. Day 0 starts from the hand-curated plan (if any) then
// gets topped up; later days distribute the remaining ranked sights so every day
// has a real schedule. `placedSightIds` are sights already on the stop elsewhere
// (so we never double-book a sight). `skip` is a set of day indices to leave
// untouched (already-filled days) — those return null and don't consume sights,
// but still advance the day index so meals/curated land on the right days.
// Returns an array of length numDays (null at skipped indices).
export function buildIdealDays(cityId, recs, numDays, placedSightIds = new Set(), skip = new Set()) {
  const out = [];
  if (numDays <= 0 || !recs) return out;
  const plan = IDEAL_PLANS[cityId] || null;
  const curatedIds = new Set();
  if (plan) ['morning', 'afternoon', 'evening'].forEach((k) => (plan[k] || []).forEach((id) => curatedIds.add(id)));

  const pool = rankedSights(recs)
    .filter((s) => !placedSightIds.has(srcId(s)) && !curatedIds.has(srcId(s)));
  const meals = mealPlan(recs);

  for (let d = 0; d < numDays; d++) {
    if (skip.has(d)) { out.push(null); continue; }
    const slots = (d === 0 && plan) ? curatedDaySlots(plan, recs) : emptySlots();
    fillDay(slots, pool, meals, d);
    out.push(slots);
  }
  return out;
}

function collectPlannedSightIds(days) {
  const ids = new Set();
  (days || []).forEach((d) => {
    const s = d.slots || {};
    ['morning', 'afternoon', 'evening'].forEach((k) => (s[k] || []).forEach((it) => { if (it && it.sourceId) ids.add(it.sourceId); }));
  });
  return ids;
}

// Build days for a catalog stop. Existing day content is preserved BY POSITION
// within the stop (day 1 stays day 1 — we just re-stamp the calendar date), so
// reordering stops or sliding the trip start never disturbs a planned itinerary.
// Only brand-new trailing days (when a stop is lengthened) get an opinionated
// plan; shortening a stop drops the extra trailing days.
export function buildDaysForCity(cityId, startISO, endISO, prevDays = []) {
  const nights = nightsBetween(startISO, endISO);
  const lastNight = nights > 0 ? addDays(endISO, -1) : startISO;
  const dates = nights > 0 ? eachDate(startISO, lastNight) : [];
  const prev = prevDays || [];
  // Re-stamp dates onto existing days by index; mint fresh days past the end.
  const kept = dates.map((date, i) => (prev[i]
    ? { ...prev[i], date, index: i }
    : { id: uid('day'), date, index: i, slots: emptySlots() }));

  const city = cityId ? CITIES[cityId] : null;
  const recs = city ? recsFromCity(city) : null;
  const firstNew = Math.min(prev.length, dates.length);
  // No catalog recs, or no genuinely-new days → nothing to pre-populate.
  if (!cityId || !recs || firstNew >= dates.length) return kept;

  const placed = collectPlannedSightIds(kept.slice(0, firstNew));
  const skip = new Set(kept.map((d, i) => (i < firstNew ? i : -1)).filter((i) => i >= 0));
  const plans = buildIdealDays(cityId, recs, dates.length, placed, skip);
  return kept.map((d, i) => (i < firstNew ? d : { ...d, slots: plans[i] || emptySlots() }));
}

// Demo: bumped to v3 so an already-seeded browser (older date, no hotels)
// re-seeds fresh — the fixed Jul 2 - Jul 11 route + the real booked hotels.
export const STORAGE_KEY = 'claus-demo:v3';
export const SCHEMA_VERSION = 15;

// Turn a catalog item (or any item-shaped object) into a fresh placeable instance.
export function makeItem(src, { custom = false } = {}) {
  return {
    id: uid('it'),
    sourceId: src.sourceId || src.id || null,
    name: src.name || 'Untitled',
    type: src.type || 'see',
    emoji: src.emoji || '',
    // Explicit coordinates + address (e.g. a hotel picked from search) so the day
    // map pins it exactly instead of re-geocoding the name. Omitted when absent.
    ...(typeof src.lat === 'number' && typeof src.lng === 'number' ? { lat: src.lat, lng: src.lng } : {}),
    ...(src.address ? { address: src.address } : {}),
    // "Where to get it" for a delicacy: the dish keeps its name, but carries a
    // specific restaurant (+ address) so the day plan shows where to find it.
    ...(src.venue ? { venue: src.venue } : {}),
    ...(src.venueAddress ? { venueAddress: src.venueAddress } : {}),
    // Dining items can be pinned to a specific restaurant; preserve that across
    // copies (drag = remove + re-assign) so the rename + map pin survive a move.
    pinByName: !!src.pinByName,
    origName: src.origName || '',
    origWiki: src.origWiki || '',
    blurb: src.blurb || '',
    why: src.why || '',
    tags: Array.isArray(src.tags) ? [...src.tags] : [],
    heatSensitive: !!src.heatSensitive,
    heatReason: src.heatReason || '',
    wikiTravelSection: src.wikiTravelSection || '',
    tier: src.tier || 3,
    durationMin: src.durationMin || null,
    closedDays: Array.isArray(src.closedDays) ? [...src.closedDays] : [],
    wiki: src.wiki || '',
    imageUrl: src.imageUrl || '',
    sourceUrl: src.sourceUrl || '',
    places: Array.isArray(src.places) ? src.places.map((p) => ({ ...p })) : [],
    notes: src.notes || '',
    links: Array.isArray(src.links) ? src.links.map((l) => ({ ...l })) : [],
    ...(src.type === 'travel' ? {
      ...(src.mode ? { mode: src.mode } : {}),
      ...(src.depStation ? { depStation: src.depStation } : {}),
      ...(src.depTime ? { depTime: src.depTime } : {}),
      ...(src.depDate ? { depDate: src.depDate } : {}),
      ...(src.arrStation ? { arrStation: src.arrStation } : {}),
      ...(src.arrTime ? { arrTime: src.arrTime } : {}),
      ...(src.arrDate ? { arrDate: src.arrDate } : {}),
      ...(src.bookingRef ? { bookingRef: src.bookingRef } : {}),
      ...(Array.isArray(src.tickets) && src.tickets.length ? { tickets: src.tickets.map((t) => ({ ...t })) } : {}),
    } : {}),
    ...(src.type !== 'travel' && (src.depTime || src.arrTime) ? {
      ...(src.depTime ? { depTime: src.depTime } : {}),
      ...(src.arrTime ? { arrTime: src.arrTime } : {}),
    } : {}),
    custom,
    addedBy: src.addedBy || '',
  };
}

// Build the day list for a stop: one Day per night (start .. end-1 inclusive).
export function buildDays(startISO, endISO, prevDays = []) {
  const nights = nightsBetween(startISO, endISO);
  const lastNight = nights > 0 ? addDays(endISO, -1) : startISO;
  const dates = nights > 0 ? eachDate(startISO, lastNight) : [];
  const byDate = {};
  prevDays.forEach((d) => { byDate[d.date] = d; });
  return dates.map((date, index) => {
    if (byDate[date]) return { ...byDate[date], index };
    return { id: uid('day'), date, index, slots: emptySlots() };
  });
}

export function recsFromCity(city) {
  const recs = { see: [], do: [], eat: [], lodging: [] };
  (city.items || []).forEach((it) => {
    if (recs[it.type]) recs[it.type].push(makeItem(it));
  });
  return recs;
}

// Build a Stop from a catalog city id.
export function makeStopFromCity(cityId, startISO, endISO, transportToNext = null) {
  const city = CITIES[cityId];
  if (!city) return null;
  return {
    id: uid('stop'),
    cityId,
    name: city.name,
    country: city.country,
    lat: city.lat,
    lng: city.lng,
    blurb: city.blurb,
    tier: city.tier || 2,
    guideUrl: city.guideUrl || null,
    infatuationUrl: city.infatuationUrl || null,
    delicacies: city.delicacies || null,
    startDate: startISO,
    endDate: endISO,
    transportToNext: transportToNext ? { ...transportToNext } : null,
    recs: recsFromCity(city),
    days: buildDaysForCity(cityId, startISO, endISO),
  };
}

// Build a fully custom Stop.
export function makeCustomStop({ name, country = '', lat = 60, lng = 12, blurb = '' }, startISO, endISO) {
  return {
    id: uid('stop'),
    cityId: null,
    name: name || 'New stop',
    country,
    lat,
    lng,
    blurb,
    tier: 3,
    guideUrl: null,
    startDate: startISO,
    endDate: endISO,
    transportToNext: null,
    recs: { see: [], do: [], eat: [], lodging: [] },
    days: buildDays(startISO, endISO),
  };
}

export function initialTrip() {
  return {
    id: uid('trip'),
    name: 'Claus',
    version: SCHEMA_VERSION,
    startDate: '2026-07-02',
    endDate: '2026-07-11',
    stops: [],
    arrival: { mode: 'flight', from: 'YYZ (Toronto)', note: '' },
    departure: { mode: 'flight', to: 'SFO (San Francisco)', note: '' },
    filterPrefs: {
      weights: { food: 3, nature: 3, culture: 2, landmark: 2 },
      avoidHeatPM: true,
    },
    dismissedNudges: {},
  };
}

// Backfill enriched catalog fields (tier, durationMin, images, sources, places)
// onto an existing saved trip whose items predate the richer schema. Only fills
// fields that are missing/empty so user edits are never clobbered. Also ensures
// each catalog stop carries a tier. Returns a new trip object.
// Merge curated catalog `places` (which carry Michelin/Bib/price/cuisine) onto a
// saved item's places. Catalog is the source of truth for curated entries; any
// user-added place not in the catalog is preserved at the end. Idempotent.
function mergePlaces(itPlaces, catPlaces) {
  const cat = Array.isArray(catPlaces) ? catPlaces : [];
  const it = Array.isArray(itPlaces) ? itPlaces : [];
  if (!cat.length) return it.map((p) => ({ ...p }));
  const catNames = new Set(cat.map((p) => (p.name || '').toLowerCase()));
  const merged = cat.map((p) => ({ ...p }));
  it.forEach((p) => { if (!catNames.has((p.name || '').toLowerCase())) merged.push({ ...p }); });
  return merged;
}

export function enrichFromCatalog(trip, { addNew = false } = {}) {
  if (!trip || !Array.isArray(trip.stops)) return trip;
  const enrichItem = (it) => {
    const cat = it && it.sourceId ? CATALOG_ITEM_INDEX[it.sourceId] : null;
    const merged = {
      tier: it.tier || (cat && cat.tier) || 3,
      durationMin: it.durationMin || (cat && cat.durationMin) || null,
      // Opening-day facts are guide-authored (not user-editable), so always
      // take the latest catalog value for catalog items — corrections propagate.
      closedDays: cat ? (Array.isArray(cat.closedDays) ? [...cat.closedDays] : []) : (Array.isArray(it.closedDays) ? [...it.closedDays] : []),
      wiki: it.wiki || (cat && cat.wiki) || '',
      imageUrl: it.imageUrl || (cat && cat.imageUrl) || '',
      sourceUrl: it.sourceUrl || (cat && cat.sourceUrl) || '',
      // Blurbs/why are guide-authored (not user-editable), so always take the
      // latest catalog copy for catalog items — that's how data corrections
      // (e.g. updated Michelin facts) reach existing saved trips.
      blurb: (cat && cat.blurb) || it.blurb || '',
      why: (cat && cat.why) || it.why || '',
      places: cat ? mergePlaces(it.places, cat.places) : (it.places || []).map((p) => ({ ...p })),
    };
    return { ...it, ...merged };
  };
  const stops = trip.stops.map((s) => {
    const city = s.cityId ? CITIES[s.cityId] : null;
    const prev = s.recs || { see: [], do: [], eat: [], lodging: [] };
    const enrich = (it) => {
      const base = enrichItem(it);
      const cat = it && it.sourceId ? CATALOG_ITEM_INDEX[it.sourceId] : null;
      return {
        ...base,
        heatReason: it.heatReason || (cat && cat.heatReason) || '',
        wikiTravelSection: it.wikiTravelSection || (cat && cat.wikiTravelSection) || '',
      };
    };
    const recs = {
      see: (prev.see || []).map(enrich),
      do: (prev.do || []).map(enrich),
      eat: (prev.eat || []).map(enrich),
      lodging: (prev.lodging || []).map(enrich),
    };
    // On a schema bump, fold in any newly-curated catalog items not yet present.
    if (addNew && city) {
      const have = new Set([...recs.see, ...recs.do, ...recs.eat, ...recs.lodging].map((i) => i.sourceId).filter(Boolean));
      (city.items || []).forEach((ci) => {
        if (!have.has(ci.id) && recs[ci.type]) recs[ci.type].push(makeItem(ci));
      });
    }
    // IMPORTANT: migration must never mutate the traveler's actual plan.
    // We deliberately leave `s.days` (day-by-day slot assignments, lodging,
    // dates) untouched — code/UI/catalog changes refresh only reference data
    // (the recommendation pool, blurbs, images, closed-day facts), never the
    // plan. Empty days are pre-populated only when a stop is created/changed
    // (see buildDaysForCity), not on a schema bump.
    const days = s.days;
    // Collapse is now per-device UI state (see store.js); drop any legacy
    // `collapsed` flag so it never round-trips through the synced trip JSON.
    const { collapsed, ...rest } = s;
    return {
      ...rest,
      tier: s.tier || (city && city.tier) || 2,
      // City descriptions are guide-authored. Refresh them from the catalog only
      // on a schema bump (addNew) so curated rewrites reach saved trips once,
      // without clobbering any description the user edited between versions.
      ...(addNew && city ? { blurb: city.blurb, delicacies: city.delicacies || null, guideUrl: city.guideUrl || s.guideUrl || null, infatuationUrl: city.infatuationUrl || s.infatuationUrl || null } : {}),
      recs,
      days,
    };
  });
  return { ...trip, stops };
}

// One-time (schema v13): rebuild the Norway tail from the old Oslo→Flåm→Bergen
// order into the scenic Norway-in-a-Nutshell order Helsinki→Bergen→Flåm→Oslo,
// IN PLACE — preserving each stop's nights, day-by-day plans, lodging and edits.
// Connections come from the (new) DEFAULT_ROUTE so they stay in sync, and Flåm
// is renamed Flåm/Aurland. Tightly guarded to the exact legacy adjacency so it
// never fires on a route that's already diverged (reordered, stop added/removed)
// — there it returns the trip untouched. Never touches a stop before Helsinki,
// so Copenhagen (and everything ahead of the Norway leg) is left exactly as-is.
export function migrateNorwayNiN(parsed) {
  if (!parsed || !Array.isArray(parsed.stops)) return parsed;
  const stops = parsed.stops;
  const iH = stops.findIndex((s) => s.cityId === 'helsinki');
  if (iH < 0) return parsed;
  const oslo = stops[iH + 1];
  const flam = stops[iH + 2];
  const bergen = stops[iH + 3];
  if (!oslo || !flam || !bergen) return parsed;
  if (oslo.cityId !== 'oslo' || flam.cityId !== 'flam' || bergen.cityId !== 'bergen') return parsed;
  if (iH + 3 !== stops.length - 1) return parsed; // bergen must currently be last

  const legByCity = {};
  DEFAULT_ROUTE.forEach((e) => { legByCity[e.city] = e.transportToNext; });
  const freshLeg = (cityId) => (legByCity[cityId] ? { ...legByCity[cityId] } : null);

  const helsinki = { ...stops[iH], transportToNext: freshLeg('helsinki') };
  // New back-to-back order after Helsinki: Bergen → Flåm → Oslo. Re-date from
  // Helsinki's checkout, keeping each stop's own night count; buildDaysForCity
  // re-stamps the existing day plans onto the new dates (slots preserved).
  let cursor = helsinki.endDate;
  const redated = [bergen, flam, oslo].map((s) => {
    const nights = Math.max(1, nightsBetween(s.startDate, s.endDate));
    const start = cursor;
    const end = addDays(start, nights);
    cursor = end;
    return {
      ...s,
      name: s.cityId === 'flam' ? CITIES.flam.name : s.name,
      startDate: start,
      endDate: end,
      days: buildDaysForCity(s.cityId, start, end, s.days),
      transportToNext: freshLeg(s.cityId), // null for Oslo (now the last stop)
    };
  });

  return { ...parsed, stops: [...stops.slice(0, iH), helsinki, ...redated] };
}

// v14: re-pin known hotels (e.g. Sommerro in Oslo) when a bad Nominatim match was saved.
export function migrateKnownLodging(parsed) {
  if (!parsed || !Array.isArray(parsed.stops)) return parsed;
  const stops = parsed.stops.map((s) => ({
    ...s,
    days: (s.days || []).map((d) => {
      const lodging = d.slots?.lodging;
      if (!lodging) return d;
      const patched = patchKnownLodgingItem(lodging, s.cityId);
      if (patched === lodging) return d;
      return { ...d, slots: { ...d.slots, lodging: patched } };
    }),
  }));
  return { ...parsed, stops };
}

// Build the full default Rick Steves–structured route starting at startISO.
export function buildDefaultRoute(startISO) {
  let cursor = startISO;
  const stops = DEFAULT_ROUTE.map((entry) => {
    const start = cursor;
    const end = addDays(start, entry.nights); // checkout day = next checkin day
    cursor = end;
    return makeStopFromCity(entry.city, start, end, entry.transportToNext);
  }).filter(Boolean);
  const endDate = stops.length ? stops[stops.length - 1].endDate : startISO;
  return { stops, endDate };
}

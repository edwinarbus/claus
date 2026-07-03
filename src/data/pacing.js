// Per-day "fullness" signal, time-based. We sum each activity's rough time
// estimate for *sightseeing slots only* — meals are optional and shouldn't
// trigger "room for more" nudges (breakfast at the hotel doesn't count).

const SPRY = 0.78;
const DEFAULT_MIN = { see: 75, do: 110, eat: 60, travel: 120 };
const CAP_HOURS = 8.5;
const FULL_DAY_TRAVEL_MIN = 360;
const ACTIVITY_SLOT_KEYS = ['morning', 'afternoon', 'evening'];

function clockMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minutesBetween(depTime, arrTime) {
  const dep = clockMinutes(depTime);
  let arr = clockMinutes(arrTime);
  if (dep == null || arr == null) return null;
  if (arr < dep) arr += 24 * 60;
  return arr - dep;
}

function itemMinutes(it) {
  if (!it) return 0;
  if (it.durationMin) return it.durationMin;
  return DEFAULT_MIN[it.type] || 90;
}

function sightMinutes(day) {
  const s = day.slots || {};
  let total = 0;
  ACTIVITY_SLOT_KEYS.forEach((k) => {
    (s[k] || []).forEach((it) => { total += itemMinutes(it); });
  });
  return Math.round(total * SPRY);
}

// Legacy alias — same as sight load now (meals excluded).
export function dayLoad(day) {
  return sightMinutes(day);
}

const LEVELS = {
  empty: { color: 'bg-slate-200', text: 'text-slate-400', label: 'Nothing planned', dot: 'bg-slate-300' },
  slow: { color: 'bg-sky-300', text: 'text-sky-600', label: 'Slow paced', dot: 'bg-sky-400' },
  moderate: { color: 'bg-fjord-400', text: 'text-fjord-600', label: 'Moderate', dot: 'bg-fjord-400' },
  packed: { color: 'bg-emerald-500', text: 'text-emerald-600', label: 'Packed', dot: 'bg-emerald-500' },
  overstuffed: { color: 'bg-amber-400', text: 'text-amber-600', label: 'Overstuffed', dot: 'bg-amber-500' },
};

function hasMealsOrLodging(day) {
  const s = day.slots || {};
  // Meal slots are arrays now (empty array = nothing booked); lodging is single.
  const mealCount = (k) => (Array.isArray(s[k]) ? s[k].length : (s[k] ? 1 : 0));
  return !!(mealCount('breakfast') || mealCount('lunch') || mealCount('dinner') || s.lodging);
}

function sightCount(day) {
  const s = day.slots || {};
  return ACTIVITY_SLOT_KEYS.reduce((n, k) => n + (s[k] || []).length, 0);
}

function travelItems(day) {
  const s = day?.slots || {};
  return ACTIVITY_SLOT_KEYS.flatMap((k) => s[k] || []).filter((it) => it?.type === 'travel');
}

function isFullDayTravelItem(it) {
  if (!it || it.type !== 'travel') return false;
  const timedMin = minutesBetween(it.depTime, it.arrTime);
  return (timedMin != null && timedMin >= FULL_DAY_TRAVEL_MIN)
    || (it.durationMin != null && it.durationMin >= FULL_DAY_TRAVEL_MIN);
}

// A long travel block already tells the traveler why the day is heavy. Keep the
// pacing math honest, but suppress separate "overstuffed" nags for those days.
export function hasFullDayTravel(day, extraMin = 0, coveredSlots = []) {
  return extraMin >= FULL_DAY_TRAVEL_MIN
    || (Array.isArray(coveredSlots) && coveredSlots.length >= ACTIVITY_SLOT_KEYS.length)
    || travelItems(day).some(isFullDayTravelItem);
}

export function dayFullness(day, extraMin = 0) {
  const load = sightMinutes(day) + Math.max(0, extraMin);
  const hours = load / 60;
  let level = 'empty';
  if (load <= 0) level = 'empty';
  else if (hours < 3) level = 'slow';
  else if (hours < 5) level = 'moderate';
  else if (hours < 8.5) level = 'packed';
  else level = 'overstuffed';
  // Only nudge when truly blank, or a very light sightseeing day (meals alone don't count).
  const under = (level === 'empty' && !hasMealsOrLodging(day))
    || (level === 'slow' && sightCount(day) <= 1 && hours < 2);
  return { load, hours, level, under, ...LEVELS[level], fillPct: Math.min(100, (hours / CAP_HOURS) * 100) };
}

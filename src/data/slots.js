// Definitions for the per-day slots. `kind: 'multi'` slots hold an array of
// items; `kind: 'single'` slots hold one item or null.

// Slot glyphs are rendered from the key via src/components/slotIcons.js (custom
// icons, not emoji), so the defs carry no `icon` field.
export const DAY_SLOTS = [
  { key: 'morning', label: 'Morning', group: 'day', kind: 'multi', accepts: ['see', 'do', 'eat', 'travel'] },
  { key: 'afternoon', label: 'Afternoon', group: 'day', kind: 'multi', accepts: ['see', 'do', 'eat', 'travel'] },
  { key: 'evening', label: 'Evening', group: 'day', kind: 'multi', accepts: ['see', 'do', 'eat', 'travel'] },
];

// Coarse day-plan windows. We only expose Morning / Afternoon / Evening in the
// schedule, so parsed ticket times snap into one of these buckets.
export const DAY_SLOT_WINDOWS = [
  { key: 'morning', start: 5 * 60, end: 12 * 60 },
  { key: 'afternoon', start: 12 * 60, end: 17 * 60 },
  { key: 'evening', start: 17 * 60, end: 24 * 60 },
];

export function clockToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function daySlotForClock(hhmm) {
  const min = clockToMinutes(hhmm);
  if (min == null) return null;
  if (min < 12 * 60) return 'morning';
  if (min < 17 * 60) return 'afternoon';
  return 'evening';
}

const MIN_SLOT_OVERLAP = 30; // ignore slots a leg only clips by a few minutes

export function coveredDaySlots(depTime, arrTime) {
  const dep = clockToMinutes(depTime);
  let arr = clockToMinutes(arrTime);
  if (dep == null || arr == null) return ['morning'];
  if (arr <= dep) arr = dep + 1; // overnight gets handled elsewhere; keep this daytime-safe
  const hit = DAY_SLOT_WINDOWS.filter((w) => {
    const overlap = Math.min(arr, w.end) - Math.max(dep, w.start);
    return overlap >= Math.min(MIN_SLOT_OVERLAP, w.end - w.start);
  }).map((w) => w.key);
  return hit.length ? hit : ['morning'];
}

export const MEAL_SLOTS = [
  { key: 'breakfast', label: 'Breakfast', group: 'meal', kind: 'multi', accepts: ['eat'] },
  { key: 'lunch', label: 'Lunch', group: 'meal', kind: 'multi', accepts: ['eat'] },
  { key: 'dinner', label: 'Dinner', group: 'meal', kind: 'multi', accepts: ['eat'] },
];

export const LODGING_SLOT = { key: 'lodging', label: 'Lodging', group: 'lodging', kind: 'single', accepts: ['lodging'] };

export const ALL_SLOTS = [...DAY_SLOTS, ...MEAL_SLOTS, LODGING_SLOT];

export const SLOT_BY_KEY = ALL_SLOTS.reduce((acc, s) => {
  acc[s.key] = s;
  return acc;
}, {});

export function emptySlots() {
  return {
    morning: [], afternoon: [], evening: [],
    breakfast: [], lunch: [], dinner: [],
    lodging: null,
  };
}

// Meal slots became multi (an array of bookings) — older saved trips stored a
// single object or null. Coerce either shape to an array so reads never choke
// on legacy data. Lodging stays single, so it is left untouched.
export function asSlotArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

// Bucket metadata for the recommendation panel.
export const BUCKETS = [
  { key: 'see', type: 'see', label: 'Must-sees', hint: 'Sights worth your time' },
  { key: 'do', type: 'do', label: 'Must-dos', hint: 'Experiences to have' },
  { key: 'eat', type: 'eat', label: 'Must-eats', hint: 'Local delicacies, emphasized' },
];

export const TAG_META = {
  food: { label: 'food', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  nature: { label: 'nature', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  culture: { label: 'culture', color: 'bg-violet-100 text-violet-800 border-violet-200' },
  landmark: { label: 'landmark', color: 'bg-sky-100 text-sky-800 border-sky-200' },
};

// Weekly closures for sights/museums.
//
// `closedDays` on an item is an array of JS weekday indices (0 = Sunday …
// 6 = Saturday) on which the place is closed. Kept deliberately conservative
// and SUMMER-ACCURATE: we only tag verified weekly closures that actually
// apply during the July travel season — many Nordic museums close on Mondays
// in winter but open daily in summer, so those are intentionally NOT tagged.
import { parseISO } from '../lib/dates.js';
import { CATALOG_ITEM_INDEX } from './catalog.js';

const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Plural form, e.g. "Mondays" — for "closed on Mondays" phrasing.
const WD_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

export function closedDaysOf(item) {
  if (!item) return [];
  let c = item.closedDays;
  // Fall back to the catalog for items placed in slots before this field
  // existed (enrichment only refreshes the rec lists, not placed items).
  if ((!Array.isArray(c) || c.length === 0) && item.sourceId && CATALOG_ITEM_INDEX[item.sourceId]) {
    c = CATALOG_ITEM_INDEX[item.sourceId].closedDays;
  }
  if (!Array.isArray(c)) return [];
  return c.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort((a, b) => a - b);
}

export function hasClosedDays(item) {
  return closedDaysOf(item).length > 0;
}

// Join an array of day names with commas + an ampersand: "Mon", "Mon & Tue",
// "Mon, Tue & Wed".
function joinDays(names) {
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

// "Mon" / "Mon & Tue" (short) — for compact chips.
export function closedLabel(item) {
  return joinDays(closedDaysOf(item).map((n) => WD_SHORT[n]));
}

// "Mondays" / "Mondays & Tuesdays" — for sentence phrasing.
export function closedLabelLong(item) {
  return joinDays(closedDaysOf(item).map((n) => WD_PLURAL[n]));
}

export function weekdayOf(dateISO) {
  const d = parseISO(dateISO);
  return d ? d.getDay() : null;
}

export function weekdayLong(dateISO) {
  const wd = weekdayOf(dateISO);
  return wd == null ? '' : WD_LONG[wd];
}

// Is this item closed on the given date (by weekday)?
export function isClosedOn(item, dateISO) {
  const wd = weekdayOf(dateISO);
  if (wd == null) return false;
  return closedDaysOf(item).includes(wd);
}

const MULTI_KEYS = ['morning', 'afternoon', 'evening'];
const SINGLE_KEYS = ['breakfast', 'lunch', 'dinner', 'lodging'];

// All planned items in a day that are closed on that day's weekday.
// Returns [{ item, slotKey }].
export function dayClosedConflicts(day) {
  if (!day || !day.slots) return [];
  const wd = weekdayOf(day.date);
  if (wd == null) return [];
  const out = [];
  const hit = (it, slotKey) => { if (it && closedDaysOf(it).includes(wd)) out.push({ item: it, slotKey }); };
  MULTI_KEYS.forEach((k) => (day.slots[k] || []).forEach((it) => hit(it, k)));
  SINGLE_KEYS.forEach((k) => hit(day.slots[k], k));
  return out;
}

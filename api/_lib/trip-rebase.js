// Evergreen demo timeline. The shared demo trip row in Supabase carries fixed
// calendar dates, so once its end date passes, the Overnight Concierge would be
// briefing a finished trip (no "tomorrow" to prepare). These helpers detect
// that and slide EVERY date in the trip forward by the same whole-day delta so
// the route starts today — same cities, same nights, same slot plans, just
// re-anchored to the present. This mirrors the browser seed (src/store/store.js
// seeds the local trip starting today).

const { SUPABASE_URL, SUPABASE_ANON_KEY, TRIP_ID } = require('./config.js');

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
// Every key that holds a calendar date anywhere in the trip JSON: trip/stop
// bounds, per-day dates, and travel-leg departure/arrival dates.
const DATE_KEYS = new Set(['startDate', 'endDate', 'date', 'depDate', 'arrDate']);

function shiftISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  // Noon UTC dodges any DST/rollover edge when sliding across month bounds.
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

function daysBetweenISO(aISO, bISO) {
  const utc = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(bISO) - utc(aISO)) / 86400000);
}

function shiftDatesDeep(node, days) {
  if (Array.isArray(node)) return node.map((v) => shiftDatesDeep(v, days));
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = (DATE_KEYS.has(k) && typeof v === 'string' && ISO_DAY.test(v))
      ? shiftISO(v, days)
      : shiftDatesDeep(v, days);
  }
  return out;
}

// The trip slid forward to start today, or null when no rebase is needed
// (trip missing/unparseable, still running, or upcoming).
function rebaseTripToToday(trip, todayISO) {
  if (!trip || !ISO_DAY.test(trip.startDate || '') || !ISO_DAY.test(trip.endDate || '')) return null;
  if (daysBetweenISO(trip.endDate, todayISO) <= 0) return null; // not over yet
  const shift = daysBetweenISO(trip.startDate, todayISO);
  if (shift <= 0) return null;
  return shiftDatesDeep(trip, shift);
}

// Persist the rebased trip back to the shared row — the same upsert shape the
// app's own sync uses, so nothing else about the row changes.
async function saveTrip(trip) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/trips?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ id: TRIP_ID, data: trip, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`trip save failed: ${r.status}`);
}

module.exports = { rebaseTripToToday, saveTrip };

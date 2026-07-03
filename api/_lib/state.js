// Tiny shared state for the trip's server jobs — the morning brief's
// sent-marker and the disruption watch's bookkeeping. Stored as one sentinel
// row in the existing push_subscriptions table (endpoint is a non-URL marker)
// so no new Supabase table or SQL setup is needed.
//
// Every push-sending loop must skip rows that aren't real device
// subscriptions — use isPushRow() for that.

const { SUPABASE_URL, SUPABASE_ANON_KEY, TRIP_ID } = require('./config.js');

const TABLE_URL = `${SUPABASE_URL}/rest/v1/push_subscriptions`;
const HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};
const STATE_ENDPOINT = `internal:trip-state:${TRIP_ID}`;

// A sendable device subscription; the sentinel state row and malformed rows
// fail this check.
function isPushRow(row) {
  const d = row && row.data;
  return !!(d && d.endpoint && d.keys && d.keys.p256dh && d.keys.auth);
}

async function loadTripState() {
  try {
    const r = await fetch(
      `${TABLE_URL}?endpoint=eq.${encodeURIComponent(STATE_ENDPOINT)}&select=data`,
      { headers: HEADERS },
    );
    const rows = r.ok ? await r.json() : [];
    return (rows[0] && rows[0].data && rows[0].data.state) || {};
  } catch {
    return {};
  }
}

async function saveTripState(state) {
  try {
    const row = {
      endpoint: STATE_ENDPOINT,
      trip_id: TRIP_ID,
      data: { state },
      who: '__state__',
      updated_at: new Date().toISOString(),
    };
    await fetch(`${TABLE_URL}?on_conflict=endpoint`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
  } catch { /* best effort — state loss only means a re-check or duplicate */ }
}

module.exports = { loadTripState, saveTripState, isPushRow };

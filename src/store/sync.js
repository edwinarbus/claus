// Shared-trip sync layer (Supabase). Loaded lazily so the app still works with
// zero config (local-only mode). All functions are no-ops until config.js holds
// a Supabase URL + anon key.
import { SUPABASE_URL, SUPABASE_ANON_KEY, TRIP_ID, syncEnabled } from '../config.js';
import { actorOrDefault } from '../lib/actors.js';

const SUPABASE_ESM = 'https://esm.sh/@supabase/supabase-js@2.45.4';
const SNAPSHOT_LIMIT = 50;
const LOCAL_SNAPSHOT_KEY = 'claus-demo:snapshots:v1';

let clientPromise = null;

async function getClient() {
  if (!syncEnabled()) return null;
  if (!clientPromise) {
    clientPromise = import(SUPABASE_ESM)
      .then(({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          realtime: { params: { eventsPerSecond: 3 } },
          auth: { persistSession: false },
        }))
      .catch((e) => {
        console.warn('Claus: Supabase failed to load — staying local.', e);
        return null;
      });
  }
  return clientPromise;
}

function stopsCount(trip) {
  return (trip && trip.stops && trip.stops.length) || 0;
}

function loadLocalSnapshots() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SNAPSHOT_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveLocalSnapshots(list) {
  try {
    localStorage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify(list.slice(0, 15)));
  } catch { /* ignore */ }
}

function saveLocalSnapshot(trip, label = '') {
  const entry = {
    id: `local_${Date.now()}`,
    trip_id: TRIP_ID,
    data: trip,
    created_at: new Date().toISOString(),
    saved_by: actorOrDefault(trip.meta?.updatedBy),
    stops_count: stopsCount(trip),
    label,
    local: true,
  };
  const list = loadLocalSnapshots();
  list.unshift(entry);
  saveLocalSnapshots(list);
  return entry.id;
}

// Read the shared trip (or null if none stored yet / sync off).
export async function fetchRemoteTrip() {
  const row = await fetchRemoteTripRow();
  return row ? row.data : null;
}

// Trip JSON plus the row's `updated_at` (authoritative server edit time).
export async function fetchRemoteTripRow() {
  const c = await getClient();
  if (!c) return null;
  try {
    const { data, error } = await c.from('trips')
      .select('data, updated_at')
      .eq('id', TRIP_ID)
      .maybeSingle();
    if (error) { console.warn('Claus: remote fetch error', error.message); return null; }
    return data || null;
  } catch (e) {
    console.warn('Claus: remote fetch threw', e);
    return null;
  }
}

// Kick off the Supabase client + first trip fetch as early as possible (main.js
// calls this before React mounts). Reuses the same promise for the store's
// initial sync so cold opens don't wait twice.
let remoteRowPrefetch = null;
export function prefetchRemoteTripRow() {
  if (!syncEnabled()) return Promise.resolve(null);
  if (!remoteRowPrefetch) {
    remoteRowPrefetch = fetchRemoteTripRow();
  }
  return remoteRowPrefetch;
}

// Upsert the shared trip. The entire itinerary lives in `data`: stops (with recs,
// days, slot assignments, lodging), transport legs, arrival/departure, filters,
// and dismissed nudges. Nothing itinerary-related is stripped before push.
export async function pushRemoteTrip(trip) {
  const c = await getClient();
  if (!c) return false;
  try {
    const { error } = await c.from('trips').upsert({
      id: TRIP_ID,
      data: trip,
      updated_at: new Date().toISOString(),
    });
    if (error) { console.warn('Claus: remote push error', error.message); return false; }
    return true;
  } catch (e) {
    console.warn('Claus: remote push threw', e);
    return false;
  }
}

// Best-effort save when the tab closes (keepalive fetch).
export function flushRemoteTrip(trip) {
  if (!syncEnabled() || !trip) return;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/trips`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: TRIP_ID,
        data: trip,
        updated_at: new Date().toISOString(),
      }),
      keepalive: true,
    });
  } catch { /* ignore */ }
}

async function pruneSnapshots(c) {
  const { data } = await c.from('trip_snapshots')
    .select('id')
    .eq('trip_id', TRIP_ID)
    .order('created_at', { ascending: false });
  if (data && data.length > SNAPSHOT_LIMIT) {
    const drop = data.slice(SNAPSHOT_LIMIT).map((r) => r.id);
    await c.from('trip_snapshots').delete().in('id', drop);
  }
}

// Save a point-in-time copy for version history / restore.
export async function saveTripSnapshot(trip, { label = '', force = false } = {}) {
  if (!trip) return null;
  const c = await getClient();
  if (!c) return saveLocalSnapshot(trip, label);
  try {
    const row = {
      trip_id: TRIP_ID,
      data: trip,
      saved_by: actorOrDefault(trip.meta?.updatedBy),
      stops_count: stopsCount(trip),
      label,
    };
    const { data, error } = await c.from('trip_snapshots').insert(row).select('id').single();
    if (error) throw error;
    await pruneSnapshots(c);
    return data?.id || null;
  } catch (e) {
    console.warn('Claus: snapshot save failed', e);
    return saveLocalSnapshot(trip, label);
  }
}

export async function listTripSnapshots(limit = 25) {
  const c = await getClient();
  if (!c) {
    return loadLocalSnapshots().map((s) => ({
      id: s.id,
      created_at: s.created_at,
      saved_by: s.saved_by,
      stops_count: s.stops_count,
      label: s.label,
      local: true,
    }));
  }
  try {
    const { data, error } = await c.from('trip_snapshots')
      .select('id, created_at, saved_by, stops_count, label')
      .eq('trip_id', TRIP_ID)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('Claus: list snapshots failed', e);
    return loadLocalSnapshots().map((s) => ({
      id: s.id,
      created_at: s.created_at,
      saved_by: s.saved_by,
      stops_count: s.stops_count,
      label: s.label,
      local: true,
    }));
  }
}

export async function fetchTripSnapshot(id) {
  const local = loadLocalSnapshots().find((s) => s.id === id);
  if (local) return local.data;
  const c = await getClient();
  if (!c) return null;
  try {
    const { data, error } = await c.from('trip_snapshots')
      .select('data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? data.data : null;
  } catch (e) {
    console.warn('Claus: fetch snapshot failed', e);
    return null;
  }
}

// Subscribe to live changes from the other user. Returns an unsubscribe fn.
export function subscribeRemoteTrip(onChange) {
  let channel = null;
  let active = true;
  getClient().then((c) => {
    if (!c || !active) return;
    channel = c
      .channel('scandiplan-trip')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${TRIP_ID}` },
        (payload) => {
          const row = payload.new;
          const next = row && row.data;
          if (next) onChange(next, row.updated_at);
        },
      )
      .subscribe();
  });
  return () => {
    active = false;
    if (channel) {
      try { channel.unsubscribe(); } catch { /* ignore */ }
    }
  };
}

export { syncEnabled };

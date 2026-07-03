// Claus — DEMO configuration.
//
// This is the standalone demo clone. It is intentionally NOT wired to any
// backend: Supabase sync is OFF (the app runs local-only, saving to the
// browser), and there's no Vercel deployment. The trip is seeded locally to
// start tomorrow, and the daily briefing renders from the local trip data (plus
// the devserver's mock concierge when you run scripts/devserver.py).

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// A demo trip id, distinct from any real trip.
export const TRIP_ID = 'claus-demo';

// Web Push is disabled in the demo (no server to send the morning brief).
export const VAPID_PUBLIC_KEY = '';

export function syncEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

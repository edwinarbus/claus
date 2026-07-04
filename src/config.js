// Claus — DEMO configuration.
//
// This is the standalone demo clone. The BROWSER app is still local-only —
// Supabase sync is OFF here, so no two-person live editing (the trip is
// seeded locally on its fixed Jul 2 - Jul 11 dates). The Concierge is
// real, though: it's deployed with its own server-side Supabase credentials
// (Vercel env vars only, never committed) pointed at the SAME project as the
// real trip but a completely separate 'claus-demo' row, plus its own live
// Managed Agent, so the demo's nightly brief and push are genuine — not
// simulated. VAPID_PUBLIC_KEY (below) is the demo's own keypair, needed
// client-side so this browser can subscribe to that real push.

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// A demo trip id, distinct from any real trip.
export const TRIP_ID = 'claus-demo';

// The demo's own VAPID keypair (public half only — safe to commit) so this
// browser can subscribe to the real Concierge's "brief is ready" push.
export const VAPID_PUBLIC_KEY = 'BPULnSIOwECUpfz-Lj-KflYbatgMOD25UTW9ebEGXkY7RAxtPXHlXbW33fGsrppH9M6hVGuJrXFQfAcpcW1_iEE';

export function syncEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

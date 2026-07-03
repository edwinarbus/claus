// Server-side config for the push/news serverless functions. Plain CommonJS —
// these run on Vercel with no build step or package.json.
//
// The Supabase values mirror src/config.js (the anon key is public by design;
// rows are guarded by RLS). The VAPID PRIVATE key is a real signing secret and
// is therefore NEVER committed: set it as a Vercel environment variable
// (README → "Notifications"). Until it's set, push sending is off and
// the morning-brief endpoint says so instead of failing.

// Env values are trimmed: a stray newline/space from pasting into the Vercel
// dashboard otherwise corrupts the key material in ways that only surface as
// opaque crypto errors at send time.
const env = (k) => (process.env[k] || '').trim();

module.exports = {
  SUPABASE_URL: env('SUPABASE_URL') || 'https://REDACTED_PROJECT_REF.supabase.co',
  SUPABASE_ANON_KEY: env('SUPABASE_ANON_KEY') || 'REDACTED_ANON_KEY',
  TRIP_ID: env('TRIP_ID') || 'redacted-real-trip-id',

  // Must match VAPID_PUBLIC_KEY in src/config.js (the browser subscribes with
  // the public half; pushes signed with any other key are rejected).
  VAPID_PUBLIC_KEY: env('VAPID_PUBLIC_KEY')
    || 'REDACTED_VAPID_KEY',
  VAPID_PRIVATE_KEY: env('VAPID_PRIVATE_KEY'),
  VAPID_SUBJECT: env('VAPID_SUBJECT') || 'mailto:hi@edwinarb.us',
};

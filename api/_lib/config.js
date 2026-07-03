// Server-side config for the serverless functions. Plain CommonJS — these run
// on Vercel with no build step or package.json.
//
// DEMO CLONE: the real project's Supabase URL / anon key / trip id and VAPID
// keys have been REMOVED so this demo can never touch the real database, even if
// it were accidentally deployed without environment variables. There is no
// backend for the demo; set env vars in a fresh Vercel project if you ever wire
// one up. (The app itself runs fully local-only — see src/config.js.)

const env = (k) => (process.env[k] || '').trim();

module.exports = {
  SUPABASE_URL: env('SUPABASE_URL') || '',
  SUPABASE_ANON_KEY: env('SUPABASE_ANON_KEY') || '',
  TRIP_ID: env('TRIP_ID') || 'claus-demo',

  VAPID_PUBLIC_KEY: env('VAPID_PUBLIC_KEY') || '',
  VAPID_PRIVATE_KEY: env('VAPID_PRIVATE_KEY'),
  VAPID_SUBJECT: env('VAPID_SUBJECT') || 'mailto:demo@example.com',
};

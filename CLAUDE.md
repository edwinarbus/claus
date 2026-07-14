# Claus — project notes for Claude

## This repo is the DEMO clone
- `claus` is a standalone **demo** clone of `scandiplan` (the real trip lives in
  `scandiplan`). Keep them separate — changes here should not touch the real trip.
- **No backend:** Supabase sync is off and there's no Vercel deployment
  (`src/config.js` has empty keys → local-only mode). Don't re-add real credentials.
- The itinerary is **seeded locally to start today** (`src/store/store.js`
  seeds the default route at `todayISO()` when there's no saved trip). The
  devserver's mock brief (`scripts/devserver.py`) is dated to match day 1.
  Server-side, the shared demo trip row self-heals the same way: when its end
  date has passed, the concierge API slides the whole timeline forward to
  start today (`api/_lib/trip-rebase.js`).
- Run it: `python3 scripts/devserver.py 8777` → http://localhost:8777.

## Pull requests
- Open PRs as **ready for review**, not as drafts.

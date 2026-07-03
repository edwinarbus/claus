# Scandiplan

A personal Scandinavia trip planner for **Tyler & Edwin (July 2026)**. Three views
— **Timeline**, **Calendar**, and a real **Map** — plus tiered, image-rich
recommendations (must-see / must-do / must-eat) with rough time estimates, source
links, and the top places to get each local delicacy. Drag a stop's edge to
extend/shorten it, drag recommendations onto a per-day planner, and watch the
spry-tuned pacing meter, typical-July → live weather, and gentle local-food
nudges that vary day to day. The trip can be **shared live between two people**.

## Run it locally

No build step and no Node required — it's plain ES modules + React/htm/Tailwind +
Leaflet over CDN.

```bash
cd scandiplan
python3 scripts/devserver.py 8777      # tiny no-cache static server
# then open http://127.0.0.1:8777/
```

(Any static server works, e.g. `python3 -m http.server 8777`.) Internet is needed
for the CDN libraries, map tiles (OpenStreetMap/CARTO), weather (Open-Meteo), and
recommendation thumbnails (Wikipedia).

## Sharing between two people (2-minute setup)

Out of the box the trip saves to your browser (`localStorage`). To share one live
itinerary between Tyler and Edwin, add a free [Supabase](https://supabase.com)
project — no server to run, generous free tier.

1. Create a free Supabase project. From **Project Settings → API**, copy the
   **Project URL** and the **anon public** key.
2. Paste them into [`src/config.js`](src/config.js):

   ```js
   export const SUPABASE_URL = 'https://YOURPROJECT.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...your anon key...';
   ```

   (The anon key is safe to commit — it's public by design and the row is
   protected by the policy below.)
3. In Supabase **SQL Editor**, run:

   ```sql
   create table if not exists public.trips (
     id text primary key,
     data jsonb not null,
     updated_at timestamptz not null default now()
   );

   alter table public.trips enable row level security;

   -- One shared trip for the two of you (trusted users, no login).
   create policy "shared trip read"  on public.trips for select using (true);
   create policy "shared trip write" on public.trips for insert with check (true);
   create policy "shared trip update" on public.trips for update using (true) with check (true);

   -- Let both browsers receive live updates.
   alter publication supabase_realtime add table public.trips;
   ```

That's it. Reload the app: the header shows **Synced**, and edits from either
person appear live for the other. (If you ever want a fresh start, click the reset
button; both of you share the single trip id in `config.js`.)

## Notifications (plan edits + 6 AM trip brief)

Subscribed devices get two kinds of concise pushes:

- When one traveler edits the shared plan, the other traveler gets a short
  update like *"Edwin removed Copenhagen and added Tallinn"*.
- Every trip morning at 6 AM (Copenhagen time; 7 AM in Helsinki), subscribed
  devices get a brief with the weather, the day's planned sights, and any local
  disruption/news heads-up.

**One-time setup:**

1. Run this once in the Supabase **SQL Editor** (stores each browser/device push
   subscription next to the trip):

   ```sql
   create table if not exists public.push_subscriptions (
     endpoint text primary key,
     trip_id text not null,
     data jsonb not null,
     who text default '',
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );

   alter table public.push_subscriptions enable row level security;

   create policy "push read"   on public.push_subscriptions for select using (true);
   create policy "push insert" on public.push_subscriptions for insert with check (true);
   create policy "push update" on public.push_subscriptions for update using (true) with check (true);
   create policy "push delete" on public.push_subscriptions for delete using (true);
   ```

2. In Vercel → Project → Settings → Environment Variables, set
   **`VAPID_PRIVATE_KEY`** — the private half of the Web Push keypair. The
   public half is committed in `src/config.js` / `api/_lib/config.js`; the
   private half is a signing secret and lives only in the env var. To mint a
   fresh pair (then update the committed public key to match):

   ```bash
   node -e "const{generateKeyPairSync}=require('crypto');const{publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pub=publicKey.export({format:'jwk'});console.log('public :','B'+Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url').slice(1));console.log('private:',privateKey.export({format:'jwk'}).d)"
   ```

   Until the env var is set, `/api/morning-brief` composes but reports
   `VAPID_PRIVATE_KEY env var not set` instead of sending.

3. Deploy to Vercel as usual. Plan-change pushes are sent by `/api/push` after a
   shared-trip edit saves. `vercel.json` also declares the daily cron
   (`/api/morning-brief` at 04:00 UTC). On the Hobby plan Vercel may fire it up
   to an hour after the scheduled time.

**On each iPhone:** open the site in Safari → Share → **Add to Home Screen** →
open the installed app → allow notifications when the first-open card asks (or
later from Settings → Notifications). iOS only allows web push from installed
Home Screen apps (iOS 16.4+).

**On desktop:** the site asks to enable notifications on the next load in
supported browsers. The permission prompt must be accepted once per browser.

**Testing before the trip:** `https://YOURAPP.vercel.app/api/morning-brief?test=1&dry=1`
composes the brief for the trip's first planned day without sending; drop
`&dry=1` to actually push it to subscribed devices.

Other overridable env vars: `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TRIP_ID`, and optional `CRON_SECRET`
(when set, Vercel sends it as a Bearer token and the endpoint rejects anyone
else). If you rotate the keypair, update the public key in both config files
and re-enable notifications on each device.

## AI features (Claude)

All the AI runs on the **Claude API** (Anthropic Messages API, model
**Claude Sonnet 5**) from the Vercel functions in `api/` — no SDK, just `fetch`.
Set one env var to turn it on:

- **`ANTHROPIC_API_KEY`** in Vercel → Project → Settings → Environment
  Variables. Without it, chat and ticket auto-fill say "not configured" and the
  morning/welcome briefs fall back to hand-written templates — the app still
  works, minus the AI copy.

What it powers:

- **Claus chat** (`/api/trip-chat`) — streams answers with adaptive-thinking
  reasoning, live **web search + web fetch** with a Sources list, and structured
  `propose_trip_edits` itinerary changes. The itinerary rides in a cached system
  block, so repeated turns on the same plan are served from the prompt cache.
- **Ticket / reservation reading** (`/api/extract-ticket`, `/api/match-ticket`)
  — reads an uploaded PDF (document) or photo (vision) and returns structured
  fields via native structured outputs.
- **Morning brief + welcome splash** (`/api/morning-brief`, `/api/welcome-brief`)
  — short structured copy; `/api/prewarm-briefs` batch-generates every upcoming
  day's splash ahead of time at 50% cost (`?collect=<batchId>` stores them).
- **Smart disruption alerts** (`/api/trip-watch`) — a relevance classifier ranks
  GDELT headlines instead of keyword matching (keyword fallback when no key).

### Overnight Concierge (Managed Agents) — optional

A nightly [Managed Agent](https://platform.claude.com/docs/en/managed-agents/overview)
that researches tomorrow's city (weather, closures, disruptions, events),
remembers the travelers' preferences in a persistent **memory store**, writes a
morning brief, and pushes "brief ready" — all on Anthropic's infrastructure.

Under the hood it's one persistent [Managed Agent](https://platform.claude.com/docs/en/managed-agents/overview)
(Claude Sonnet 5) + a **memory store** + a **scheduled deployment** that fires a
new session every night at **21:00 Europe/Copenhagen** (the evening before). The
agent calls `read_trip_state` for the live plan, reads `/mnt/memory` for known
preferences, researches tomorrow's city with web search/fetch, writes
`concierge.json`, and updates its memory. `/api/concierge` services that tool
call and, when the session idles, harvests the brief and web-pushes it — so your
Supabase credentials never enter the agent container.

**One-time setup** (beta; sessions cost money to run):

0. **Env vars** in Vercel → Project → Settings → Environment Variables:
   - `ANTHROPIC_API_KEY` — required (provisions + runs the agent).
   - `CRON_SECRET` — gates `?setup=1` and doubles as the webhook `?token=` fallback.
   - `ANTHROPIC_WEBHOOK_SIGNING_KEY` — verifies webhook HMAC signatures.
   - (Already set for briefs: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TRIP_ID`, and
     the `VAPID_*` keys — the last are what actually deliver the "brief ready" push.)

1. In the Anthropic Console, register a **webhook** for `session.status_idled`
   and `deployment_run.*` pointing at `https://YOURAPP.vercel.app/api/concierge`.
   (Where the platform pre-parses the body so raw-body HMAC isn't possible,
   append `?token=<CRON_SECRET>` to the registered URL instead.)

2. Provision the environment, memory store, agent, and nightly deployment:

   ```bash
   curl -X POST "https://YOURAPP.vercel.app/api/concierge?setup=1" \
     -H "authorization: Bearer $CRON_SECRET"   # header only needed if CRON_SECRET is set
   ```

   A fresh provision returns `{"status":"ok","created":true,"concierge":{…},
   "upcomingRuns":[…]}` — the agent/store/deployment IDs are saved into the shared
   trip state, and `upcomingRuns` lists the next scheduled fire times. If it's
   already provisioned you get `{"already":true}`; add `?force=1` to rebuild it.
   (Prefer version control? Apply `agents/concierge.agent.yaml` +
   `agents/concierge.environment.yaml` with the `ant` CLI instead of the curl.)

3. That's it — it runs itself nightly. The brief lands as a **"☕ Tomorrow's brief
   is ready"** web push and on the app's welcome splash; its up-to-5 suggestions
   are optional and never edit your plan. Setup + webhook share one endpoint to
   stay within Vercel's 12-function Hobby limit.

## Deploy to a public URL

Because there's no build step, any static host works. Easiest options:

- **Netlify** — `netlify deploy --prod` from this folder, or connect the repo in
  the Netlify UI. `netlify.toml` is already set up (publish = repo root).
- **Vercel** — `vercel` from this folder (framework: "Other", output: root).
- **GitHub Pages** — push the repo and enable Pages on the default branch root.

Both of you then bookmark the same URL; the shared Supabase trip keeps you in sync.

## How it's built

- **React 18 + htm** (JSX-like templates, no transpiler) and **Tailwind** via the
  runtime CDN, plus a small bespoke CSS layer in [`styles.css`](styles.css).
- **State:** one reducer (`src/store/`) → persisted to `localStorage` **and**, when
  configured, to a shared Supabase row with live (realtime) sync.
- **Map:** Leaflet with OpenStreetMap/CARTO tiles — real coastlines, numbered
  route pins, transport icons, and focus-on-select.
- **Recommendations:** a tiered catalog (`src/data/catalog.js`) with time
  estimates and, for delicacies, 3–5 top places. Thumbnails + source links resolve
  live from Wikipedia (cached). Items are ranked Tier 1 → 3.
- **Pacing:** time-based and tuned for a quick pace (a "2-hour" activity ≈ 1.5h for
  you two), with a generous full-day capacity.
- **Weather:** Open-Meteo — live forecast within ~15 days, otherwise a recent-July
  average; rolls into live as the trip nears.

### Layout

```
src/
  config.js    Supabase URL + anon key (shared sync) — empty = local only
  data/        catalog (tiers, durations, places, wiki images), slots, weather, logistics, pacing, nudges, warnings
  store/       builders, reducer, store (context + localStorage + Supabase sync), sync, selectors
  lib/         dates, ids
  components/  App, Header, ViewToggle, Timeline, StopBlock, StopDetail, CalendarView,
               RecPanel/RecCard/RecAutocomplete, DayPlanner/DayCard/Slot, MapView,
               PacingMeter, Nudge, FilterPanel, TripInsights, WeatherChip, useWikiImage, …
```

## Content & attribution

City selection and sight priorities follow the well-known Rick Steves 3-week
Scandinavia itinerary; **all blurbs and picks are original wording.** City cards
link out to the free Rick Steves destination pages, recommendations link to
Wikipedia, and food places link to their sites or Google Maps. Built-in data is a
starting point — every stop, item, blurb, tier, time estimate, slot, and note is
editable.

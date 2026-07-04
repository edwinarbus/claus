# Claus

**Claus** is a Claude-powered travel concierge wrapped around a hand-built
itinerary for a July 2026 trip through **Scandinavia and the Baltics**. It plans,
researches, and briefs: a streaming chat that answers with live web results and
rewrites your itinerary, a nightly agent that wakes up and researches tomorrow's
city, ticket photos that read themselves, and a morning brief that prints to a
thermal receipt printer.

Every AI surface runs on the **Claude API** — the Messages API and Managed Agents,
called with plain `fetch` from Vercel functions. No SDK, and no build step: the
whole front end is ES modules + React/htm/Tailwind + Leaflet over a CDN.

---

## Powered by the Claude API

All AI is the **Anthropic Messages API** (`POST /v1/messages`) on **Claude
Sonnet 5**, called with raw `fetch` — no SDK — from the functions in
[`api/`](api), with jittered retries on 429/5xx/overloaded. One env var,
**`ANTHROPIC_API_KEY`**, turns everything on; without it the app still runs on
hand-written fallbacks (chat and ticket auto-fill just say "not configured").

| Surface | Claude API features it uses |
|---|---|
| **Claus chat** — [`api/trip-chat.js`](api/trip-chat.js) | **Streaming (SSE)** · **adaptive thinking** (`thinking: {type:"adaptive", display:"summarized"}`, `output_config.effort: "low"`) streamed live as a reasoning summary · **server-side web search** (`web_search_20260318`, `max_uses`, `user_location` biased to the current city) + **web fetch** (`web_fetch_20260209`) · **citations** → an auto-appended Sources list · **prompt caching** (`cache_control: {type:"ephemeral"}`) on the itinerary system block, so repeat turns on the same plan are served from cache · **tool use** — a `propose_trip_edits` tool streams structured itinerary edits as they generate |
| **Ticket / reservation reading** — [`api/extract-ticket.js`](api/extract-ticket.js), [`api/match-ticket.js`](api/match-ticket.js) | **Vision** (a photo → `image` block) and **PDF document input** (a booking PDF → `document` block, base64) · **structured outputs** — a strict `json_schema` via `output_config.format` returns typed reservation fields |
| **Morning brief & welcome copy** — [`api/morning-brief.js`](api/morning-brief.js), [`api/welcome-brief.js`](api/welcome-brief.js), [`api/_lib/brief-ai.js`](api/_lib/brief-ai.js) | **Structured outputs** (strict `json_schema`); thinking disabled for fast, deterministic copy |
| **Brief pre-warming** — [`api/prewarm-briefs.js`](api/prewarm-briefs.js), [`api/_lib/batch-brief.js`](api/_lib/batch-brief.js) | **Batch API** (`/v1/messages/batches`) — every upcoming day's brief generated ahead of time at **50% cost**, results keyed by `custom_id` |
| **Disruption alerts** — [`api/trip-watch.js`](api/trip-watch.js), [`api/_lib/classify-alerts.js`](api/_lib/classify-alerts.js) | A **structured-output relevance classifier** ranks GDELT headlines instead of keyword-matching (keyword fallback with no key) |
| **Overnight Concierge** — [`api/concierge.js`](api/concierge.js), [`api/_lib/anthropic-agents.js`](api/_lib/anthropic-agents.js) | **Managed Agents (beta)** — see below |

### Overnight Concierge (Managed Agents)

A persistent **Managed Agent** researches tomorrow's city each night — weather,
closures, disruptions, events — on Anthropic's own infrastructure, remembers the
travelers' preferences, writes a morning brief, and pushes "brief ready." It
exercises most of the Managed Agents surface (beta header
`managed-agents-2026-04-01`):

- a **persistent, versioned agent** + a **cloud environment**, provisioned once
  (or applied from [`agents/*.yaml`](agents) with the `ant` CLI);
- a **scheduled deployment** — a cron that fires a fresh **session** nightly at
  **21:00 Europe/Copenhagen** (the evening before);
- a **memory store** the agent reads/writes at `/mnt/memory` to carry preferences
  across nights;
- a **custom tool**, `read_trip_state`, that the app services — so the live plan
  reaches the agent while your Supabase credentials never enter its container;
- the **Files API** (`files-api-2025-04-14`) for the `concierge.json` brief the
  agent writes;
- **HMAC-verified webhooks** (`session.status_idled`, `deployment_run.*`) that
  harvest the finished brief and web-push it.

Setup is [below](#overnight-concierge-setup-optional).

---

## What else the app does

- **Three views** — **Timeline**, **Calendar**, and a real Leaflet **Map** — plus
  a cinematic **flyover** ([`StoryMode`](src/components/StoryMode.js)) that flies
  the route stop to stop over satellite tiles.
- **Tiered, image-rich recommendations** (must-see / must-do / must-eat) with time
  estimates, source links, and the top places for each local delicacy. Drag a
  stop's edge to resize it, drag recommendations onto a **per-day planner**, and
  watch a pacing meter tuned to a quick pace.
- **Live weather** (Open-Meteo — live within ~15 days, recent-July average
  otherwise) and gentle day-to-day **nudges**. Every stop, item, blurb, tier,
  and note is editable.
- **Live 2-person sync** — the trip saves to `localStorage` and, when a Supabase
  project is configured, to one shared row with realtime sync, so edits appear
  instantly for both travelers.
- **Push notifications** — a short diff when the other traveler edits the plan
  (*"Edwin removed Copenhagen and added Tallinn"*), and a 6 AM morning brief
  (weather + the day's sights + any disruption heads-up).
- **A daily briefing receipt** — the morning brief renders as an **80mm thermal
  receipt** (with a day map and local-language phrases) and can print for real to
  an **Epson TM-m30II**: the browser rasterizes it to **ESC/POS**
  ([`src/lib/thermalReceipt.js`](src/lib/thermalReceipt.js),
  [`escpos.js`](src/lib/escpos.js)) and a tiny local bridge
  ([`scripts/printbridge.py`](scripts/printbridge.py)) relays the bytes over USB
  or TCP.

---

## Run it locally

No build step and no Node required for the UI — plain ES modules over a CDN.

```bash
cd claus
python3 scripts/devserver.py 8777      # tiny no-cache static server
# then open http://127.0.0.1:8777/
```

Internet is needed for the CDN libraries, map tiles (OpenStreetMap/CARTO),
weather (Open-Meteo), and recommendation thumbnails (Wikipedia). The Claude
features live in the `api/` Vercel functions — deploy to Vercel, or run
`vercel dev`, to exercise chat, ticket reading, briefs, and the concierge.

## Sharing between two people (2-minute setup)

Out of the box the trip saves to your browser. To share one live itinerary, add a
free [Supabase](https://supabase.com) project — no server to run.

1. Create a project. From **Project Settings → API**, copy the **Project URL** and
   the **anon public** key.
2. Paste them into [`src/config.js`](src/config.js):

   ```js
   export const SUPABASE_URL = 'https://YOURPROJECT.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...your anon key...';
   ```

   (The anon key is safe to commit — it's public by design; the row is protected
   by the policy below.)
3. In the Supabase **SQL Editor**, run:

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

Reload the app: the header shows **Synced**, and edits from either person appear
live for the other.

## Notifications (plan edits + 6 AM brief)

**One-time setup:**

1. In the Supabase **SQL Editor**, store each device's push subscription:

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

2. In Vercel → Settings → Environment Variables, set **`VAPID_PRIVATE_KEY`** — the
   private half of the Web Push keypair (the public half is committed in
   `src/config.js` / `api/_lib/config.js`). To mint a fresh pair:

   ```bash
   node -e "const{generateKeyPairSync}=require('crypto');const{publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pub=publicKey.export({format:'jwk'});console.log('public :','B'+Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url').slice(1));console.log('private:',privateKey.export({format:'jwk'}).d)"
   ```

3. Deploy. Plan-change pushes are sent by `/api/push` after a shared-trip edit;
   `vercel.json` declares the daily cron (`/api/morning-brief` at 04:00 UTC).

**On each iPhone:** open the site in Safari → Share → **Add to Home Screen** → open
the installed app → allow notifications (iOS only allows web push from installed
Home Screen apps, iOS 16.4+). **On desktop:** accept the permission prompt once per
browser.

**Test before the trip:** `…/api/morning-brief?test=1&dry=1` composes the brief for
the first planned day without sending; drop `&dry=1` to actually push it.

Overridable env vars: `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `TRIP_ID`, and optional `CRON_SECRET` (when set, Vercel sends
it as a Bearer token and the endpoint rejects anyone else).

## Overnight Concierge setup (optional)

Beta; sessions cost money to run.

1. **Env vars** in Vercel: `ANTHROPIC_API_KEY` (required — provisions + runs the
   agent), `CRON_SECRET` (gates `?setup=1`, doubles as the webhook `?token=`
   fallback), `ANTHROPIC_WEBHOOK_SIGNING_KEY` (verifies webhook HMAC). The brief
   env vars above still apply — the `VAPID_*` keys are what deliver the push.

2. In the Anthropic Console, register a **webhook** for `session.status_idled` and
   `deployment_run.*` pointing at `https://YOURAPP.vercel.app/api/concierge`.
   (Where the platform pre-parses the body so raw-body HMAC isn't possible, append
   `?token=<CRON_SECRET>` to the URL instead.)

3. Provision the environment, memory store, agent, and nightly deployment:

   ```bash
   curl -X POST "https://YOURAPP.vercel.app/api/concierge?setup=1" \
     -H "authorization: Bearer $CRON_SECRET"   # only needed if CRON_SECRET is set
   ```

   A fresh provision saves the agent/store/deployment IDs into the shared trip
   state and returns the next `upcomingRuns`. Add `?force=1` to rebuild. (Prefer
   version control? Apply [`agents/concierge.agent.yaml`](agents/concierge.agent.yaml)
   + [`agents/concierge.environment.yaml`](agents/concierge.environment.yaml) with
   the `ant` CLI instead.)

It then runs itself nightly: the brief lands as a **"☕ Tomorrow's brief is ready"**
push and on the app's welcome screen. Setup + webhook share one endpoint to stay
within Vercel's 12-function Hobby limit.

## Deploy

No build step, so any static host works; the `api/` functions need Vercel.

- **Vercel** — `vercel` from this folder (framework "Other", output root). Required
  for the Claude features.
- **Netlify / GitHub Pages** — fine for a static, UI-only deploy (`netlify.toml` is
  set up); the AI endpoints won't run there.

## How it's built

- **React 18 + htm** (JSX-like templates, no transpiler) and **Tailwind** via the
  runtime CDN, plus a bespoke CSS layer in [`styles.css`](styles.css).
- **State:** one reducer (`src/store/`) → persisted to `localStorage` and, when
  configured, to a shared Supabase row with realtime sync.
- **Map:** Leaflet (OpenStreetMap/CARTO) for the views; a satellite/DEM flyover for
  StoryMode. Numbered route pins, transport icons, focus-on-select.
- **Backend:** Vercel functions in `api/` — plain CommonJS + global `fetch`, no
  SDK, no `package.json` — talking to the Claude API and Supabase.

```
src/
  config.js    Supabase URL + anon key (shared sync) — empty = local only
  data/        catalog (tiers, durations, places, wiki images), slots, weather, logistics, pacing, nudges
  store/       builders, reducer, store (context + localStorage + Supabase sync), selectors
  components/  App, Header, ViewToggle, Timeline, Calendar, Map, StoryMode, RecPanel, DayPlanner,
               DayMap, TripChatPanel (Claus chat + briefing receipt), Tickets, …
  lib/         dates, ids, thermalReceipt + escpos (ESC/POS receipt), maps
api/           Vercel functions: trip-chat, extract/match-ticket, morning/welcome-brief,
               prewarm-briefs, trip-watch, concierge; _lib/ shared Claude + agent clients
agents/        concierge agent + environment YAML (apply with the `ant` CLI)
scripts/       devserver.py (local static), printbridge.py (Epson ESC/POS bridge)
```

## Content & attribution

City selection and sight priorities follow the well-known Rick Steves 3-week
Scandinavia itinerary; **all blurbs and picks are original wording.** City cards
link to the free Rick Steves destination pages, recommendations link to Wikipedia,
and food places link to their sites or Google Maps. The built-in data is a
starting point — everything is editable.

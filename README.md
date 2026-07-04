# Claus

A personal, two-person trip planner for a July 2026 **Scandinavia & Baltics**
itinerary, built around one idea: **every night, while you sleep, an autonomous
Claude agent researches tomorrow and leaves a printed paper briefing waiting for
you by morning** — no app to open, nothing to tap. On top of that: a chat that
rewrites the itinerary live, and photo/PDF reading for tickets and reservations.

Nothing here is generic travel-planning boilerplate — the itinerary is real, the
picks are hand-written, and Claude only ever acts on *this* trip's actual state.

## What it does

**The Overnight Concierge — a Claude Managed Agent, not a cron job.** This is the
heart of Claus. Every night at 21:00 Europe/Copenhagen, a persistent Claude agent
wakes up inside its own Anthropic-hosted sandbox and does what a real concierge
would: pulls the live itinerary, checks tomorrow's weather, scans for closures and
disruptions, catches local events with real web search — and remembers what you
like from a durable memory store that grows a little sharper every night. Then the
part that feels like magic: the finished brief renders itself as an 80mm thermal
receipt and **prints — for real, on a physical Epson receipt printer — entirely on
its own.** No button, no phone, no notification to tap. You just walk over in the
morning and there's a small paper slip already waiting, like a hotel concierge
slid it under your door while you slept: the weather, the plan, a couple of
handy local-language phrases for wherever you're headed that day. A tiny,
disposable, delightfully analog daily briefing that exists purely because an
agent did its job overnight.

**Claus chat (Claude Sonnet 5).** One text box, streamed. Ask it to rework a day
and it searches the live web, reasons out loud via **adaptive thinking** (you see
the reasoning summary stream in, not a spinner), and — when asked — proposes
structured itinerary edits you approve before they land. Every turn is grounded in
the actual trip: the current itinerary rides in a cached system block, so asking
five questions about the same plan only pays full price once.

**Ticket & reservation reading (Claude Sonnet 5).** Photograph a boarding pass or
drop in a booking PDF and Claude reads it with vision or native PDF understanding
and returns clean, typed fields — no manual entry, no OCR service.

**Three views, one live plan.** Timeline, Calendar, and a real Leaflet map, plus a
cinematic satellite **flyover** ([`StoryMode`](src/components/StoryMode.js)) that
flies the whole route stop to stop. Drag a stop's edge to resize it, drag
recommendations onto a per-day planner, watch a pacing meter tuned to a quick
pace. The trip **syncs live between two phones** (Supabase realtime) with a short
push notification whenever one traveler edits the plan.

**Everything else:** a strict-JSON relevance classifier ranks real disruption
headlines instead of keyword-matching them; recommendations are tiered (must-see /
must-do / must-eat) with time estimates and, for local food, the top few places to
get it.

## Stack

- Plain **ES modules** — React 18 + htm (JSX-like templates, no transpiler) +
  Tailwind, all over a CDN. No build step, no bundler, no `package.json` for the
  front end.
- **Leaflet** (OpenStreetMap/CARTO) for the three views; a satellite/DEM tile
  pipeline for the StoryMode flyover.
- **Supabase** (Postgres + realtime) for the shared trip row and push
  subscriptions — optional, local-only `localStorage` otherwise.
- **Vercel functions** in `api/` — plain CommonJS + global `fetch`, no SDK — for
  every Claude call, ticket parsing, and the concierge webhook.
- **`scripts/printbridge.py`** — a tiny stdlib-only local relay that turns
  browser-rendered ESC/POS bytes into real thermal-printer output over USB or TCP.

## Claude API surface

Every AI feature is the **Anthropic Messages API** on **Claude Sonnet 5**, called
with raw `fetch` from `api/` — jittered retries on 429/5xx/overloaded, and every
call checks `stop_reason` explicitly rather than assuming success.

| Feature | API surface |
|---|---|
| **The Overnight Concierge** — [`api/concierge.js`](api/concierge.js), [`api/_lib/anthropic-agents.js`](api/_lib/anthropic-agents.js) | **Managed Agents**, in full: a persisted, versioned **Agent** (model + system prompt + tools) inside a **cloud Environment**; a **scheduled Deployment** (cron) firing a fresh **session** every night; a workspace **Memory Store** the agent reads and writes at `/mnt/memory` to carry preferences forward night over night; a custom `read_trip_state` **tool** the app services live, so Supabase credentials never enter the agent's container; the **Files API** for the brief the agent writes; **HMAC-verified webhooks** (`session.status_idled`, `deployment_run.*`) that harvest the finished brief the instant the session goes idle — and set the automatic print in motion |
| Claus chat — [`api/trip-chat.js`](api/trip-chat.js) | Streaming `messages.create`; **adaptive thinking** (`thinking: {type:"adaptive", display:"summarized"}`, `output_config.effort:"low"`) streamed live as a reasoning summary; server-side **web search** (`web_search_20260318`, `user_location` biased to the current city) + **web fetch** (`web_fetch_20260209`) with **citations** rolled into an auto-appended Sources list; **prompt caching** (`cache_control: ephemeral`) on the itinerary system block so repeat turns on the same plan are served from cache; **tool use** — a `propose_trip_edits` tool streams structured itinerary edits as they generate |
| Ticket / reservation reading — [`api/extract-ticket.js`](api/extract-ticket.js), [`api/match-ticket.js`](api/match-ticket.js) | **Vision** (`image` block) and native **PDF document input** (`document` block, base64); strict **structured outputs** (`output_config.format: json_schema`) for typed fields |
| Disruption alerts — [`api/_lib/classify-alerts.js`](api/_lib/classify-alerts.js) | A structured-output relevance classifier ranks real headlines instead of keyword-matching |

## Quick start

```bash
cd claus
python3 scripts/devserver.py 8777      # no-cache static server for the UI
# → http://127.0.0.1:8777/
```

The Claude features live in `api/` and need Vercel:

```bash
vercel dev        # local, with the api/ functions live
# or: vercel       # deploy — required for chat, ticket reading, and the concierge
```

Run the local print bridge to have briefs print for real (see below for the
printer itself):

```bash
PRINTER_CUPS=TM_m30II python3 scripts/printbridge.py   # or PRINTER_HOST=<ip>
```

## Setup

**The Overnight Concierge** — provision once:

```bash
curl -X POST "https://YOURAPP.vercel.app/api/concierge?setup=1" \
  -H "authorization: Bearer $CRON_SECRET"
```

This creates the agent, environment, memory store, and nightly deployment, and
saves the IDs into the shared trip state (prefer version control? apply
[`agents/concierge.agent.yaml`](agents/concierge.agent.yaml) +
[`agents/concierge.environment.yaml`](agents/concierge.environment.yaml) with the
`ant` CLI instead). Register a Console webhook for `session.status_idled` and
`deployment_run.*` pointed at `/api/concierge`. From then on it runs itself —
every night, unattended, ending with a real receipt printed and waiting for you.

**The thermal printer** — an Epson TM-m30II on USB or the network. Keep
`scripts/printbridge.py` running near the printer (`--selftest` prints a check
slip); the moment the Concierge's brief lands and the bridge is reachable, it
prints itself — that's the whole point. A manual **Print to Epson** button in
chat is there as a fallback.

**Sharing between two phones** — add a free [Supabase](https://supabase.com)
project, drop the URL + anon key into [`src/config.js`](src/config.js), then in
the SQL Editor:

```sql
create table if not exists public.trips (
  id text primary key, data jsonb not null, updated_at timestamptz not null default now());
alter table public.trips enable row level security;
create policy "shared trip read"   on public.trips for select using (true);
create policy "shared trip write"  on public.trips for insert with check (true);
create policy "shared trip update" on public.trips for update using (true) with check (true);
alter publication supabase_realtime add table public.trips;
```

**Push notifications** — same SQL pattern for a `push_subscriptions` table (see
[`api/_lib/webpush.js`](api/_lib/webpush.js)), then set `VAPID_PRIVATE_KEY` on
Vercel. On iPhone: Safari → Share → **Add to Home Screen**, then allow
notifications from the installed app.

## Environment variables

| Variable | For |
|---|---|
| `CRON_SECRET` | Gates the Concierge's `?setup=1` provisioning; doubles as its webhook token fallback |
| `ANTHROPIC_WEBHOOK_SIGNING_KEY` | Verifies the Concierge's webhook HMAC |
| `PRINTER_CUPS` / `PRINTER_HOST` | Tells `printbridge.py` how to reach the Epson (USB queue name vs. network IP) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TRIP_ID` | Shared trip + push subscriptions |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push |

## Project layout

```
src/
  config.js    Supabase URL + anon key — empty = local only
  data/        catalog (tiers, durations, places), slots, weather, logistics, pacing, nudges
  store/       reducer + store (localStorage + Supabase realtime sync)
  components/  Timeline/Calendar/Map views, StoryMode flyover, TripChatPanel
               (Claus chat + the briefing receipt), Tickets, DayMap, RecPanel, DayPlanner
  lib/         dates, ids, thermalReceipt + escpos (renders the brief to ESC/POS), maps
api/           concierge (the Overnight Concierge + its webhook), trip-chat, extract/
               match-ticket, trip-watch; _lib/ shared Claude client + the Managed Agents client
agents/        concierge agent + environment, as version-controlled YAML
scripts/       devserver.py (local static server), printbridge.py (Epson ESC/POS bridge)
```

## Content & attribution

City selection and sight priorities follow the well-known Rick Steves 3-week
Scandinavia itinerary; **all blurbs and picks are original wording.** City cards
link to the free Rick Steves destination pages, recommendations link to
Wikipedia. Every stop, item, blurb, tier, and note is editable — the built-in data
is just a starting point.

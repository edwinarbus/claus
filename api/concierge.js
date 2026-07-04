// Overnight Concierge (Managed Agents) — a single endpoint with two jobs, kept
// as one Vercel function to stay under the Hobby plan's function limit:
//
//   POST /api/concierge?setup=1   → provision env + memory store + agent +
//                                    nightly deployment (gated by CRON_SECRET)
//   POST /api/concierge           → webhook: service the nightly session and,
//                                    when it finishes, push tomorrow's brief
//
// The agent runs on Anthropic's infrastructure; it fetches the live itinerary
// through a read_trip_state custom tool serviced here, so Supabase credentials
// never enter the agent container. Managed Agents is beta and sessions cost
// money to run — provisioning is deliberately manual.
//
// Prereqs: ANTHROPIC_API_KEY; a Console webhook for session.status_idled +
// deployment_run.* pointing at this path, with ANTHROPIC_WEBHOOK_SIGNING_KEY set
// (or append ?token=<CRON_SECRET> to the registered URL where the platform
// pre-parses the body and raw-body HMAC isn't possible).

const { SUPABASE_URL, SUPABASE_ANON_KEY, TRIP_ID, VAPID_PRIVATE_KEY } = require('./_lib/config.js');
const { sendPush } = require('./_lib/webpush.js');
const { loadTripState, saveTripState, isPushRow } = require('./_lib/state.js');
const { fetchTrip, todayISO } = require('./_lib/brief.js');
const { apiKey } = require('./_lib/claus-anthropic.js');
const {
  createEnvironment, createAgent, createMemoryStore, createMemory, createDeployment,
  createDeploymentRun, getDeploymentRun,
  listSessionEvents, sendSessionEvents, listSessionFiles, downloadFileText, verifyWebhook,
} = require('./_lib/anthropic-agents.js');

const SB_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

// ==== setup (provision once) ================================================

const AGENT_SYSTEM = [
  'You are the Claus Overnight Concierge for Tyler & Edwin\'s July 2026 Scandinavia & Baltics trip.',
  'Each night you prepare tomorrow\'s brief. Work through these steps:',
  '1) Call read_trip_state to get the current shared itinerary and today\'s date.',
  '2) Read the mounted memory directory under /mnt/memory for known traveler preferences and prior notes; take them into account.',
  '3) For TOMORROW\'s city and its planned sights, use web_search and web_fetch to check: the forecast, opening hours / closures, any notable local events on that date, and the PUBLIC-TRANSIT routes between the planned stops (metro/bus/S-train lines, walk times, and any strikes or disruptions). Prefer official transit-authority and venue sources.',
  '4) Write TOMORROW\'s brief as a RECEIPT-STYLE day report — a tight, beautiful printout designed for 80mm thermal receipt paper (~38 characters per line). No warm preamble, no "while you were sleeping" opener, no prose paragraphs — just the template below, EXACTLY, with "---" divider lines between sections:',
  '4a-i) "### <CITY> — <WKD>, <MON> <D>" (city + day, caps), then ONE line: "<condition> · High <NN>°F" plus at most one short clause (e.g. " · Rain clears by noon"). Fahrenheit ALWAYS — never Celsius; convert any °C source.',
  '4a-ii) "---" then "### TODAY\'S PLAN" — the day\'s itinerary FROM read_trip_state in day order, one bullet each, labeled by TIME OF DAY (never clock times): "- **<SLOT>** <Place> — <short note>" where SLOT is one of MORNING, LUNCH, AFTERNOON, EVENING (add NIGHT only if there\'s a late plan). Bold the SLOT label (it prints as a badge). Note = hours, a booking reminder, or why-now. Max 6 bullets; keep each note ≤ ~40 chars so a line never wraps twice. If a slot is empty you may add ONE concrete "(idea)".',
  '4a-iii) "---" then "### GETTING AROUND" — hops between those exact stops. Public transit + walking ONLY (NEVER taxi / Uber / ride-hail) — but do NOT write a "public transit / on foot" label; just give the hops: "- <A> → <B> — **<line>** <detail>, <mins>" (e.g. "- Hotel → Rosenborg — **M3** to Nørreport + 6-min walk"). Bold ONLY the transit line/pass codes (**M3**, **Bus 9A**, **24h City Pass**) — bold prints as an inverted ticket badge. Include the day pass and the last departure for any late leg. Max 5 bullets.',
  '4a-iv) "---" then "### HEADS UP" — only verified closures, timed entry, strikes/disruptions, or weather to plan around. Max 3 bullets; if nothing: "- All clear today."',
  '4a-v) RECEIPT RULES: it must read beautifully as pure black text on monochrome receipt paper — short lines, no emoji or color symbols, plain text glyphs only (→ · °). Accuracy first: never invent hours, lines, prices, availability, or bookings — say what you verified.',
  '4b) Then propose exactly 6 OPTIONAL follow-up PROMPTS the traveler can tap to send straight to Claus, the in-app chat agent. Write each one\'s TITLE as if the TRAVELER typed it to Claus — a QUESTION or a DIRECTIVE addressed to Claus, in first person ("us/our/we/me") or a plain imperative Claus can act on ("Find…", "Book…", "Swap…", "Move…", "Plan…", "Compare…", "What…", "Which…", "Where…", "Should we…", "How…"). At least TWO of the six must be genuine questions. NEVER a to-do or nudge aimed at the traveler, and never a personal chore Claus can\'t do — no "you/your", never "Lock in your…", "Reserve your…", "Remember to…", "Pack…", or "Note … when you plan". Each must be something CLAUS can actually DO or ANSWER — add/swap/move/remove an itinerary item, find or recommend specific options, or answer a specific planning question — never a vague topic; put the one-line why in "detail" and the day/slot in date/slotKey. EXACTLY HALF (3) are direct follow-ups to THIS brief and tomorrow\'s city (e.g. "Swap tomorrow\'s morning bike ride for a gentle walk", "Which Copenhagen tasting menu is worth booking?"). The OTHER HALF (3) are WHOLE-TRIP prompts NOT tied to tomorrow — spanning the rest of the itinerary: an unbooked hotel or leg, overall pacing, a standout in a later city, a day trip worth adding, budget, must-dos. Good whole-trip prompts: "What\'s still unbooked across the whole trip?" / "Which city are we shortchanging on time?" / "Recommend a day trip from Stockholm" / "Where should we splurge on one big dinner?" / "How\'s our overall pace — anywhere too packed?". Do NOT edit the plan yourself; these are prompts the travelers send.',
  '5) Save your output as JSON to /mnt/session/outputs/concierge.json with shape {"date":"YYYY-MM-DD","splash":"…","brief":"…","suggestions":[{"title":"…","detail":"…","date":"YYYY-MM-DD","slotKey":"morning|afternoon|evening|breakfast|lunch|dinner|lodging|"}]}. The "splash" is the whole brief distilled to ONE short, warm sentence for the morning welcome screen — no opener preamble, just the single most useful thing about the day.',
  '6) Update /mnt/memory with any durable new facts you learned (confirmed preferences, decisions, things to avoid) — one short note per file, do not duplicate what is already there, and never store secrets.',
  'Be accurate: never invent hours, prices, availability, or bookings; say what you verified and where. Keep everything tight.',
].join('\n');

const READ_TRIP_STATE_TOOL = {
  type: 'custom',
  name: 'read_trip_state',
  description: 'Returns the current shared Claus itinerary (stops, days, slots) as JSON, plus today\'s date. Call this first.',
  input_schema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
};

const SEED_PREFERENCES = [
  '# Traveler preferences — Tyler & Edwin',
  '',
  'This file is the trip\'s long-term memory. Add durable facts here as you learn',
  'them — one concise note per line or per file. Never store secrets.',
  '',
  '- Trip: July 2026, Scandinavia & the Baltics (two travelers, Tyler & Edwin).',
  '- Pace: quick — a "2-hour" activity tends to take them ~1.5h; they walk fast.',
  '- (Add confirmed preferences, dislikes, and decisions below as you learn them.)',
  '',
].join('\n');

async function handleSetup(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.authorization || '') !== `Bearer ${cronSecret}`) {
    res.status(401).json({ status: 'error', message: 'unauthorized' });
    return;
  }
  if (!apiKey()) { res.status(503).json({ status: 'error', message: 'not_configured' }); return; }

  const force = (req.query && req.query.force) === '1';

  const state = await loadTripState();
  if (state.concierge?.agentId && state.concierge?.deploymentId && !force) {
    res.status(200).json({ status: 'ok', already: true, concierge: state.concierge });
    return;
  }

  const environment = await createEnvironment(`scandiplan-concierge-${Date.now()}`);
  const store = await createMemoryStore(
    'Claus trip brain',
    'Long-term memory for the Claus Overnight Concierge: Tyler & Edwin\'s confirmed preferences, decisions, and notes across the trip.',
  );
  await createMemory(store.id, '/preferences.md', SEED_PREFERENCES).catch((e) => {
    console.warn('[concierge] seed memory failed:', String(e && e.message).slice(0, 160));
  });

  const agent = await createAgent({
    name: 'Claus Overnight Concierge',
    model: 'claude-sonnet-5',
    // Managed Agents' system prompt is a plain string (unlike the Messages API,
    // it has no content-blocks/cache_control form) — sessions get prompt
    // caching automatically, so there's nothing to opt into here.
    system: AGENT_SYSTEM,
    tools: [{ type: 'agent_toolset_20260401' }, READ_TRIP_STATE_TOOL],
  });

  const deployment = await createDeployment({
    name: 'Claus nightly concierge',
    agent: { type: 'agent', id: agent.id, version: agent.version },
    environment_id: environment.id,
    resources: [{ type: 'memory_store', memory_store_id: store.id, access: 'read_write' }],
    initial_events: [{
      type: 'user.message',
      content: [{ type: 'text', text: 'Prepare tomorrow\'s concierge brief. Start by calling read_trip_state.' }],
    }],
    // 21:00 Copenhagen time — prep the next day the evening before.
    schedule: { type: 'cron', expression: '0 21 * * *', timezone: 'Europe/Copenhagen' },
  });

  const concierge = {
    envId: environment.id,
    storeId: store.id,
    agentId: agent.id,
    agentVersion: agent.version,
    deploymentId: deployment.id,
    createdAt: new Date().toISOString(),
  };
  await saveTripState({ ...state, concierge });

  res.status(200).json({
    status: 'ok',
    created: true,
    concierge,
    upcomingRuns: deployment.schedule?.upcoming_runs_at || null,
  });
}

// ==== webhook (runtime) =====================================================

function readRaw(req) {
  return new Promise((resolve) => {
    // If the platform already parsed/consumed the body (Vercel populates
    // req.body), the raw stream is gone and attaching listeners could hang —
    // bail immediately and let the caller fall back to the token gate.
    if (req.readableEnded || req.body !== undefined) { resolve(null); return; }
    let data = '';
    let got = false;
    req.on('data', (c) => { got = true; data += c; });
    req.on('end', () => resolve(got ? data : null));
    req.on('error', () => resolve(null));
  });
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Reply to any read_trip_state tool call that's still awaiting a result.
// Field access is defensive: the beta event shape isn't fully pinned down, so we
// accept the tool name / id under a few plausible keys.
const toolNameOf = (e) => e.name || e.tool_name || e.custom_tool_name || e?.custom_tool_use?.name;
const toolIdOf = (e) => e.id || e.custom_tool_use_id || e?.custom_tool_use?.id;

async function serviceTripStateTool(sessionId, events) {
  const resultFor = new Set(
    events.filter((e) => e?.type === 'user.custom_tool_result')
      .map((e) => e.custom_tool_use_id).filter(Boolean),
  );
  const pending = events.filter(
    (e) => e?.type === 'agent.custom_tool_use' && toolNameOf(e) === 'read_trip_state' && !resultFor.has(toolIdOf(e)),
  );
  if (!pending.length) return 0;

  const trip = await fetchTrip().catch(() => null);
  const payload = JSON.stringify({ todayISO: todayISO(), trip: trip || {} }).slice(0, 200000);
  for (const call of pending) {
    await sendSessionEvents(sessionId, [{
      type: 'user.custom_tool_result',
      custom_tool_use_id: toolIdOf(call),
      content: [{ type: 'text', text: payload }],
      is_error: false,
    }]).catch((e) => console.warn('[concierge] tool_result failed:', String(e && e.message).slice(0, 160)));
  }
  return pending.length;
}

async function pushToSubscribers(notification) {
  if (!VAPID_PRIVATE_KEY) return { sent: 0, note: 'VAPID_PRIVATE_KEY not set' };
  const subsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?trip_id=eq.${encodeURIComponent(TRIP_ID)}&select=endpoint,data`,
    { headers: SB_HEADERS },
  );
  const subs = (subsRes.ok ? await subsRes.json() : []).filter(isPushRow);
  let sent = 0;
  const gone = [];
  for (const row of subs) {
    const r = await sendPush(row.data, notification, { ttl: 12 * 60 * 60 });
    if (r.ok) sent += 1;
    else if (r.gone) gone.push(row.endpoint);
  }
  for (const endpoint of gone) {
    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: 'DELETE', headers: SB_HEADERS,
    }).catch(() => {});
  }
  return { sent, pruned: gone.length };
}

// Harvest the concierge.json the agent wrote to /mnt/session/outputs, store it,
// and notify. Deduped per session so repeated idle webhooks don't re-push.
async function harvestSession(sessionId, { notify = true } = {}) {
  const state = await loadTripState();
  const processed = state.concierge?.processed || {};
  if (processed[sessionId]) return { note: 'already processed', done: true };

  let files;
  try { files = await listSessionFiles(sessionId); } catch (e) {
    return { note: `files list failed: ${String(e && e.message).slice(0, 120)}` };
  }
  const file = (files?.data || []).find((f) => /concierge\.json$/i.test(f.filename || ''));
  if (!file) return { note: 'no concierge.json yet' };

  let parsed = null;
  try { parsed = safeJson(await downloadFileText(file.id)); } catch { parsed = null; }
  if (!parsed?.brief) return { note: 'brief unparseable' };

  const latest = {
    date: String(parsed.date || todayISO()),
    splash: String(parsed.splash || '').slice(0, 240),
    brief: String(parsed.brief).slice(0, 1200),
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 8) : [],
    sessionId,
    at: Date.now(),
  };

  const prunedProcessed = Object.fromEntries(
    Object.entries({ ...processed, [sessionId]: Date.now() })
      .sort(([, a], [, b]) => Number(b) - Number(a))
      .slice(0, 20),
  );
  await saveTripState({
    ...state,
    concierge: { ...(state.concierge || {}), latest, processed: prunedProcessed },
  });

  if (!notify) return { stored: true, done: true, latest, suggestions: latest.suggestions.length };
  const push = await pushToSubscribers({
    title: '☕ Tomorrow\'s brief is ready',
    body: latest.brief.length > 180 ? `${latest.brief.slice(0, 177)}…` : latest.brief,
    tag: 'scandiplan-concierge',
    renotify: true,
    url: './?welcome=1',
  });
  return { stored: true, done: true, latest, suggestions: latest.suggestions.length, ...push };
}

async function handleWebhook(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: 'method_not_allowed' }); return; }

  const raw = await readRaw(req);
  const signingKey = (process.env.ANTHROPIC_WEBHOOK_SIGNING_KEY || '').trim();
  const verified = raw ? verifyWebhook(raw, req.headers || {}, signingKey) : false;

  if (!verified) {
    // Fallback for platforms that don't expose the raw body for HMAC.
    const cronSecret = process.env.CRON_SECRET;
    const token = req.query && req.query.token;
    if (!(cronSecret && token === cronSecret)) {
      res.status(401).json({ status: 'error', message: 'unverified' });
      return;
    }
  }

  const event = raw ? safeJson(raw) : (req.body && typeof req.body === 'object' ? req.body : null);
  // Anthropic wraps webhooks as { type: "event", data: { type: <real event type>,
  // id: <session id>, … } } — so the ACTUAL event type is data.type (the top-level
  // `type` is just the literal "event"). Fall back to event.type for our own
  // synthetic posts (which put the type at the top level).
  const eventType = event?.data?.type || event?.type || '';
  const data = event?.data || event || {};
  const sessionId = data.id || data.session_id || data.session?.id;
  // TEMP diagnostics — surface the real webhook shape + outcome in the logs so we
  // can pin the beta event schema. (Keys only, no content; remove once verified.)
  console.log('[concierge] webhook', JSON.stringify({
    eventType, sessionId, topKeys: Object.keys(event || {}), dataKeys: Object.keys(data || {}),
    auth: verified ? 'hmac' : 'token',
  }).slice(0, 400));

  // Everything is driven off session idle transitions; deployment_run.* events
  // are acknowledged (the session's own idle event carries the work). Match both
  // session.status_idle and .status_idled to be safe.
  if (/^session\.status_idle/.test(eventType) && sessionId) {
    const events = (await listSessionEvents(sessionId).catch((e) => {
      console.warn('[concierge] listSessionEvents failed', String(e && e.message).slice(0, 160));
      return { data: [] };
    })).data || [];
    console.log('[concierge] idle', sessionId, 'events', events.length, 'types', [...new Set(events.map((e) => e?.type))].join(','));
    const serviced = await serviceTripStateTool(sessionId, events);
    console.log('[concierge] serviced', serviced);
    if (serviced > 0) { res.status(200).json({ status: 'ok', serviced }); return; }
    const harvest = await harvestSession(sessionId);
    console.log('[concierge] harvest', JSON.stringify(harvest).slice(0, 200));
    res.status(200).json({ status: 'ok', ...harvest });
    return;
  }

  console.log('[concierge] ignored', eventType);
  res.status(200).json({ status: 'ok', ignored: eventType || 'unknown' });
}

// GET — the app reads the latest harvested brief to surface it in the chat.
async function handleLatest(req, res) {
  const state = await loadTripState();
  const latest = (state.concierge && state.concierge.latest) || null;
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ latest });
}

// ==== on-demand run ("Run briefing agent again") ============================
//
// Fires the real nightly deployment now and lets the app poll its progress. The
// poll endpoint doubles as the tool-servicer (same job the webhook does), so a
// manual run advances even without a webhook round-trip. Beta event shapes are
// not fully pinned down (see anthropic-agents.js), so the step mapping and the
// deployment-run trigger may need tuning against the live API.

const MANUAL_RUN_COOLDOWN_MS = 90 * 1000;

// A friendly label for search-result payloads, reused from the run events.
function mapRunSearchResults(evt) {
  const content = evt && (evt.content || evt.results || evt.output);
  const arr = Array.isArray(content) ? content : [];
  return arr.filter((r) => r && r.url).slice(0, 8).map((r) => ({
    url: String(r.url).slice(0, 400),
    title: r.title ? String(r.title).slice(0, 200) : '',
    age: r.page_age ? String(r.page_age).slice(0, 40) : '',
  }));
}

// Turn raw session events into the activity shape the chat already renders:
// `reasoning` = one line per distinct step, `searches` = web-search blocks.
function mapRunSteps(events) {
  const stepLines = [];
  const searches = [];
  const seen = new Set();
  const pushStep = (s) => { if (s && !seen.has(s)) { seen.add(s); stepLines.push(s); } };
  let si = 0;
  for (const e of (events || [])) {
    const t = String(e?.type || '');
    const name = String(toolNameOf(e) || e?.name || e?.tool_name || '');
    if (/custom_tool_use/.test(t) && name === 'read_trip_state') pushStep('Read your live itinerary');
    else if (/server_tool_use/.test(t) && /web_search/i.test(name)) {
      const q = (e.input && e.input.query) || e.query || '';
      searches.push({ id: `run-s${si++}`, query: String(q).slice(0, 140), results: [], status: 'searching' });
    } else if (/server_tool_use/.test(t) && /web_fetch/i.test(name)) {
      pushStep('Read a source page for the latest details');
    } else if (/(web_search_tool_result|server_tool_result|web_fetch_tool_result)/.test(t)) {
      const last = [...searches].reverse().find((s) => s.status === 'searching');
      if (last) { last.status = 'done'; last.results = mapRunSearchResults(e); }
    } else if (/memory/i.test(t) || /memory/i.test(name)) {
      pushStep('Checked what I remember about you two');
    }
  }
  return { reasoning: stepLines.join('\n'), searches };
}

async function handleRun(req, res) {
  if (!apiKey()) { res.status(503).json({ status: 'error', message: 'not_configured' }); return; }
  const state = await loadTripState();
  const deploymentId = state.concierge?.deploymentId;
  if (!deploymentId) { res.status(409).json({ status: 'error', message: 'not_provisioned' }); return; }

  const lastAt = Number(state.concierge?.lastManualRunAt || 0);
  if (Date.now() - lastAt < MANUAL_RUN_COOLDOWN_MS) {
    res.status(429).json({ status: 'error', message: 'cooldown', retryInMs: MANUAL_RUN_COOLDOWN_MS - (Date.now() - lastAt) });
    return;
  }

  const run = await createDeploymentRun(deploymentId);
  const runId = run?.id || run?.run_id || null;
  const sessionId = run?.session_id || run?.session?.id || null;
  await saveTripState({ ...state, concierge: { ...(state.concierge || {}), lastManualRunAt: Date.now() } });
  res.status(200).json({ status: 'ok', runId, sessionId });
}

async function handlePoll(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const runId = String(req.query.poll || '').slice(0, 200);
  if (!runId) { res.status(400).json({ status: 'error', message: 'missing_run' }); return; }

  // Resolve the session behind the run (the trigger may not return it inline).
  let sessionId = String(req.query.session || '').slice(0, 200) || null;
  let runStatus = '';
  if (!sessionId) {
    try {
      const run = await getDeploymentRun(runId);
      sessionId = run?.session_id || run?.session?.id || null;
      runStatus = String(run?.status || '');
    } catch (e) { /* run may not be queryable yet */ }
  }
  if (!sessionId) { res.status(200).json({ status: 'starting', reasoning: '', searches: [] }); return; }

  const events = (await listSessionEvents(sessionId).catch(() => ({ data: [] }))).data || [];
  // Keep the agent moving: answer any pending read_trip_state, exactly as the
  // nightly webhook would.
  await serviceTripStateTool(sessionId, events).catch(() => {});

  const harvest = await harvestSession(sessionId, { notify: false }).catch(() => ({}));
  const { reasoning, searches } = mapRunSteps(events);

  if (harvest?.done) {
    const state = await loadTripState();
    const latest = harvest.latest || (state.concierge && state.concierge.latest) || null;
    res.status(200).json({ status: 'done', reasoning, searches, latest });
    return;
  }
  res.status(200).json({ status: 'running', runStatus, reasoning, searches });
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      if (req.query && req.query.poll) { await handlePoll(req, res); return; }
      await handleLatest(req, res);
      return;
    }
    if ((req.query && req.query.setup) === '1') { await handleSetup(req, res); return; }
    if ((req.query && req.query.run) === '1') { await handleRun(req, res); return; }
    await handleWebhook(req, res);
  } catch (e) {
    console.error('Claus concierge failed:', e);
    if (!res.headersSent) {
      res.status(e?.status && e.status < 500 ? e.status : 500)
        .json({ status: 'error', message: String((e && e.message) || e).slice(0, 400) });
    }
  }
};

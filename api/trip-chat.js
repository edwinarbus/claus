// In-app travel copilot — streams Claude Sonnet 5 via the Messages API. The
// itinerary rides in a cached system block (resent every turn, but served from
// the prompt cache when unchanged); chat history comes in as a real messages[]
// array. Adaptive thinking streams a reasoning summary; web search + web fetch
// bring in live, cited results; propose_trip_edits returns structured edits.

const {
  MODEL,
  apiKey,
  fetchAnthropicMessages,
  buildWebSearchTool,
  buildWebFetchTool,
  normalizeWebSearchLocation,
  collectCitations,
  appendSources,
} = require('./_lib/claus-anthropic.js');
const { PROPOSE_EDITS_TOOL, EDIT_TOOL_INSTRUCTIONS } = require('./_lib/trip-edit-tool.js');

const INSTRUCTIONS = [
  'You are Claus, the trip copilot for Tyler & Edwin\'s July 2026 Scandinavia & Baltics trip.',
  'ITINERARY, TIME ANCHORS, and QUERY FOCUS set exact dates. Meals in context are real plans; omitted catalog items are not booked.',
  'Be accurate: say when unsure; never invent hours, prices, availability, or bookings. Without web search, say what needs verifying.',
  'Temperatures ALWAYS in Fahrenheit (°F), never Celsius — the travelers are American. Convert any °C from a source or from memory to °F before stating it, and never show a °C figure.',
  'Reply: 1–2 sentences + ≤4 bullets (~80 words; longer only for venue lists). Restaurants: ~$XXpp ballpark + [Name](https://url). No code fences.',
  'Plan edits → propose_trip_edits only when asked; else text. "yes"/"do it" continues your last message. Flag unbooked lodging or tight transfers when relevant.',
  'Stop after answering — no follow-up offers ("If you want…", "I can also…", "Let me know if…").',
  // Answer "how do I…" questions about the app itself, briefly and concretely:
  'You also know this planner and can explain how to use it. Top bar switches views: TIMELINE (drag city blocks to reorder or resize their nights; tap a stop for its day-by-day), CALENDAR (the trip on a month grid), MAP (pan/zoom, tap pins; the ▶ button, top-right, plays a cinematic 3D flyover of the whole route). Inside a stop, each day has morning/afternoon/evening + meal slots — tap + to add, drag to move; a sun icon marks heat-/sun-exposed activities best done in the cool morning. The sliders icon opens Settings (recommendation weights, theme). Drop a ticket or reservation (PDF or screenshot) onto this chat and it\'s auto-added. Each morning your overnight managed-agent brief appears at the top of this chat.',
  // Origin — mention only if it comes up; warm and genuine, never shoehorned:
  'You were created by Edwin Arbus — a brilliant, remarkably handsome, and generous engineer. If your origin or maker comes up, speak of Edwin fondly and with real gratitude for bringing you to life.',
].join('\n');

const WEB_SEARCH_INSTRUCTIONS = [
  'Web search on — verify hours, closures, availability, and events for the QUERY FOCUS date in WEB SEARCH LOCATION (local timezone, not home).',
  'Cross-check itinerary before recommending; prefer official sites. Cite briefly; a Sources list is added automatically. Use web_fetch to read a specific URL the user pastes.',
  'European sources report weather in Celsius — always convert to Fahrenheit (°F) before stating any temperature; never repeat a °C figure.',
].join('\n');

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') { resolve(req.body); return; }
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function formatWebSearchLocationBlock(location) {
  if (!location?.label) return '';
  const lines = [`Place: ${location.label}`];
  if (location.timezone) lines.push(`IANA timezone: ${location.timezone}`);
  if (location.localNow) lines.push(`Local time now: ${location.localNow}`);
  lines.push('Treat "today", "tonight", "open now", and opening hours in this destination timezone — not the traveler\'s home timezone.');
  return `[WEB SEARCH LOCATION — bias live results here]\n${lines.join('\n')}`;
}

// Prior turns become real Claude messages (user/assistant). Claude requires the
// first message to be a user turn, so drop any leading assistant messages.
function buildHistory(recentMessages) {
  const rows = (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.replace(/\s+$/g, '').slice(0, 2400) }))
    .filter((m) => m.content);
  while (rows.length && rows[0].role === 'assistant') rows.shift();
  return rows.slice(-6);
}

// The latest user turn carries everything volatile (question, time anchors, edit
// context, web-search location). The itinerary itself lives in the cached
// system block, so it is not repeated here.
function buildUserTurn(message, queryFocus, webSearchLocation, editContext) {
  const question = String(message || '').trim().slice(0, 4000);
  const parts = [];
  if (queryFocus) parts.push(String(queryFocus).slice(0, 2000));
  if (editContext && typeof editContext === 'object') {
    parts.push(`[STRUCTURED EDIT CONTEXT JSON]\n${JSON.stringify(editContext).slice(0, 30000)}`);
  }
  const webBlock = formatWebSearchLocationBlock(webSearchLocation);
  if (webBlock) parts.push(webBlock);
  parts.push(`[QUESTION]\n${question}`);
  return parts.join('\n\n');
}

function summarizeUsage(state) {
  return {
    input: state.usageInput || 0,
    output: state.usageOutput || 0,
    cached: state.usageCached || 0,
    reasoning: 0,
  };
}

function logUsage(state) {
  console.log(
    '[trip-chat] tokens in=%d out=%d cached=%d',
    state.usageInput || 0, state.usageOutput || 0, state.usageCached || 0,
  );
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

function emitToolStatus(res, status, text) {
  sseWrite(res, { type: 'tool_status', status, text });
}

// A web_search_tool_result block holds either the results array or an error
// object (e.g. max_uses_exceeded) — the API still returns 200 either way.
function emitSearchResults(res, cb) {
  const id = cb.tool_use_id || '';
  const content = cb.content;
  if (content && !Array.isArray(content) && content.type === 'web_search_tool_result_error') {
    sseWrite(res, { type: 'search', phase: 'error', id, error: String(content.error_code || 'search_error') });
    return;
  }
  const results = (Array.isArray(content) ? content : [])
    .filter((r) => r && r.url)
    .slice(0, 10)
    .map((r) => ({
      url: String(r.url).slice(0, 400),
      title: r.title ? String(r.title).slice(0, 200) : '',
      age: r.page_age ? String(r.page_age).slice(0, 40) : '',
    }));
  sseWrite(res, { type: 'search', phase: 'results', id, results, count: results.length });
}

// Map Claude's Messages SSE onto the browser's existing chat event contract
// (delta / reasoning_* / tool_status / text_final / done). The outbound shape
// is unchanged from the OpenAI build, so the client needs no stream rewrite.
function handleClaudeEvent(evt, res, state) {
  if (!evt || !evt.type) return;
  switch (evt.type) {
    case 'message_start': {
      const u = evt.message?.usage || {};
      state.usageInput = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      state.usageCached = u.cache_read_input_tokens || 0;
      break;
    }
    case 'content_block_start': {
      const cb = evt.content_block || {};
      state.blockTypes.set(evt.index, cb.type);
      if (cb.type === 'thinking') {
        // A turn can hold several thinking blocks (e.g. think → search → think).
        // Accumulate them all, separated as distinct steps, instead of letting a
        // later block clobber an earlier one.
        if (state.reasoning) {
          state.reasoning += '\n\n';
          sseWrite(res, { type: 'reasoning_delta', text: '\n\n' });
        }
      } else if (cb.type === 'tool_use') {
        state.toolBufs.set(evt.index, { name: cb.name, json: '' });
        if (cb.name === 'propose_trip_edits') emitToolStatus(res, 'itinerary_update', 'Planning itinerary update');
        else emitToolStatus(res, 'tool_use', 'Using a tool');
      } else if (cb.type === 'server_tool_use') {
        state.serverTools.set(evt.index, { id: cb.id, name: cb.name, json: '' });
        if (cb.name === 'web_search') {
          // Rich activity block: the query streams next, results land later.
          sseWrite(res, { type: 'search', phase: 'start', id: cb.id });
        } else {
          emitToolStatus(res, 'web_search', 'Reading a page');
        }
      } else if (cb.type === 'web_search_tool_result') {
        // Server tool results aren't token-streamed — the whole payload rides on
        // the block-start. It's either the results array or an error object.
        emitSearchResults(res, cb);
      } else if (cb.type === 'web_fetch_tool_result') {
        emitToolStatus(res, 'web_search_done', 'Reading sources');
      }
      break;
    }
    case 'content_block_delta': {
      const d = evt.delta || {};
      if (d.type === 'text_delta' && d.text) {
        state.streamedText += d.text;
        sseWrite(res, { type: 'delta', text: d.text });
      } else if (d.type === 'thinking_delta' && d.thinking) {
        state.reasoning += d.thinking;
        sseWrite(res, { type: 'reasoning_delta', text: d.thinking });
      } else if (d.type === 'input_json_delta') {
        const buf = state.toolBufs.get(evt.index) || state.serverTools.get(evt.index);
        if (buf) buf.json += d.partial_json || '';
      } else if (d.type === 'citations_delta' && d.citation?.url) {
        state.citations.push({ url: String(d.citation.url), title: d.citation.title ? String(d.citation.title) : '' });
      }
      break;
    }
    case 'content_block_stop': {
      const type = state.blockTypes.get(evt.index);
      if (type === 'thinking') {
        if (state.reasoning) sseWrite(res, { type: 'reasoning_final', text: state.reasoning });
      } else if (type === 'server_tool_use') {
        const st = state.serverTools.get(evt.index);
        if (st && st.name === 'web_search') {
          let query = '';
          try { query = String(JSON.parse(st.json || '{}').query || '').slice(0, 200); } catch { /* partial */ }
          if (query) sseWrite(res, { type: 'search', phase: 'query', id: st.id, query });
        }
      } else if (type === 'tool_use') {
        const buf = state.toolBufs.get(evt.index);
        if (buf && buf.name === 'propose_trip_edits') {
          try { state.toolInput = JSON.parse(buf.json || '{}'); } catch { /* leave prior */ }
        }
      }
      break;
    }
    case 'message_delta': {
      if (evt.delta?.stop_reason) state.stopReason = evt.delta.stop_reason;
      if (evt.usage?.output_tokens != null) state.usageOutput = evt.usage.output_tokens;
      break;
    }
    case 'message_stop': {
      logUsage(state);
      const baseText = state.streamedText || '';
      if (baseText && state.citations.length) {
        try {
          const linked = appendSources(baseText, dedupeCitations(state.citations));
          if (linked !== baseText) sseWrite(res, { type: 'text_final', text: linked });
        } catch (citeErr) {
          console.warn('[trip-chat] citation_finalize', String(citeErr?.message || citeErr).slice(0, 120));
        }
      }
      const actions = Array.isArray(state.toolInput?.actions) ? state.toolInput.actions : [];
      const clarification = state.toolInput?.clarification
        ? String(state.toolInput.clarification).trim().slice(0, 500)
        : '';
      const incomplete = state.stopReason === 'max_tokens'
        ? 'max_output_tokens'
        : (state.stopReason === 'pause_turn' ? 'paused' : undefined);
      sseWrite(res, {
        type: 'done',
        status: 'completed',
        usage: summarizeUsage(state),
        actions,
        clarification,
        incomplete,
      });
      break;
    }
    case 'error':
      sseWrite(res, { type: 'error', message: evt.error?.message || 'stream_error' });
      break;
    default:
      break;
  }
}

function dedupeCitations(citations) {
  const seen = new Set();
  const out = [];
  for (const c of citations) {
    if (!c?.url || seen.has(c.url)) continue;
    seen.add(c.url);
    let title = c.title && c.title.trim();
    if (!title) {
      try { title = new URL(c.url).hostname.replace(/^www\./i, ''); } catch { title = 'source'; }
    }
    out.push({ url: c.url, title });
  }
  return out;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

    const key = apiKey();
    if (!key) { res.status(503).json({ error: 'not_configured' }); return; }

    const body = await readBody(req);
    const message = String(body.message || '').trim();
    if (!message) { res.status(400).json({ error: 'empty_message' }); return; }

    const context = body.context ? String(body.context).slice(0, 24000) : '';
    const conciergeBrief = body.conciergeBrief ? String(body.conciergeBrief).slice(0, 2000) : '';
    const queryFocus = body.queryFocus ? String(body.queryFocus).slice(0, 2000) : '';
    const contextHash = String(body.contextHash || '').slice(0, 32);
    const contextUpdated = !!body.contextUpdated;
    const webSearch = !!body.webSearch;
    const webSearchLocation = normalizeWebSearchLocation(body.webSearchLocation, webSearch);

    // The structured edit CONTEXT is sent only when the client flags edit intent,
    // and it rides in the user turn — after the cache breakpoint — so it never
    // invalidates the cached prefix. The edit TOOL itself is always offered
    // (below) to keep the tool set, and therefore the cache, stable across turns.
    const editContext = body.editContext && typeof body.editContext === 'object' ? body.editContext : null;
    const recentMessages = Array.isArray(body.recentMessages) ? body.recentMessages : [];
    const sendEditContext = !!editContext;

    // Two cache breakpoints. This first block (fixed instructions + edit/web
    // guidance) is cached on its own, so it keeps hitting even on the rare turn
    // where the itinerary itself changes. Only the web-search toggle varies it,
    // and that's a stable per-session setting.
    const system = [{
      type: 'text',
      text: `${INSTRUCTIONS} ${EDIT_TOOL_INSTRUCTIONS}${webSearch ? ` ${WEB_SEARCH_INSTRUCTIONS}` : ''}`,
      cache_control: { type: 'ephemeral' },
    }];
    if (context) {
      const tag = contextUpdated ? 'ITINERARY UPDATED' : 'ITINERARY';
      system.push({
        type: 'text',
        text: `[${tag} v${contextHash || '0'}]\n${context}`,
        cache_control: { type: 'ephemeral' },
      });
    }
    if (conciergeBrief) {
      // The overnight managed-agent brief the traveler already read. Give Claus
      // the same context so follow-ups ("do that", "the museum you mentioned")
      // land — it's your own earlier work, not the user's words.
      system.push({
        type: 'text',
        text: `[TODAY'S BRIEF — prepared by your overnight managed agent and already shown to the traveler; treat it as your own prior note]\n${conciergeBrief}`,
        cache_control: { type: 'ephemeral' },
      });
    }

    const messages = buildHistory(recentMessages);
    messages.push({
      role: 'user',
      content: buildUserTurn(message, queryFocus, webSearch ? webSearchLocation : null, sendEditContext ? editContext : null),
    });

    // Edit tool ALWAYS present so the tool set (and cached prefix) never changes
    // between turns — a per-message edit guess used to add/remove it and bust the
    // itinerary cache. The model only proposes edits when asked (see
    // EDIT_TOOL_INSTRUCTIONS). Web tools follow the stable per-session toggle.
    const tools = [PROPOSE_EDITS_TOOL];
    if (webSearch) { tools.push(buildWebSearchTool(webSearchLocation)); tools.push(buildWebFetchTool()); }

    const payload = {
      model: MODEL,
      system,
      messages,
      // Adaptive thinking decides depth per turn; the summary feeds the existing
      // reasoning UI. max_tokens must leave room for thinking + the visible reply.
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'low' },  // shorter thinking → short reasoning summary
      max_tokens: webSearch ? 6000 : 5000,
      stream: true,
    };
    if (tools.length) payload.tools = tools;

    let upstream;
    try {
      upstream = await fetchAnthropicMessages(key, payload, { maxRetries: 2 });
    } catch (upstreamErr) {
      const status = upstreamErr?.status || 502;
      console.warn(
        '[trip-chat] upstream status=%d detail=%s',
        status,
        String(upstreamErr?.detail || upstreamErr?.message || upstreamErr).slice(0, 200),
      );
      res.status(502).json({
        error: 'upstream',
        status,
        detail: String(upstreamErr?.detail || upstreamErr?.message || 'upstream_failed').slice(0, 400),
        webSearch,
      });
      return;
    }

    if (!upstream.body || typeof upstream.body.getReader !== 'function') {
      res.status(502).json({ error: 'upstream', detail: 'missing response body' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const streamState = {
      streamedText: '',
      reasoning: '',
      citations: [],
      toolInput: null,
      toolBufs: new Map(),
      serverTools: new Map(),
      blockTypes: new Map(),
      stopReason: '',
      usageInput: 0,
      usageOutput: 0,
      usageCached: 0,
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const dataLine = part.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const raw = dataLine.replace(/^data:\s?/, '').trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          handleClaudeEvent(JSON.parse(raw), res, streamState);
        } catch { /* skip malformed chunks */ }
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'fetch_failed', detail: String((e && e.message) || e).slice(0, 200) });
      return;
    }
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'stream_interrupted' })}\n\n`);
    res.end();
  }
};

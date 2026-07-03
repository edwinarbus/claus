// Claus agent endpoint — proposes structured itinerary edits via a forced tool
// call on the Claude Messages API. Prefer the unified trip-chat stream
// (propose_trip_edits tool). This route remains for direct agent-only calls.

const {
  MODEL,
  apiKey,
  fetchAnthropicMessages,
  extractToolInput,
} = require('./_lib/claus-anthropic.js');
const { PROPOSE_EDITS_TOOL, EDIT_TOOL_INSTRUCTIONS } = require('./_lib/trip-edit-tool.js');

const INSTRUCTIONS = [
  'You are Claus, the agentic trip assistant for Tyler & Edwin.',
  EDIT_TOOL_INSTRUCTIONS,
  'Use TIME ANCHORS and QUERY FOCUS as authoritative for today, tonight, tomorrow, Sunday, etc.',
  'Stop after answering — no follow-up offers ("If you want…", "I can also…", "Let me know if…").',
].join(' ');

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') { resolve(req.body); return; }
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function buildHistory(messages) {
  const rows = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1600) }))
    .filter((m) => m.content);
  while (rows.length && rows[0].role === 'assistant') rows.shift();
  return rows.slice(-8);
}

function buildUserTurn(body) {
  const parts = [];
  if (body.queryFocus) parts.push(String(body.queryFocus).slice(0, 2400));
  if (body.editContext) {
    parts.push(`[STRUCTURED EDIT CONTEXT JSON]\n${JSON.stringify(body.editContext).slice(0, 30000)}`);
  }
  parts.push(`[USER MESSAGE]\n${String(body.message || '').trim().slice(0, 4000)}`);
  return parts.join('\n\n');
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

    const key = apiKey();
    if (!key) { res.status(503).json({ error: 'not_configured' }); return; }

    const body = await readBody(req);
    const message = String(body.message || '').trim();
    if (!message) { res.status(400).json({ error: 'empty_message' }); return; }

    // The itinerary rides in a cached system block; the plan text is always
    // resent so a stale history can't hide stops.
    const system = [{ type: 'text', text: INSTRUCTIONS }];
    if (body.context) {
      system.push({
        type: 'text',
        text: `[ITINERARY CONTEXT]\n${String(body.context).slice(0, 24000)}`,
        cache_control: { type: 'ephemeral' },
      });
    }

    const messages = buildHistory(body.messages);
    messages.push({ role: 'user', content: buildUserTurn(body) });

    const payload = {
      model: MODEL,
      system,
      messages,
      // Forced single-tool output — no thinking (extended thinking is not
      // compatible with a forced tool_choice).
      thinking: { type: 'disabled' },
      max_tokens: 4000,
      tools: [PROPOSE_EDITS_TOOL],
      tool_choice: { type: 'tool', name: 'propose_trip_edits' },
    };

    let r;
    try {
      r = await fetchAnthropicMessages(key, payload, { maxRetries: 2 });
    } catch (upstreamErr) {
      res.status(502).json({
        error: 'upstream',
        status: upstreamErr?.status || 502,
        detail: String(upstreamErr?.detail || upstreamErr?.message || 'upstream_failed').slice(0, 400),
      });
      return;
    }

    const data = await r.json();
    const input = extractToolInput(data, 'propose_trip_edits');
    const actions = Array.isArray(input?.actions) ? input.actions : [];
    const clarification = input?.clarification ? String(input.clarification).trim().slice(0, 500) : '';

    if (!actions.length && !clarification && !input) {
      res.status(502).json({ error: 'no_tool_output' });
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ reply: clarification, actions, clarification });
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({
        error: 'handler_failed',
        detail: String((e && e.message) || e).slice(0, 200),
      });
    }
  }
};

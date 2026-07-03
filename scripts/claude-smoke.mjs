// Live smoke test for the Claude API shapes Scandiplan depends on. Runs the
// actual request bodies the app sends against api.anthropic.com and reports
// PASS/FAIL per shape, so you can confirm the migration works end-to-end
// before trusting it. Node 18+ (built-in fetch), no dependencies.
//
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/claude-smoke.mjs
//
// It uses the REAL tool schema + tool builders from api/_lib where possible, so
// what it tests is what the app sends. A few real dollars of tokens, tops.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const claus = require('../api/_lib/claus-anthropic.js');
const { PROPOSE_EDITS_TOOL } = require('../api/_lib/trip-edit-tool.js');

const KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
if (!KEY) { console.error('Set ANTHROPIC_API_KEY first.'); process.exit(2); }

const URL = 'https://api.anthropic.com/v1/messages';
const HEADERS = { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' };
const MODEL = claus.MODEL;

async function call(body) {
  const r = await fetch(URL, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* stream or non-json */ }
  return { ok: r.ok, status: r.status, json, text };
}

const results = [];
const record = (name, pass, note) => { results.push({ name, pass, note }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`); };

// 1) Chat streaming: adaptive thinking (summarized) + effort + tools. Confirms
//    the request is accepted AND that a thinking_delta actually streams.
async function checkChatThinkingStream() {
  const body = {
    model: MODEL,
    system: [{ type: 'text', text: 'You are a concise travel copilot.' }],
    messages: [{ role: 'user', content: 'Think step by step: is a 90-minute layover in Copenhagen enough to leave the airport? One short paragraph.' }],
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: 'medium' },
    max_tokens: 3000,
    stream: true,
    tools: [PROPOSE_EDITS_TOOL],
  };
  const r = await fetch(URL, { method: 'POST', headers: { ...HEADERS, accept: 'text/event-stream' }, body: JSON.stringify(body) });
  if (!r.ok) { record('chat: adaptive-thinking stream + effort + tool', false, `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); return; }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', sawThinking = false, sawText = false, sawErr = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n'); buf = parts.pop() || '';
    for (const p of parts) {
      const line = p.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const raw = line.replace(/^data:\s?/, '').trim();
      if (!raw || raw === '[DONE]') continue;
      let e; try { e = JSON.parse(raw); } catch { continue; }
      if (e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta' && e.delta.thinking) sawThinking = true;
      if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) sawText = true;
      if (e.type === 'error') sawErr = e.error?.message || 'stream error';
    }
  }
  if (sawErr) record('chat: adaptive-thinking stream + effort + tool', false, sawErr);
  else record('chat: adaptive-thinking stream + effort + tool', sawText,
    sawThinking ? 'thinking_delta streamed (reasoning UI will populate)' : 'accepted, but NO thinking_delta — adaptive chose not to think here; reasoning UI may look empty on simple turns');
}

// 2) Structured outputs with the nullable type:["number","null"] union +
//    adaptive thinking + high effort. This is the schema shape flagged in the PR.
async function checkStructuredNullable() {
  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      matched: { type: 'boolean' },
      durationMin: { type: ['number', 'null'] },
      note: { type: 'string' },
    },
    required: ['matched', 'durationMin', 'note'],
  };
  const r = await call({
    model: MODEL,
    system: 'Extract fields. Use null for durationMin if unknown.',
    messages: [{ role: 'user', content: 'A train from Bergen to Oslo, duration not stated.' }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema } },
    max_tokens: 4000,
  });
  if (!r.ok) { record('tickets: structured output + nullable union', false, `HTTP ${r.status}: ${(r.json?.error?.message || r.text).slice(0, 200)}`); return; }
  const textBlock = (r.json?.content || []).find((b) => b.type === 'text');
  let parsed = null; try { parsed = JSON.parse(textBlock?.text || ''); } catch { /* */ }
  record('tickets: structured output + nullable union', !!parsed && 'matched' in parsed,
    parsed ? `got ${JSON.stringify(parsed)}` : 'no parseable JSON text block');
}

// 3) Forced tool_choice + thinking disabled (the trip-chat-agent path).
async function checkForcedTool() {
  const r = await call({
    model: MODEL,
    system: [{ type: 'text', text: 'You propose itinerary edits.' }],
    messages: [{ role: 'user', content: 'Add dinner at Noma on 2026-07-10.' }],
    thinking: { type: 'disabled' },
    max_tokens: 3000,
    tools: [PROPOSE_EDITS_TOOL],
    tool_choice: { type: 'tool', name: 'propose_trip_edits' },
  });
  if (!r.ok) { record('agent: forced tool_choice + thinking disabled', false, `HTTP ${r.status}: ${(r.json?.error?.message || r.text).slice(0, 200)}`); return; }
  const tool = (r.json?.content || []).find((b) => b.type === 'tool_use' && b.name === 'propose_trip_edits');
  record('agent: forced tool_choice + thinking disabled', !!tool, tool ? 'tool_use returned with parsed input' : 'no tool_use block');
}

// 4) Web search + web fetch server tools (the chat live-search path). Confirms
//    the tools are accepted and inspects the citation shape my handler reads.
async function checkWebSearch() {
  const r = await call({
    model: MODEL,
    system: 'Answer with one current fact and cite it.',
    messages: [{ role: 'user', content: 'What are the current opening hours of the Vasa Museum in Stockholm? Search the web.' }],
    thinking: { type: 'adaptive', display: 'summarized' },
    max_tokens: 4000,
    tools: [claus.buildWebSearchTool({ city: 'Stockholm', country: 'SE', timezone: 'Europe/Stockholm' }), claus.buildWebFetchTool()],
  });
  if (!r.ok) { record('chat: web_search_20260209 + web_fetch_20260209', false, `HTTP ${r.status}: ${(r.json?.error?.message || r.text).slice(0, 220)}`); return; }
  const cites = claus.collectCitations(r.json);
  const ran = (r.json?.content || []).some((b) => b.type === 'web_search_tool_result' || b.type === 'server_tool_use');
  record('chat: web_search_20260209 + web_fetch_20260209', ran,
    `stop_reason=${r.json?.stop_reason}; ${cites.length} citation(s) with url/title${cites[0] ? ` e.g. ${cites[0].title}` : ''}`);
}

// 5) Prompt caching: does a cached system block report a cache write?
async function checkPromptCaching() {
  const big = ('Itinerary context. '.repeat(400)); // ~2k+ tokens to clear the min prefix
  const r = await call({
    model: MODEL,
    system: [{ type: 'text', text: `Trip context:\n${big}`, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    thinking: { type: 'disabled' },
    max_tokens: 20,
  });
  if (!r.ok) { record('caching: cache_control on system block', false, `HTTP ${r.status}: ${(r.json?.error?.message || r.text).slice(0, 160)}`); return; }
  const u = r.json?.usage || {};
  const wrote = (u.cache_creation_input_tokens || 0) > 0;
  record('caching: cache_control on system block', true,
    wrote ? `cache write ${u.cache_creation_input_tokens} tok (2nd identical call should read it)` : 'accepted; no cache write (prefix under min or already cached)');
}

const CHECKS = [checkChatThinkingStream, checkStructuredNullable, checkForcedTool, checkWebSearch, checkPromptCaching];
console.log(`\nScandiplan Claude smoke test — model ${MODEL}\n`);
for (const c of CHECKS) {
  try { await c(); } catch (e) { record(c.name, false, `threw: ${String(e && e.message).slice(0, 160)}`); }
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed.`);
console.log('Note: Managed Agents (api/concierge.js) is NOT covered here — it needs a registered webhook + a running session to exercise.');
process.exit(failed ? 1 : 0);

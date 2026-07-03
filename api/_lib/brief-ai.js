// Natural-language copy via the Claude Messages API (non-streaming). Used by
// push morning briefs and the in-app welcome splash. Falls back to templates in
// brief.js when ANTHROPIC_API_KEY is unset or a call fails. Output shape is
// pinned with native structured outputs (output_config.format); thinking is off
// for these short copy tasks.

const {
  MODEL,
  apiKey,
  fetchAnthropicMessages,
  extractText,
} = require('./claus-anthropic.js');

const PUSH_INSTRUCTIONS = [
  'You write 6 AM lock-screen morning briefs for Tyler and Edwin\'s July 2026 Scandinavia/Baltics trip.',
  'Given the day\'s facts, return JSON with "title" and "body".',
  'title: ≤55 chars. "Day N in City" only — no weather (emoji and temp are appended automatically).',
  'body: 1–2 warm, conversational sentences, ≤200 chars about today\'s plan and any travel alert. No weather emoji, temperatures, or degree numbers.',
  'Use second person ("you"). No markdown, bullets, or app branding. Only use provided facts — do not invent bookings.',
].join(' ');

const SPLASH_INSTRUCTIONS = [
  'You write the opening summary for an in-app welcome screen for Tyler and Edwin\'s July 2026 Scandinavia/Baltics trip.',
  'Given the day\'s facts, return JSON with "summary".',
  'summary: exactly 2 warm, tour-guide sentences, ≤380 chars total. Sentence 1 sketches today\'s plan arc; sentence 2 weaves in weather and a gentle practical nudge.',
  'If facts say the screen was opened later in the day, focus only on remaining activities/meals. Do not mention omitted or past morning/afternoon slots.',
  'Use second person ("you"). No markdown, bullets, or app branding. Only use provided facts — do not invent bookings.',
  'Weather temps in facts are °F. If weather is marked "live forecast", treat it as today\'s real forecast; if "typical for this date", say it\'s the usual pattern, not a precise forecast.',
].join(' ');

const PUSH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['title', 'body'],
};

const SPLASH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
  },
  required: ['summary'],
};

function clamp(str, max) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trim()}…`;
}

// Build the Messages-API request body for a short structured-copy call. Shared
// with the Batch prewarm path (api/_lib/batch-brief.js) so both produce
// identical requests.
function briefRequestParams({ instructions, schema, facts, maxTokens }) {
  return {
    model: MODEL,
    system: instructions,
    messages: [{ role: 'user', content: facts }],
    thinking: { type: 'disabled' },
    output_config: { format: { type: 'json_schema', schema } },
    max_tokens: maxTokens,
  };
}

async function callStructured({ instructions, schema, name, facts, maxTokens }) {
  const key = apiKey();
  if (!key || !facts) return null;

  try {
    const res = await fetchAnthropicMessages(
      key,
      briefRequestParams({ instructions, schema, facts, maxTokens }),
      { maxRetries: 1 },
    );
    const data = await res.json();
    const raw = extractText(data);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[brief-ai:${name}] failed:`, String(e && (e.detail || e.message)).slice(0, 160));
    return null;
  }
}

async function summarizeBrief(facts) {
  const parsed = await callStructured({
    instructions: PUSH_INSTRUCTIONS,
    schema: PUSH_SCHEMA,
    name: 'morning_brief',
    facts,
    maxTokens: 400,
  });
  if (!parsed) return null;
  const title = clamp(parsed.title, 60);
  const body = clamp(parsed.body, 240);
  if (!title || !body) return null;
  return { title, body };
}

async function summarizeSplash(facts) {
  const parsed = await callStructured({
    instructions: SPLASH_INSTRUCTIONS,
    schema: SPLASH_SCHEMA,
    name: 'welcome_splash',
    facts,
    maxTokens: 500,
  });
  if (!parsed) return null;
  const summary = clamp(parsed.summary, 420);
  if (!summary) return null;
  return { summary };
}

module.exports = {
  summarizeBrief,
  summarizeSplash,
  clamp,
  briefRequestParams,
  PUSH_INSTRUCTIONS,
  SPLASH_INSTRUCTIONS,
  PUSH_SCHEMA,
  SPLASH_SCHEMA,
};

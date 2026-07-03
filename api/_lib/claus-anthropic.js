// Shared Claude (Anthropic Messages API) client for Claus chat, the morning/
// welcome briefs, and ticket reading. Plain CommonJS + global fetch (Node 18+)
// — no SDK, no build step, no package.json, matching the rest of api/*.
//
// This replaces the old OpenAI Responses helper: one transport
// (fetchAnthropicMessages), the server-tool builders (web search + web fetch),
// small helpers to pull text / tool input / citations out of a completed
// message, and a data-URL → content-block converter for PDFs and photos.
//
// Auth: set ANTHROPIC_API_KEY as a Vercel env var. Every request sends the
// x-api-key + anthropic-version headers (no Bearer token, no beta headers — web
// search, web fetch, structured outputs, adaptive thinking, and prompt caching
// are all GA on Claude Sonnet 5).

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// One model across every Claus surface. Sonnet 5: near-Opus quality on the
// reasoning/agentic work here, with native web search + citations, structured
// outputs, and adaptive thinking.
const MODEL = 'claude-sonnet-5';

function apiKey() {
  return (process.env.ANTHROPIC_API_KEY || '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Claude retries: rate limit, overloaded, and transient upstream/gateway errors.
function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429
    || status === 500 || status === 502 || status === 503 || status === 529;
}

function parseUpstreamErrorBody(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  try {
    const data = JSON.parse(raw);
    return String(data?.error?.message || data?.message || raw).slice(0, 400);
  } catch {
    return raw.slice(0, 400);
  }
}

// POST to /v1/messages with jittered backoff on 429/5xx/overloaded. Returns the
// raw fetch Response so streaming callers can read the SSE body directly and
// non-streaming callers can await res.json().
async function fetchAnthropicMessages(key, payload, opts = {}) {
  const maxRetries = opts.maxRetries ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      if (attempt < maxRetries) {
        const delay = 400 * (2 ** attempt) + Math.floor(Math.random() * 250);
        console.warn('[anthropic] fetch retry err=%s attempt=%d', String(e?.message || e).slice(0, 80), attempt + 1);
        await sleep(delay);
        continue;
      }
      throw e;
    }

    if (res.ok) return res;

    const detail = await res.text().catch(() => '');
    const message = parseUpstreamErrorBody(detail);

    if (attempt < maxRetries && isRetryableStatus(res.status)) {
      const delay = 400 * (2 ** attempt) + Math.floor(Math.random() * 250);
      console.warn('[anthropic] retry status=%d attempt=%d delay=%d', res.status, attempt + 1, delay);
      await sleep(delay);
      continue;
    }

    const err = new Error(message || `upstream_${res.status}`);
    err.status = res.status;
    err.detail = detail.slice(0, 600);
    throw err;
  }

  const err = new Error('upstream_exhausted');
  err.status = 502;
  throw err;
}

// ---- server tools ----------------------------------------------------------

// Claude's server-side web search (2026 variant with built-in dynamic
// filtering). max_uses keeps latency bounded on serverless; user_location
// biases live results to the traveler's current destination.
function buildWebSearchTool(location) {
  const tool = { type: 'web_search_20260318', name: 'web_search', max_uses: 5 };
  if (!location || typeof location !== 'object') return tool;
  const loc = { type: 'approximate' };
  if (location.city) loc.city = String(location.city).slice(0, 80);
  if (location.region) loc.region = String(location.region).slice(0, 80);
  // Claude web search doesn't support Estonia (EE) for localization — passing it
  // errors the request, so drop the country for Tallinn/Estonia and let the
  // city/region/timezone carry the location instead.
  if (location.country) {
    const country = String(location.country).slice(0, 2);
    if (country.toUpperCase() !== 'EE') loc.country = country;
  }
  if (location.timezone) loc.timezone = String(location.timezone).slice(0, 64);
  tool.user_location = loc;
  return tool;
}

// Web fetch lets Claus pull the full contents of a URL already in the
// conversation (e.g. a booking/transport page the user pastes) with citations.
function buildWebFetchTool() {
  return {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
    max_uses: 3,
    citations: { enabled: true },
  };
}

// Kept identical to the client-side shape so callers don't change: the location
// object the browser sends still maps 1:1 onto Claude's web_search user_location.
function normalizeWebSearchLocation(raw, webSearch) {
  if (!webSearch || !raw || typeof raw !== 'object') return null;
  return {
    city: raw.city ? String(raw.city).slice(0, 80) : '',
    region: raw.region ? String(raw.region).slice(0, 80) : '',
    country: raw.country ? String(raw.country).slice(0, 2) : '',
    timezone: raw.timezone ? String(raw.timezone).slice(0, 64) : '',
    localNow: raw.localNow ? String(raw.localNow).slice(0, 120) : '',
    label: raw.label ? String(raw.label).slice(0, 120) : '',
  };
}

// ---- reading a completed message -------------------------------------------

// Concatenate the visible text blocks (skips thinking / tool_use / server-tool
// result blocks). Works for both plain replies and structured-output JSON.
function extractText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  let text = '';
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') text += block.text;
  }
  return text;
}

// Claude returns tool calls as tool_use content blocks with an already-parsed
// .input object — no JSON.parse of a stringified arguments field.
function extractToolInput(message, name) {
  const content = Array.isArray(message?.content) ? message.content : [];
  for (const block of content) {
    if (block?.type === 'tool_use' && block.name === name && block.input && typeof block.input === 'object') {
      return block.input;
    }
  }
  return null;
}

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || 'source';
  } catch {
    return 'source';
  }
}

// Web-search citations arrive as structured citation objects on the text blocks
// (url + title) — no private-use markers to decode. Collect the unique ones.
function collectCitations(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  const out = [];
  const seen = new Set();
  for (const block of content) {
    if (block?.type !== 'text' || !Array.isArray(block.citations)) continue;
    for (const cite of block.citations) {
      const url = typeof cite?.url === 'string' ? cite.url.trim() : '';
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, title: (cite.title && String(cite.title).trim()) || hostLabel(url) });
    }
  }
  return out;
}

// Append a compact **Sources** list for any cited URLs the answer text doesn't
// already link. Replaces ~250 lines of OpenAI private-use citation-marker
// parsing with a few robust lines over Claude's structured citations.
function appendSources(text, citations) {
  const base = String(text || '');
  if (!Array.isArray(citations) || !citations.length) return base;
  const seen = new Set();
  const missing = [];
  for (const cite of citations) {
    if (!cite?.url || seen.has(cite.url)) continue;
    seen.add(cite.url);
    if (base.includes(cite.url)) continue;
    missing.push(`- [${cite.title}](${cite.url})`);
  }
  if (!missing.length) return base;
  return `${base.trimEnd()}\n\n**Sources**\n${missing.join('\n')}`;
}

// ---- file input ------------------------------------------------------------

function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

// Turn a base64 data: URL into a Claude content block: a PDF becomes a
// `document` (read as text + page images), an image becomes an `image` block
// (vision). Claude wants the raw base64 with no `data:...;base64,` prefix.
function fileBlockFromDataUrl(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  if (parsed.mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: parsed.data } };
  }
  if (/^image\//i.test(parsed.mediaType)) {
    return { type: 'image', source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data } };
  }
  return null;
}

module.exports = {
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_VERSION,
  MODEL,
  apiKey,
  fetchAnthropicMessages,
  parseUpstreamErrorBody,
  buildWebSearchTool,
  buildWebFetchTool,
  normalizeWebSearchLocation,
  extractText,
  extractToolInput,
  collectCitations,
  appendSources,
  fileBlockFromDataUrl,
};

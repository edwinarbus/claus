// Claude relevance classifier for the disruption watch. GDELT casts a wide,
// keyword-shaped net; this asks Claude (structured output) which of those
// headlines describe a REAL, current disruption for a traveler in today's city,
// and rewrites each to a calm one-liner. trip-watch.js uses this when
// ANTHROPIC_API_KEY is set and falls back to the keyword filter (watch.js)
// otherwise, so alerts still work with no key.

const {
  MODEL,
  apiKey,
  fetchAnthropicMessages,
  extractText,
} = require('./claus-anthropic.js');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer', description: 'the 0-based headline number from the list' },
          relevant: { type: 'boolean', description: 'true only if this is a real, current disruption affecting a traveler in the city today' },
          summary: { type: 'string', description: 'a calm, ≤90-char traveler-facing line: what it is + the practical impact. Empty when not relevant.' },
        },
        required: ['index', 'relevant', 'summary'],
      },
    },
  },
  required: ['results'],
};

const SYSTEM = [
  'You are a travel-disruption filter for a traveler who is right now in a specific city.',
  'From a list of recent news headlines, decide which describe a REAL, current disruption that could affect getting around or visiting sights in that city TODAY:',
  'transit strikes, line/station closures, cancelled flights or ferries, road closures, severe weather, protests blocking transit, evacuations, or a major incident at a named planned sight.',
  'Exclude national politics, war/geopolitics, elections, markets, crime that does not affect movement, sports, and coverage that only names the city in passing.',
  'For each relevant headline, write one short traveler-facing line (≤90 chars) naming what it is and the practical impact. Be conservative — when in doubt, mark it not relevant.',
].join(' ');

// Returns [{ title, summary }] for the relevant headlines (title = original,
// used for dedupe/alerted bookkeeping; summary = the clean display line), or
// null when disabled/failed so the caller can fall back to keyword matching.
async function classifyDisruptions(city, sights, articles) {
  const key = apiKey();
  const list = (Array.isArray(articles) ? articles : []).slice(0, 25);
  if (!key || !list.length) return null;

  const prompt = [
    `City: ${city}`,
    `Planned sights: ${(sights || []).join(', ') || '(none)'}`,
    'Headlines:',
    ...list.map((a, i) => `${i}. ${String(a.title || '').replace(/\s+/g, ' ').trim()}`),
  ].join('\n');

  try {
    const res = await fetchAnthropicMessages(key, {
      model: MODEL,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      thinking: { type: 'disabled' },
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      max_tokens: 1500,
    }, { maxRetries: 1 });

    const data = await res.json();
    const parsed = JSON.parse(extractText(data) || '{}');
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    const out = [];
    const seen = new Set();
    for (const r of results) {
      if (!r || r.relevant !== true) continue;
      const art = list[Number(r.index)];
      if (!art) continue;
      const title = String(art.title || '').replace(/\s+/g, ' ').trim();
      if (!title || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      const summary = String(r.summary || '').replace(/\s+/g, ' ').trim().slice(0, 90);
      out.push({ title, summary: summary || (title.length > 90 ? `${title.slice(0, 87)}…` : title) });
      if (out.length >= 3) break;
    }
    return out;
  } catch (e) {
    console.warn('[classify-alerts] failed:', String(e && (e.detail || e.message)).slice(0, 140));
    return null;
  }
}

module.exports = { classifyDisruptions };

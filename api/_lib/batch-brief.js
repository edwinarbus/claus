// Message Batches helpers for the whole-trip splash prewarm. The Batch API runs
// Messages requests asynchronously at 50% of standard prices — a good fit for
// pre-generating every upcoming day's welcome splash ahead of time (not
// latency-sensitive), unlike the 5:55 AM cron which stays synchronous.

const { ANTHROPIC_VERSION, apiKey, extractText } = require('./claus-anthropic.js');
const {
  briefRequestParams, SPLASH_INSTRUCTIONS, SPLASH_SCHEMA, clamp,
} = require('./brief-ai.js');

const BATCHES_URL = 'https://api.anthropic.com/v1/messages/batches';

function headers(key) {
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
  };
}

// items: [{ customId, facts }]. Returns { id, status, count } or null when
// there's no key / nothing to do.
async function submitSplashBatch(items) {
  const key = apiKey();
  if (!key) return null;
  const requests = (items || [])
    .filter((it) => it && it.customId && it.facts)
    .map((it) => ({
      custom_id: String(it.customId),
      params: briefRequestParams({
        instructions: SPLASH_INSTRUCTIONS,
        schema: SPLASH_SCHEMA,
        facts: it.facts,
        maxTokens: 500,
      }),
    }));
  if (!requests.length) return null;

  const r = await fetch(BATCHES_URL, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({ requests }),
  });
  if (!r.ok) {
    const d = await r.text().catch(() => '');
    throw new Error(`batch_create_${r.status}: ${d.slice(0, 200)}`);
  }
  const data = await r.json();
  return { id: data.id, status: data.processing_status, count: requests.length };
}

// Poll one batch. Until it's `ended`, returns { done:false, ... }. Once ended,
// returns { done:true, results: { [date]: { summary, source } } }. Results
// arrive in any order — keyed by custom_id (the day's date).
async function collectSplashBatch(batchId) {
  const key = apiKey();
  if (!key) return null;

  const r = await fetch(`${BATCHES_URL}/${encodeURIComponent(batchId)}`, { headers: headers(key) });
  if (!r.ok) {
    const d = await r.text().catch(() => '');
    throw new Error(`batch_get_${r.status}: ${d.slice(0, 200)}`);
  }
  const batch = await r.json();
  if (batch.processing_status !== 'ended') {
    return { status: batch.processing_status, done: false, counts: batch.request_counts || null };
  }

  const results = {};
  if (batch.results_url) {
    const rr = await fetch(batch.results_url, { headers: headers(key) });
    const text = await rr.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row;
      try { row = JSON.parse(trimmed); } catch { continue; }
      if (row?.result?.type !== 'succeeded') continue;
      let parsed = null;
      try { parsed = JSON.parse(extractText(row.result.message) || ''); } catch { parsed = null; }
      const summary = parsed?.summary ? clamp(parsed.summary, 420) : '';
      if (summary) results[row.custom_id] = { summary, source: 'anthropic' };
    }
  }
  return { status: 'ended', done: true, results };
}

module.exports = { submitSplashBatch, collectSplashBatch };

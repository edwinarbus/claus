// Vercel serverless proxy for the day-of "local conditions" news check.
//
// Why this exists: GDELT's free DOC API rate-limits per IP and is flaky when
// called straight from the browser, so the welcome screen kept showing
// "Couldn't check local conditions right now." Fetching it here instead — once,
// server-side, behind a shared CDN cache keyed on the city (+ the day's planned
// sights) — means GDELT sees roughly one request per city per cache window
// across ALL visitors, rather than one per browser. The client
// (src/data/alerts.js) filters/classifies the returned headlines and falls back
// to the weather signal if this is empty/down.
//
// Plain CommonJS + global fetch (Node 18+) so it runs on Vercel with no build
// step or package.json in this otherwise static, no-backend app. Query
// construction lives in api/_lib/gdelt.js, shared with the morning-brief cron.

const { fetchGdeltArticles } = require('./_lib/gdelt.js');
const { todayISO } = require('./_lib/brief.js');
const { loadTripState } = require('./_lib/state.js');
const { getPrefetchedGdelt } = require('./_lib/prefetch.js');

function firstParam(v) {
  return String(Array.isArray(v) ? v[0] : (v || ''));
}

module.exports = async (req, res) => {
  const city = firstParam(req.query && req.query.city).slice(0, 80).trim();
  // Comma-separated names of the day's planned sights — headlines mentioning
  // them are relevant even when no generic disruption phrase matches.
  const sights = firstParam(req.query && req.query.sights)
    .slice(0, 500)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!city) {
    res.status(400).json({ status: 'error', articles: [] });
    return;
  }

  const state = await loadTripState();
  const cached = getPrefetchedGdelt(state, todayISO(), city, sights);
  if (cached) {
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json({ status: cached.ok ? 'ok' : 'error', articles: cached.articles, cached: true });
    return;
  }

  const { ok, articles } = await fetchGdeltArticles(city, sights);
  if (!ok) {
    // Briefly cache the miss too, so an outage doesn't turn into a GDELT flood.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800');
    res.status(200).json({ status: 'error', articles: [] });
    return;
  }

  // Shared CDN cache: GDELT is hit at most ~once per city+sights combination
  // per 6h across all visitors; stale-while-revalidate keeps responses instant.
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  res.status(200).json({ status: 'ok', articles });
};

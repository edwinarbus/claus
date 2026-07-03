// Shared GDELT news check used by /api/alerts (the welcome screen's local
// conditions strip) and /api/morning-brief (the 6 AM push). One place owns the
// query construction so both check the same things: city-level travel
// disruptions PLUS anything mentioning the day's planned sights.

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

// City AND one of a curated OR group of travel-disruption phrases, English
// sources for readable titles. (Callers do fine-grained relevance filtering;
// this just narrows what GDELT returns.)
const DISRUPTION_PHRASES = [
  'metro strike', 'rail strike', 'train strike', 'tube strike', 'bus strike',
  'transport strike', 'general strike', 'service suspended', 'line closed',
  'station closed', 'road closure', 'flights cancelled', 'airport closed',
  'travel disruption', 'travel chaos', 'protest', 'demonstration', 'flooding',
  'flash flood', 'evacuation', 'lockdown', 'wildfire', 'heatwave', 'curfew',
];

// Headlines about geopolitics/elections aren't travel disruptions, however
// often they name a capital city — both the brief's news line and the
// disruption watch drop them before relevance matching.
const NEWS_BLOCKLIST = ['ukraine', 'russia', 'russian', 'gaza', 'israel', 'israeli', 'hamas', 'hezbollah', 'missile', 'troops', 'airstrike', 'air strike', 'nuclear', 'zelensk', 'putin', 'nato', 'sanction', 'ceasefire', 'tariff', 'election'];

// Sight names come from user data — keep them GDELT-safe: strip quotes/parens,
// cap the count and length so the query stays well-formed and small.
function cleanSights(sights) {
  return (Array.isArray(sights) ? sights : [])
    .map((s) => String(s || '').replace(/["()]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 4 && s.length <= 60)
    .slice(0, 6);
}

function buildQuery(city, sights) {
  const phrases = DISRUPTION_PHRASES.map((p) => (p.includes(' ') ? `"${p}"` : p));
  // Planned sights join the OR group: a headline naming the city AND either a
  // disruption phrase or one of today's sights (closure, event, incident at a
  // place you're about to visit) is worth surfacing.
  for (const s of cleanSights(sights)) phrases.push(`"${s}"`);
  return `${city} (${phrases.join(' OR ')}) sourcelang:english`;
}

// Fetch recent matching articles. Returns { ok, articles: [{title,url,domain}] }
// — ok:false covers GDELT throttle notices (plaintext bodies) and errors.
async function fetchGdeltArticles(city, sights = []) {
  const url = `${GDELT_URL}?query=${encodeURIComponent(buildQuery(city, sights))}`
    + '&mode=ArtList&format=json&maxrecords=30&timespan=3d&sort=DateDesc';
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Claus/1.0 (local-conditions check)' },
    });
    const text = await r.text();
    // GDELT answers throttle/errors with a plaintext notice (sometimes even on
    // a 200). A real result is a JSON object — anything else is a miss.
    if (!r.ok || !text.trim().startsWith('{')) return { ok: false, articles: [] };
    let data = {};
    try { data = JSON.parse(text); } catch { data = {}; }
    const articles = Array.isArray(data.articles)
      ? data.articles.slice(0, 30).map((a) => ({
          title: a.title || '',
          url: a.url || '',
          domain: a.domain || '',
        }))
      : [];
    return { ok: true, articles };
  } catch {
    return { ok: false, articles: [] };
  }
}

module.exports = { fetchGdeltArticles, cleanSights, DISRUPTION_PHRASES, NEWS_BLOCKLIST };

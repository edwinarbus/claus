// Disruption-watch helpers, shared by api/trip-watch.js (the through-the-day
// check) and api/morning-brief.js (which marks the brief's own news line as
// already-alerted so the watch never re-pushes the same story).

const { DISRUPTION_PHRASES, NEWS_BLOCKLIST } = require('./gdelt.js');

// Stable key for "have we alerted about this headline already" — survives
// minor punctuation/casing differences between GDELT fetches.
function normHeadline(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}

// Headlines worth waking someone for: about today's city AND a disruption
// phrase, or naming one of today's planned sights — minus geopolitics noise
// and anything we've already alerted on. At most three, deduped.
function freshDisruptions(articles, city, sights, alerted = {}) {
  const cityLow = String(city || '').toLowerCase().split(/[/,]/)[0].trim();
  const sightLows = (sights || []).map((s) => String(s).toLowerCase()).filter((s) => s.length >= 4);
  const fresh = [];
  for (const a of articles || []) {
    const title = String(a.title || '').replace(/\s+/g, ' ').trim();
    const low = title.toLowerCase();
    if (!title || NEWS_BLOCKLIST.some((b) => low.includes(b))) continue;
    const aboutSight = sightLows.some((s) => low.includes(s));
    const aboutCity = low.includes(cityLow) && DISRUPTION_PHRASES.some((p) => low.includes(p));
    if (!aboutSight && !aboutCity) continue;
    const key = normHeadline(title);
    if (alerted[key] || fresh.some((t) => normHeadline(t) === key)) continue;
    fresh.push(title);
    if (fresh.length >= 3) break;
  }
  return fresh;
}

// Keep the alerted map small: entries expire after a week (a still-running
// strike will keep making new headlines anyway), hard-capped at 40 keys.
function pruneAlerted(alerted = {}) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const entries = Object.entries(alerted)
    .filter(([, ts]) => Number(ts) > weekAgo)
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .slice(0, 40);
  return Object.fromEntries(entries);
}

module.exports = { normHeadline, freshDisruptions, pruneAlerted };

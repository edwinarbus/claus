// Live "local conditions" check for the day-of welcome screen.
//
// News disruptions (strikes, protests, closures, transit outages, safety
// incidents, severe-weather headlines) come from GDELT, but the browser no
// longer calls GDELT directly — its free endpoint rate-limits per IP and is
// flaky from the client. Instead we hit our own cached `/api/alerts` proxy
// (see api/alerts.js): it fetches GDELT server-side and is shared-cached on the
// CDN, so GDELT sees roughly one request per city rather than one per visitor.
// We still filter/classify the returned headlines here. Results are cached per
// city+day. When the proxy returns nothing or fails (e.g. local dev with no
// serverless layer), the caller falls back to the reliable weather signal.

const CACHE_KEY = 'claus-demo:alerts:v1';
const TTL_MS = 6 * 60 * 60 * 1000; // success: re-check at most every 6 hours
const ERROR_TTL_MS = 10 * 60 * 1000; // failure: brief cooldown before retrying

// Travel-specific PHRASES (not bare keywords) so polysemous words like "strike"
// or "storm" don't pull in geopolitical/war news. A headline must contain the
// city AND one of these phrases to count as a local disruption.
const KIND_PHRASES = [
  ['transit', ['metro strike', 'tube strike', 'rail strike', 'train strike', 'bus strike', 'transport strike', 'transit strike', 'general strike', 'rail disruption', 'travel disruption', 'travel chaos', 'service suspended', 'services suspended', 'line closed', 'station closed', 'metro closed', 'trains cancelled', 'trains canceled', 'flights cancelled', 'flights canceled', 'airport closed', 'airport strike']],
  ['protest', ['protest', 'demonstration', 'mass rally', 'street march', 'riot', 'roadblock', 'road blocked']],
  ['closure', ['road closure', 'roads closed', 'road closed', 'partially closed', 'closed to traffic']],
  ['safety', ['terror attack', 'bomb threat', 'active shooter', 'mass evacuation', 'evacuation order', 'lockdown', 'curfew']],
  ['weather', ['flooding', 'flash flood', 'severe storm', 'storm warning', 'heatwave', 'heat wave', 'wildfire', 'heavy snow', 'blizzard']],
];
const ALL_PHRASES = [...new Set(KIND_PHRASES.flatMap(([, p]) => p))];

// Conflict / geopolitics terms that make a "strike"/"attack"/"storm" headline
// about war rather than local travel — drop these even if the city is named.
const BLOCKLIST = ['ukraine', 'russia', 'russian', 'gaza', 'israel', 'israeli', 'hamas', 'hezbollah', 'missile', 'troops', 'airstrike', 'air strike', 'nuclear', 'zelensk', 'putin', 'nato', 'sanction', 'ceasefire', 'tariff', 'election'];

// Glyph keys (not emoji) resolved to inline icons by the renderer. All of these
// are "heads up" disruptions, so they share the warning glyph; a story about a
// planned sight gets the ticket glyph instead.
export const ALERT_KIND_ICON = {
  transit: 'warning', protest: 'warning', closure: 'warning', safety: 'warning',
  weather: 'warning', sight: 'ticket', general: 'warning',
};

function cleanTitle(t) {
  return (t || '').replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

function classify(title) {
  const low = title.toLowerCase();
  for (const [kind, phrases] of KIND_PHRASES) {
    if (phrases.some((p) => low.includes(p))) return kind;
  }
  return 'general';
}

// City parts to match in a headline (handles "Flåm/Aurland", "Aarhus, …").
function cityParts(cityName) {
  return cityName.toLowerCase().split(/[/,]/).map((s) => s.trim()).filter((s) => s.length >= 3);
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}
function writeCache(obj) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
}

// A headline counts when it's (a) a disruption story naming the city, or
// (b) any story naming one of today's PLANNED SIGHTS (closure, special event,
// incident at a place you're about to visit) — those matter even without a
// generic disruption phrase.
function relevant(title, parts, sightLows) {
  const low = title.toLowerCase();
  if (BLOCKLIST.some((b) => low.includes(b))) return false;
  if (sightLows.some((s) => low.includes(s))) return true;
  const inCity = parts.some((p) => low.includes(p));
  const isDisruption = ALL_PHRASES.some((p) => low.includes(p));
  return inCity && isDisruption;
}

// Names of planned sights worth matching/querying — long enough to be specific.
function usableSights(sights) {
  return [...new Set((Array.isArray(sights) ? sights : [])
    .map((s) => String(s || '').trim())
    .filter((s) => s.length >= 4))].slice(0, 6);
}

// Returns { status: 'ok' | 'error', alerts: [{ title, url, domain, kind }] }.
// 'ok' with an empty list means "checked, nothing notable"; 'error' means the
// news check couldn't complete — in both cases the caller may layer on the
// weather fallback. Pass the day's planned sight names via `sights` so the
// check also covers news about the places actually on the plan.
export async function getLocalAlerts(cityName, dateISO, { limit = 2, sights = [] } = {}) {
  if (!cityName) return { status: 'ok', alerts: [] };
  const sightNames = usableSights(sights);
  const key = `${cityName}|${dateISO}|${sightNames.join(',').slice(0, 120)}`;
  const cache = readCache();
  const hit = cache[key];
  if (hit) {
    const age = Date.now() - hit.ts;
    if (!hit.error && age < TTL_MS) return { status: 'ok', alerts: hit.alerts, cached: true };
    if (hit.error && age < ERROR_TTL_MS) return { status: 'error', alerts: [], cached: true };
  }

  try {
    const sightsParam = sightNames.length ? `&sights=${encodeURIComponent(sightNames.join(','))}` : '';
    const res = await fetch(`/api/alerts?city=${encodeURIComponent(cityName)}${sightsParam}`);
    if (!res.ok) throw new Error(`alerts proxy ${res.status}`);
    const data = await res.json();
    const articles = Array.isArray(data.articles) ? data.articles : [];
    const parts = cityParts(cityName);
    const sightLows = sightNames.map((s) => s.toLowerCase());

    const seen = new Set();
    const alerts = [];
    for (const a of articles) {
      const title = cleanTitle(a.title);
      if (!title || !relevant(title, parts, sightLows)) continue;
      const dedupe = title.toLowerCase().slice(0, 60);
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      const low = title.toLowerCase();
      const kind = classify(title);
      const sightHit = kind === 'general' && sightLows.some((s) => low.includes(s));
      alerts.push({ title, url: a.url || '', domain: a.domain || '', kind: sightHit ? 'sight' : kind });
      if (alerts.length >= limit) break;
    }

    cache[key] = { ts: Date.now(), alerts };
    writeCache(cache);
    return { status: 'ok', alerts };
  } catch (e) {
    console.warn('Claus: local alerts check failed', e);
    // Remember the failure briefly so re-opening the splash doesn't immediately
    // retry; the weather fallback covers the gap in the meantime.
    cache[key] = { ts: Date.now(), alerts: [], error: true };
    writeCache(cache);
    return { status: 'error', alerts: [] };
  }
}

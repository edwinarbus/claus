// 5:55 AM Norway-time warm-up for the 6 AM brief and welcome splash.
// Caches GPT splash copy, push brief, and GDELT articles in trip state so
// morning opens and notifications are instant.

const { fetchGdeltArticles } = require('./gdelt.js');
const {
  todayISO, plannedSights, composeSplash, composeBrief,
} = require('./brief.js');

const NORWAY_TZ = 'Europe/Oslo';

function localTimeParts(tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? 0),
  };
}

// True during the 5:55–5:59 window in Europe/Oslo (DST-safe with dual UTC crons).
function isNorwayPrefetchWindow() {
  const { hour, minute } = localTimeParts(NORWAY_TZ);
  return hour === 5 && minute >= 55;
}

function gdeltSightsKey(sights) {
  return [...new Set((sights || [])
    .map((s) => String(s).toLowerCase().trim())
    .filter((s) => s.length >= 4))]
    .sort()
    .join('|');
}

function getPrefetchedSplash(state, dateISO) {
  const p = state && state.prefetch;
  if (!p || p.date !== dateISO || !p.splash?.summary) return null;
  return p.splash;
}

function getPrefetchedBrief(state, dateISO) {
  const p = state && state.prefetch;
  if (!p || p.date !== dateISO || !p.brief?.title) return null;
  return p.brief;
}

function getPrefetchedGdelt(state, dateISO, city, sights) {
  const p = state && state.prefetch;
  if (!p || p.date !== dateISO || !p.gdelt) return null;
  const key = gdeltSightsKey(sights);
  if (p.gdelt.city !== city || p.gdelt.sightsKey !== key) return null;
  return { ok: !!p.gdelt.ok, articles: p.gdelt.articles || [] };
}

async function runMorningPrefetch(stop, day) {
  const sights = plannedSights(day);
  const city = stop.name;
  const [splash, gdeltResult, brief] = await Promise.all([
    composeSplash(stop, day),
    fetchGdeltArticles(city, sights),
    composeBrief(stop, day),
  ]);
  return {
    date: day.date,
    at: Date.now(),
    splash,
    brief,
    gdelt: {
      city,
      sightsKey: gdeltSightsKey(sights),
      ok: gdeltResult.ok,
      articles: gdeltResult.articles || [],
    },
  };
}

module.exports = {
  NORWAY_TZ,
  isNorwayPrefetchWindow,
  gdeltSightsKey,
  getPrefetchedSplash,
  getPrefetchedBrief,
  getPrefetchedGdelt,
  runMorningPrefetch,
};

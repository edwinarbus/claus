// Morning-brief composition, shared by the 6 AM cron (api/morning-brief.js)
// and the just-subscribed preview push (api/push.js). Reads the shared trip
// from Supabase, gathers today's facts (plan, weather, alerts), and asks
// Claude Sonnet 5 for natural lock-screen copy — falling back to templates if
// ANTHROPIC_API_KEY is unset or the API call fails.

const { SUPABASE_URL, SUPABASE_ANON_KEY, TRIP_ID } = require('./config.js');
const { fetchGdeltArticles, DISRUPTION_PHRASES, NEWS_BLOCKLIST } = require('./gdelt.js');
const { summarizeBrief, summarizeSplash } = require('./brief-ai.js');
const { fetchDayWeather } = require('./weather.js');

const SB_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

// ---- trip access (CommonJS mirrors of src/lib/tripDay.js) ------------------

async function fetchTrip() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/trips?id=eq.${encodeURIComponent(TRIP_ID)}&select=data`,
    { headers: SB_HEADERS },
  );
  const rows = r.ok ? await r.json() : [];
  return (rows[0] && rows[0].data) || null;
}

// Today's calendar date where the travelers are (CET/CEST covers the whole
// route at the early-UTC cron times — Helsinki is an hour ahead, same date).
function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(new Date());
}

// IANA zone where the travelers wake up for a given stop — Finland/Estonia run
// an hour ahead of the Scandinavian mainland, so "6 AM" differs by stop.
function stopTimeZone(stop) {
  const c = (stop && stop.country) || '';
  if (c === 'Finland') return 'Europe/Helsinki';
  if (c === 'Estonia') return 'Europe/Tallinn';
  return 'Europe/Copenhagen';
}

function localHour(tz) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date()));
}

function findDayOnTrip(trip, dateISO) {
  for (const stop of (trip && trip.stops) || []) {
    const day = (stop.days || []).find((d) => d.date === dateISO);
    if (day) return { stop, day };
  }
  return null;
}

// The trip's first stop-day — what previews/tests compose against off-trip.
function firstPlannedDay(trip) {
  const stop = ((trip && trip.stops) || []).find((s) => (s.days || []).length);
  return stop ? { stop, day: stop.days[0] } : null;
}

function slotItems(day, key) {
  const v = day.slots && day.slots[key];
  if (Array.isArray(v)) return v;
  return v ? [v] : [];
}

function plannedSights(day) {
  return ['morning', 'afternoon', 'evening']
    .flatMap((k) => slotItems(day, k))
    .map((it) => it && it.name)
    .filter(Boolean);
}

function naturalList(arr, max = 3) {
  const a = arr.slice(0, max);
  if (a.length <= 1) return a[0] || '';
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

function stripSourceLabel(text) {
  return String(text || '')
    .replace(/\s*(?:[-–—|•·]\s*)?from\s+(?:Claus|Scandiplan)\b[:.]?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---- weather ---------------------------------------------------------------

const WMO = [
  [[0], '☀️', 'clear'], [[1], '🌤️', 'mostly clear'], [[2], '⛅', 'partly cloudy'],
  [[3], '☁️', 'overcast'], [[45, 48], '🌫️', 'foggy'],
  [[51, 53, 55, 56, 57], '🌦️', 'drizzly'], [[61, 80], '🌦️', 'light rain'],
  [[63, 65, 66, 67, 81, 82], '🌧️', 'rainy'],
  [[71, 73, 75, 77, 85, 86], '🌨️', 'snowy'], [[95, 96, 99], '⛈️', 'stormy'],
];

function wxInfo(code) {
  for (const [codes, icon, label] of WMO) {
    if (codes.includes(code)) return { icon, label };
  }
  return { icon: '🌡️', label: '' };
}

async function fetchTodayWeather(lat, lng, dateISO, opts) {
  return fetchDayWeather(lat, lng, dateISO, todayISO(), opts);
}

// ---- news (same spirit as src/data/alerts.js, compacted) -------------------

async function newsLine(city, sights) {
  const { ok, articles } = await fetchGdeltArticles(city, sights);
  if (!ok) return '';
  const cityLow = city.toLowerCase().split(/[/,]/)[0].trim();
  const sightLows = sights.map((s) => s.toLowerCase()).filter((s) => s.length >= 4);
  for (const a of articles) {
    const title = (a.title || '').replace(/\s+/g, ' ').trim();
    const low = title.toLowerCase();
    if (!title || NEWS_BLOCKLIST.some((b) => low.includes(b))) continue;
    const aboutSight = sightLows.some((s) => low.includes(s));
    const aboutCity = low.includes(cityLow) && DISRUPTION_PHRASES.some((p) => low.includes(p));
    if (aboutSight || aboutCity) {
      return `⚠ ${title.length > 90 ? `${title.slice(0, 87)}…` : title}`;
    }
  }
  return '';
}

// ---- compose ----------------------------------------------------------------

function slotLabels(day, key) {
  return slotItems(day, key).map((it) => it && it.name).filter(Boolean);
}

function normalizeHour(hour) {
  const n = Number(hour);
  return Number.isFinite(n) && n >= 0 && n < 24 ? Math.floor(n) : null;
}

function activitySlotKeysForHour(hour) {
  const h = normalizeHour(hour);
  if (h == null || h < 11) return ['morning', 'afternoon', 'evening'];
  if (h < 17) return ['afternoon', 'evening'];
  return ['evening'];
}

function mealKeysForHour(hour) {
  const h = normalizeHour(hour);
  if (h == null || h < 10) return ['breakfast', 'lunch', 'dinner'];
  if (h < 14) return ['lunch', 'dinner'];
  if (h < 21) return ['dinner'];
  return [];
}

function openingWindowLabel(hour) {
  const h = normalizeHour(hour);
  if (h == null || h < 11) return 'Today';
  if (h < 17) return 'The rest of today';
  return 'Tonight';
}

function isTimeFilteredSplashHour(hour) {
  const h = normalizeHour(hour);
  return h != null && h >= 11;
}

function buildBriefFacts(stop, day, wx, newsRaw) {
  const dayNumber = (typeof day.index === 'number' ? day.index : 0) + 1;
  const lines = [
    'Morning brief for Tyler & Edwin',
    `Day ${dayNumber} · ${stop.name}, ${stop.country} · ${day.date}`,
  ];
  const schedule = [
    ['Morning', 'morning'],
    ['Afternoon', 'afternoon'],
    ['Evening', 'evening'],
    ['Breakfast', 'breakfast'],
    ['Lunch', 'lunch'],
    ['Dinner', 'dinner'],
  ];
  for (const [label, key] of schedule) {
    const names = slotLabels(day, key);
    if (names.length) lines.push(`${label}: ${names.join('; ')}`);
  }
  const lodging = day.slots?.lodging?.name;
  if (lodging) lines.push(`Tonight: ${lodging}`);
  if (wx) {
    const info = wxInfo(wx.code);
    const kind = wx.source === 'live' ? 'live forecast' : 'typical for this date';
    lines.push(`Weather (${kind}): ${info.icon} high ${wx.hi}° low ${wx.lo}° ${info.label}`);
  }
  if (newsRaw) {
    lines.push(`Travel alert: ${String(newsRaw).replace(/^⚠\s*/, '').trim()}`);
  }
  if (!slotLabels(day, 'morning').length
    && !slotLabels(day, 'afternoon').length
    && !slotLabels(day, 'evening').length) {
    lines.push('Sightseeing: nothing locked in yet — a free day');
  }
  return lines.join('\n');
}

// Lean facts for the welcome splash — one day, no news (disruptions load in the UI).
function buildSplashFacts(stop, day, wx, opts = {}) {
  const dayNumber = (typeof day.index === 'number' ? day.index : 0) + 1;
  const lines = [`Day ${dayNumber} · ${stop.name}, ${stop.country} · ${day.date}`];
  const hour = normalizeHour(opts.hour);
  const activityKeys = activitySlotKeysForHour(hour);
  const labels = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
  if (isTimeFilteredSplashHour(hour)) {
    lines.push(`Opened at local hour ${hour}: focus on ${openingWindowLabel(hour).toLowerCase()} only; ignore earlier slots.`);
  }
  for (const key of activityKeys) {
    const names = slotLabels(day, key);
    if (names.length) lines.push(`${labels[key]}: ${naturalList(names, 4)}`);
  }
  const meals = mealKeysForHour(hour)
    .map((k) => {
      const names = slotLabels(day, k);
      return names.length ? `${k}: ${names.join(', ')}` : '';
    })
    .filter(Boolean);
  if (meals.length) lines.push(`Meals: ${meals.join('; ')}`);
  const lodging = day.slots?.lodging?.name;
  if (lodging) lines.push(`Tonight: ${lodging}`);
  if (wx) {
    const info = wxInfo(wx.code);
    const kind = wx.source === 'live' ? 'live forecast' : 'typical for this date';
    lines.push(`Weather (${kind}): ${info.icon} high ${wx.hi}° low ${wx.lo}° ${info.label}`);
  }
  if (!activityKeys.some((key) => slotLabels(day, key).length)
    && !meals.length) {
    lines.push(`${openingWindowLabel(hour)}: nothing else locked in yet`);
  }
  return lines.join('\n');
}

function sightsLine(sights) {
  const morningFirst = sights[0];
  if (!sights.length) return 'Nothing locked in — a free day to wander.';
  if (sights.length === 1) return `${morningFirst} is the plan today.`;
  return `${morningFirst} this morning, then ${naturalList(sights.slice(1), 2)}.`;
}

function dayDescription(city, sights) {
  if (!sights.length) {
    return `${city} is open today, with nothing locked in yet — a good day to wander, eat well, and follow your curiosity.`;
  }
  if (sights.length === 1) {
    return `Today in ${city} centers on ${sights[0]}, with plenty of room to explore around it.`;
  }
  return `It's a steady ${city} day with a clear sightseeing arc and enough room to linger between stops.`;
}

function isRainCode(code) {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

function splashSummaryTemplate(stop, day, wx, opts = {}) {
  const hour = normalizeHour(opts.hour);
  const slotKeys = activitySlotKeysForHour(hour);
  const morning = slotKeys.includes('morning') ? slotLabels(day, 'morning') : [];
  const afternoon = slotKeys.includes('afternoon') ? slotLabels(day, 'afternoon') : [];
  const evening = slotKeys.includes('evening') ? slotLabels(day, 'evening') : [];
  const ordered = [...morning, ...afternoon, ...evening];
  const meals = mealKeysForHour(hour).flatMap((k) => slotLabels(day, k));
  const city = stop.name;
  const windowLabel = openingWindowLabel(hour);
  const windowNoun = windowLabel === 'Tonight' ? 'evening' : windowLabel.toLowerCase();
  const lateOpen = isTimeFilteredSplashHour(hour);

  let s1;
  if (ordered.length === 0 && meals.length === 0) {
    s1 = `${windowLabel} in ${city} is still open, with nothing else locked in — follow your curiosity from here.`;
  } else if (ordered.length === 0) {
    s1 = `${windowLabel} in ${city} keeps things easy, built around good meals and time to roam at your own pace.`;
  } else if (ordered.length === 1) {
    s1 = `${windowLabel} in ${city} centers on ${ordered[0]}, with plenty of room to wander around it.`;
  } else if (morning.length && evening.length) {
    s1 = `Your day in ${city} eases from ${morning[0]} in the morning to ${evening[evening.length - 1]} after dark.`;
  } else {
    s1 = `${city} has a lovely ${windowNoun} ahead, taking in ${naturalList(ordered)}.`;
  }

  let s2;
  if (wx) {
    const info = wxInfo(wx.code);
    const hi = wx.hi;
    const desc = (info.label || '').toLowerCase();
    const rain = isRainCode(wx.code);
    if (rain) {
      s2 = `Skies lean toward ${desc} with highs near ${hi}°, so keep a layer and something for the rain close${lateOpen ? ' from here' : ' before you head out'}.`;
    } else if (hi >= 75) {
      s2 = `It's looking ${desc} and warm around ${hi}°, ideal for taking it slow and staying out a little longer.`;
    } else if (hi <= 55) {
      s2 = `Expect ${desc} skies and a cool ${hi}°, so layer up and you'll be comfortable${lateOpen ? ' from here' : ' all day'}.`;
    } else {
      s2 = `Expect ${desc} skies and a mild ${hi}° — great weather for getting around on foot.`;
    }
  } else {
    s2 = 'Lace up some comfortable shoes, take it at your own pace, and enjoy every bit of it.';
  }

  return `${s1} ${s2}`;
}

function composeBriefTemplate(stop, day, sights, wx, news) {
  const glanceLine = sightsLine(sights);
  const body = [
    glanceLine,
    dayDescription(stop.name, sights),
    news,
  ].filter(Boolean).join(' ');
  const dayNumber = (typeof day.index === 'number' ? day.index : 0) + 1;
  const dayTitle = `Day ${dayNumber} in ${stop.name}`;
  return {
    title: stripSourceLabel(dayTitle),
    body: stripSourceLabel(body),
  };
}

function normalizeTempUnits(text) {
  return String(text || '')
    .replace(/°F/g, '°')
    .replace(/(\d)\s*F\b/g, '$1°');
}

function stripWeatherEmojis(text) {
  let t = String(text || '');
  for (const [, emoji] of WMO) t = t.split(emoji).join('');
  return t;
}

function stripBodyWeatherPrefix(body, hi) {
  let t = normalizeTempUnits(stripWeatherEmojis(body).trim());
  t = t.replace(/^(\d+°\s*([Ff]|°)?\s*[—–\-•·]\s*)+/i, '').trim();
  if (hi != null) {
    t = t.replace(new RegExp(`^${hi}°\\s*([—–\-•·,]|and)\\s*`, 'i'), '').trim();
  }
  return t;
}

function stripBodyWeatherFromText(body, hi) {
  let t = stripBodyWeatherPrefix(body, hi);
  if (hi != null) {
    t = t.replace(
      new RegExp(`\\b(?:highs?\\s+(?:near|around|of)?\\s*|around\\s+|about\\s+|a\\s+(?:cool|mild|warm)\\s+)?${hi}°\\b`, 'gi'),
      '',
    );
  }
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

function stripTitleToDayCity(title, stop, day) {
  const dayNumber = (typeof day.index === 'number' ? day.index : 0) + 1;
  const dayTitle = `Day ${dayNumber} in ${stop.name}`;
  let t = normalizeTempUnits(stripWeatherEmojis(title).trim());
  t = t.replace(/^(\d+°\s*([Ff]|°)?\s*[·•]\s*)+/g, '')
    .replace(/(\s*[·•]\s*\d+°\s*([Ff]|°)?)+/g, '')
    .replace(/\s+\d+°\s*([Ff])?/g, '')
    .trim();
  const dayMatch = t.match(/Day \d+ in [^·•]+/);
  return dayMatch ? dayMatch[0].trim() : dayTitle;
}

// Weather emoji + temp on the title; body is plan/alerts only.
function ensureBriefWeatherFormat(copy, stop, day, wx) {
  if (!copy) return copy;
  const dayTitle = stripTitleToDayCity(copy.title, stop, day);
  let title = dayTitle;
  let body = stripBodyWeatherFromText(copy.body, wx?.hi);

  if (wx) {
    const { icon } = wxInfo(wx.code);
    title = `${dayTitle} ${icon} ${wx.hi}°`;
  }

  return { ...copy, title, body };
}

async function composeSplash(stop, day, opts = {}) {
  const wx = await fetchTodayWeather(stop.lat, stop.lng, day.date, { forecastOnly: true });
  const facts = buildSplashFacts(stop, day, wx, opts);
  const ai = await summarizeSplash(facts);
  const summary = ai?.summary || splashSummaryTemplate(stop, day, wx, opts);

  return {
    summary: stripSourceLabel(summary),
    source: ai ? 'anthropic' : 'template',
  };
}

async function composeBrief(stop, day) {
  const sights = plannedSights(day);
  const [wx, news] = await Promise.all([
    fetchTodayWeather(stop.lat, stop.lng, day.date),
    newsLine(stop.name, sights),
  ]);

  const facts = buildBriefFacts(stop, day, wx, news);
  const ai = await summarizeBrief(facts);
  const raw = ai || composeBriefTemplate(stop, day, sights, wx, news);
  const copy = ensureBriefWeatherFormat(raw, stop, day, wx);

  return {
    title: stripSourceLabel(copy.title),
    body: stripSourceLabel(copy.body),
    tag: `scandiplan-brief-${day.date}`,
    // Tapping the brief deep-links straight to the welcome screen.
    url: './?welcome=1',
    // The raw news headline (if any), so the cron can mark it as already
    // alerted and the disruption watch won't re-push the same story later.
    news: news ? stripSourceLabel(news).replace(/^⚠\s*/, '') : '',
    ...(ai ? { source: 'anthropic' } : { source: 'template' }),
  };
}

// Facts string for one day's welcome splash (weather + plan), without calling
// the model — used by the Batch prewarm to build many requests at once.
async function splashFactsForDay(stop, day, opts = {}) {
  const wx = await fetchTodayWeather(stop.lat, stop.lng, day.date, { forecastOnly: true });
  return buildSplashFacts(stop, day, wx, opts);
}

// Trip days from `fromISO` onward, earliest first, capped — the set the Batch
// prewarm generates splash copy for ahead of time.
function upcomingDays(trip, fromISO, max = 14) {
  const out = [];
  for (const stop of (trip && trip.stops) || []) {
    for (const day of stop.days || []) {
      if (day.date && day.date >= fromISO) out.push({ stop, day });
    }
  }
  out.sort((a, b) => (a.day.date < b.day.date ? -1 : 1));
  return out.slice(0, max);
}

module.exports = {
  fetchTrip, todayISO, stopTimeZone, localHour,
  findDayOnTrip, firstPlannedDay, plannedSights, composeBrief, composeSplash, isTimeFilteredSplashHour,
  splashFactsForDay, upcomingDays,
};

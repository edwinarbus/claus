// Weather service (Open-Meteo, no API key).
//
// Strategy:
//  - If a date is within the live forecast horizon (~15 days out), use the
//    real forecast and mark it 'live'.
//  - Otherwise (e.g. July 2026 seen from today) estimate from a climatology:
//    the average of the same calendar day across recent past summers, marked
//    'typical'. As today advances toward the trip, dates roll into the live
//    window automatically.
//
// Everything is in °F. Results are cached in memory + localStorage.

import { todayISO, daysBetween, parseISO } from '../lib/dates.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_HORIZON_DAYS = 15;
const CLIMATE_YEARS = [2022, 2023, 2024]; // recent complete summers (ERA5 reanalysis)
const WX_CACHE_KEY = 'claus-demo:wx:v2'; // v2: drop entries poisoned by null-forecast 0° days

// ---- WMO weather code → icon + label -------------------------------------
const CODE_TABLE = {
  0: { icon: '☀️', label: 'Clear' },
  1: { icon: '🌤️', label: 'Mostly clear' },
  2: { icon: '⛅', label: 'Partly cloudy' },
  3: { icon: '☁️', label: 'Overcast' },
  45: { icon: '🌫️', label: 'Fog' },
  48: { icon: '🌫️', label: 'Rime fog' },
  51: { icon: '🌦️', label: 'Light drizzle' },
  53: { icon: '🌦️', label: 'Drizzle' },
  55: { icon: '🌧️', label: 'Heavy drizzle' },
  56: { icon: '🌧️', label: 'Freezing drizzle' },
  57: { icon: '🌧️', label: 'Freezing drizzle' },
  61: { icon: '🌦️', label: 'Light rain' },
  63: { icon: '🌧️', label: 'Rain' },
  65: { icon: '🌧️', label: 'Heavy rain' },
  66: { icon: '🌧️', label: 'Freezing rain' },
  67: { icon: '🌧️', label: 'Freezing rain' },
  71: { icon: '🌨️', label: 'Light snow' },
  73: { icon: '🌨️', label: 'Snow' },
  75: { icon: '❄️', label: 'Heavy snow' },
  77: { icon: '🌨️', label: 'Snow grains' },
  80: { icon: '🌦️', label: 'Light showers' },
  81: { icon: '🌧️', label: 'Showers' },
  82: { icon: '⛈️', label: 'Heavy showers' },
  85: { icon: '🌨️', label: 'Snow showers' },
  86: { icon: '🌨️', label: 'Snow showers' },
  95: { icon: '⛈️', label: 'Thunderstorm' },
  96: { icon: '⛈️', label: 'Thunderstorm' },
  99: { icon: '⛈️', label: 'Hail storm' },
};

export function weatherCodeInfo(code) {
  return CODE_TABLE[code] || { icon: '🌡️', label: 'Unknown' };
}

// Travel-disruptive WMO codes → a short "heads up" label. Used as the reliable
// fallback for the day-of local-conditions strip when the news check is empty
// or unavailable (weather always resolves, news often doesn't).
const SEVERE_CODES = {
  65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  75: 'Heavy snow', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorms', 96: 'Thunderstorms', 99: 'Hail storm',
};

// Returns { kind:'weather', code|glyph, label, title } when today's weather is
// worth a heads-up, else null. `code` (a WMO code) renders via WeatherGlyph;
// `glyph:'heat'|'cold'` renders a heat/cold icon. Covers severe conditions plus
// extreme heat/cold.
export function severeWeatherAlert(wx) {
  if (!wx || typeof wx.code !== 'number') return null;
  const label = SEVERE_CODES[wx.code];
  if (label) {
    return { kind: 'weather', code: wx.code, label,
      title: `${label} expected today — keep some indoor time handy.` };
  }
  if (typeof wx.tempF === 'number' && wx.tempF >= 95) {
    return { kind: 'weather', glyph: 'heat', label: 'Heat',
      title: `Hot today (around ${wx.tempF}°F) — hydrate and seek shade.` };
  }
  if (typeof wx.lowF === 'number' && wx.lowF <= 14) {
    return { kind: 'weather', glyph: 'cold', label: 'Cold',
      title: `Cold today (low around ${wx.lowF}°F) — bundle up.` };
  }
  return null;
}

// ---- cache ---------------------------------------------------------------
let memCache = null;
function cache() {
  if (memCache) return memCache;
  try {
    memCache = JSON.parse(localStorage.getItem(WX_CACHE_KEY)) || {};
  } catch {
    memCache = {};
  }
  return memCache;
}
function persistCache() {
  try { localStorage.setItem(WX_CACHE_KEY, JSON.stringify(memCache || {})); } catch { /* ignore */ }
}
function roundCoord(n) { return Math.round(n * 100) / 100; }

// ---- forecast ------------------------------------------------------------
async function fetchForecast(lat, lng, startISO, endISO) {
  const url = `${FORECAST_URL}?latitude=${lat}&longitude=${lng}`
    + `&daily=weather_code,temperature_2m_max,temperature_2m_min`
    + `&temperature_unit=fahrenheit&timezone=auto&start_date=${startISO}&end_date=${endISO}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('forecast fetch failed');
  const data = await res.json();
  const out = {};
  const d = data.daily || {};
  (d.time || []).forEach((date, i) => {
    const max = d.temperature_2m_max[i];
    const min = d.temperature_2m_min[i];
    // Open-Meteo returns null for dates past the real forecast horizon. Skip
    // them — storing Math.round(null) === 0 would poison the day (0°) and drag
    // the stop's average high way down. The caller falls back to climatology.
    if (max == null || min == null) return;
    out[date] = {
      tempF: Math.round(max),
      lowF: Math.round(min),
      code: d.weather_code[i],
      source: 'live',
    };
  });
  return out;
}

// ---- climatology ---------------------------------------------------------
// Pull a contiguous summer window across recent years, then average by MM-DD.
async function fetchClimateSeries(lat, lng) {
  const startY = CLIMATE_YEARS[0];
  const endY = CLIMATE_YEARS[CLIMATE_YEARS.length - 1];
  const url = `${ARCHIVE_URL}?latitude=${lat}&longitude=${lng}`
    + `&start_date=${startY}-06-15&end_date=${endY}-08-31`
    + `&daily=weather_code,temperature_2m_max,temperature_2m_min`
    + `&temperature_unit=fahrenheit&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('archive fetch failed');
  const data = await res.json();
  const d = data.daily || {};
  // Group by MM-DD.
  const byMMDD = {};
  (d.time || []).forEach((date, i) => {
    const mmdd = date.slice(5);
    if (!byMMDD[mmdd]) byMMDD[mmdd] = { highs: [], lows: [], codes: [] };
    byMMDD[mmdd].highs.push(d.temperature_2m_max[i]);
    byMMDD[mmdd].lows.push(d.temperature_2m_min[i]);
    byMMDD[mmdd].codes.push(d.weather_code[i]);
  });
  return byMMDD;
}

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function mode(arr) {
  const counts = {};
  let best = arr[0]; let bestN = 0;
  arr.forEach((v) => { counts[v] = (counts[v] || 0) + 1; if (counts[v] > bestN) { bestN = counts[v]; best = v; } });
  return best;
}

function climateForDate(series, dateISO) {
  const mmdd = dateISO.slice(5);
  // Average a small ±1-day window for stability.
  const dd = parseISO(dateISO);
  const keys = [mmdd];
  [-1, 1].forEach((off) => {
    const t = new Date(dd); t.setDate(t.getDate() + off);
    keys.push(`${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
  });
  const highs = []; const lows = []; const codes = [];
  keys.forEach((k) => {
    if (series[k]) { highs.push(...series[k].highs); lows.push(...series[k].lows); codes.push(...series[k].codes); }
  });
  if (!highs.length) return null;
  return {
    tempF: Math.round(avg(highs)),
    lowF: Math.round(avg(lows)),
    code: mode(codes),
    source: 'typical',
  };
}

// ---- public API ----------------------------------------------------------
// Returns { [dateISO]: { tempF, lowF, code, source } } for the given dates.
export async function getRangeWeather(lat, lng, dates) {
  if (!dates.length) return {};
  const rlat = roundCoord(lat); const rlng = roundCoord(lng);
  const c = cache();
  const today = todayISO();
  const out = {};
  const need = [];

  dates.forEach((date) => {
    const key = `${rlat},${rlng}|${date}`;
    const within = daysBetween(today, date) >= 0 && daysBetween(today, date) <= FORECAST_HORIZON_DAYS;
    const cached = c[key];
    const fresh = cached && (Date.now() - cached.fetchedAt) < (within ? 3 * 3600e3 : 30 * 86400e3)
      && (cached.source === 'live') === within;
    if (fresh) { out[date] = cached; } else { need.push({ date, within, key }); }
  });

  const liveDates = need.filter((n) => n.within).map((n) => n.date).sort();
  let climDates = need.filter((n) => !n.within);

  // Live forecast: one batched call covering the span of needed live dates.
  if (liveDates.length) {
    try {
      const fc = await fetchForecast(rlat, rlng, liveDates[0], liveDates[liveDates.length - 1]);
      liveDates.forEach((date) => {
        if (fc[date]) {
          const v = { ...fc[date], fetchedAt: Date.now() };
          out[date] = v; c[`${rlat},${rlng}|${date}`] = v;
        }
      });
    } catch (e) { console.warn('Claus weather (live):', e.message); }
    // Dates we expected live but got nothing for (past the real horizon, or a
    // skipped null day) fall back to climatology so they still show a value
    // instead of vanishing — HORIZON_DAYS is only an estimate of Open-Meteo's
    // reach, which varies day to day.
    const missed = liveDates
      .filter((date) => !out[date])
      .map((date) => ({ date, within: false, key: `${rlat},${rlng}|${date}` }));
    if (missed.length) climDates = climDates.concat(missed);
  }

  // Climatology: one series per location, then per-date lookup.
  if (climDates.length) {
    try {
      const seriesKey = `series|${rlat},${rlng}`;
      let series = c[seriesKey] && (Date.now() - c[seriesKey].fetchedAt) < 60 * 86400e3
        ? c[seriesKey].data : null;
      if (!series) {
        series = await fetchClimateSeries(rlat, rlng);
        c[seriesKey] = { data: series, fetchedAt: Date.now() };
      }
      climDates.forEach(({ date, key }) => {
        const v = climateForDate(series, date);
        if (v) { const e = { ...v, fetchedAt: Date.now() }; out[date] = e; c[key] = e; }
      });
    } catch (e) { console.warn('Claus weather (climate):', e.message); }
  }

  persistCache();
  return out;
}

// Collapse a per-date map into one representative chip for a stop.
export function summarizeWeather(byDate) {
  // Ignore the null-forecast sentinel (tempF 0 / lowF 0) so a single bad day
  // can't drag the stop's average down; keep only real, finite readings.
  const entries = Object.values(byDate).filter(
    (e) => e && Number.isFinite(e.tempF) && !(e.tempF === 0 && e.lowF === 0),
  );
  if (!entries.length) return null;
  return {
    tempF: Math.round(avg(entries.map((e) => e.tempF))),
    lowF: Math.round(avg(entries.map((e) => e.lowF))),
    code: mode(entries.map((e) => e.code)),
    source: entries.some((e) => e.source === 'live') ? 'live' : 'typical',
  };
}

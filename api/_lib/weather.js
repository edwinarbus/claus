// Server-side weather (Open-Meteo). Mirrors src/data/weather.js:
//  - Dates within ~15 days → live forecast
//  - Further out → climatology from recent summers (marked 'typical')
// On the actual trip day the live path always runs (no stale typical data).

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_HORIZON_DAYS = 15;
const CLIMATE_YEARS = [2022, 2023, 2024];

function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function daysBetween(aISO, bISO) {
  return Math.round((parseISO(bISO) - parseISO(aISO)) / 86400000);
}

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function mode(arr) {
  const counts = {};
  let best = arr[0]; let bestN = 0;
  arr.forEach((v) => {
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > bestN) { bestN = counts[v]; best = v; }
  });
  return best;
}

async function fetchForecast(lat, lng, dateISO) {
  const url = `${FORECAST_URL}?latitude=${lat}&longitude=${lng}`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
    + `&temperature_unit=fahrenheit&timezone=auto&start_date=${dateISO}&end_date=${dateISO}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const d = (await r.json()).daily || {};
  if (!d.time || !d.time.length) return null;
  return {
    hi: Math.round(d.temperature_2m_max[0]),
    lo: Math.round(d.temperature_2m_min[0]),
    code: d.weather_code[0],
    source: 'live',
  };
}

async function fetchClimateSeries(lat, lng) {
  const startY = CLIMATE_YEARS[0];
  const endY = CLIMATE_YEARS[CLIMATE_YEARS.length - 1];
  const url = `${ARCHIVE_URL}?latitude=${lat}&longitude=${lng}`
    + `&start_date=${startY}-06-15&end_date=${endY}-08-31`
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
    + '&temperature_unit=fahrenheit&timezone=auto';
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  const daily = data.daily || {};
  const byMMDD = {};
  (daily.time || []).forEach((date, i) => {
    const mmdd = date.slice(5);
    if (!byMMDD[mmdd]) byMMDD[mmdd] = { highs: [], lows: [], codes: [] };
    byMMDD[mmdd].highs.push(daily.temperature_2m_max[i]);
    byMMDD[mmdd].lows.push(daily.temperature_2m_min[i]);
    byMMDD[mmdd].codes.push(daily.weather_code[i]);
  });
  return byMMDD;
}

function climateForDate(series, dateISO) {
  const mmdd = dateISO.slice(5);
  const dd = parseISO(dateISO);
  const keys = [mmdd];
  [-1, 1].forEach((off) => {
    const t = new Date(dd);
    t.setDate(t.getDate() + off);
    keys.push(`${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
  });
  const highs = []; const lows = []; const codes = [];
  keys.forEach((k) => {
    if (series[k]) {
      highs.push(...series[k].highs);
      lows.push(...series[k].lows);
      codes.push(...series[k].codes);
    }
  });
  if (!highs.length) return null;
  return {
    hi: Math.round(avg(highs)),
    lo: Math.round(avg(lows)),
    code: mode(codes),
    source: 'typical',
  };
}

// Returns { hi, lo, code, source } or null. `todayISO` should match brief.js
// (Europe/Copenhagen) so the morning cron and splash agree on "today".
// `forecastOnly` skips the slow climatology archive (welcome splash path).
async function fetchDayWeather(lat, lng, dateISO, todayISO, opts = {}) {
  if (!lat || !lng || !dateISO) return null;
  const offset = daysBetween(todayISO, dateISO);
  const within = offset >= 0 && offset <= FORECAST_HORIZON_DAYS;

  if (within) {
    try {
      const live = await fetchForecast(lat, lng, dateISO);
      if (live) return live;
    } catch { /* fall through */ }
  }

  if (opts.forecastOnly) return null;

  try {
    const series = await fetchClimateSeries(lat, lng);
    if (series) return climateForDate(series, dateISO);
  } catch { /* ignore */ }

  return null;
}

module.exports = { fetchDayWeather, FORECAST_HORIZON_DAYS };

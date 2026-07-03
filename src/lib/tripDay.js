// Helpers for the "today on trip" welcome splash — detect the active day,
// build a compact overview, and remember per-user dismissals.

import { todayISO, daysBetween, formatWithWeekday } from './dates.js';
import { isLocalDev, devSimulatedDateISO } from './devTripDay.js';
import { dayFullness } from '../data/pacing.js';
import { weatherCodeInfo } from '../data/weather.js';
import { sunTimesForDay } from './sun.js';

const SPLASH_KEY = 'scandiplan:tripSplashSeen';

function slotItems(day, key) {
  const v = day.slots?.[key];
  if (Array.isArray(v)) return v;
  if (v) return [v];
  return [];
}

function namesFor(items) {
  return items.map((it) => it.name).filter(Boolean);
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

// Names of the sights planned across the day (morning/afternoon/evening) —
// used by the local-news check and the morning brief.
export function plannedSightNames(day, opts = {}) {
  return activitySlotKeysForHour(opts.hour).flatMap((k) => namesFor(slotItems(day, k)));
}

// A specific calendar day inside the trip window.
export function findDayOnTrip(trip, dateISO) {
  if (!trip?.stops?.length || !dateISO) return null;
  if (daysBetween(trip.startDate, dateISO) < 0 || daysBetween(dateISO, trip.endDate) < 0) return null;
  for (const stop of trip.stops) {
    const day = (stop.days || []).find((d) => d.date === dateISO);
    if (day) {
      const dayIndex = typeof day.index === 'number' ? day.index : stop.days.indexOf(day);
      return { stop, day, dayIndex: Math.max(0, dayIndex) };
    }
  }
  return null;
}

// Today falls inside the trip window AND matches a planned day on a stop.
export function findTodayOnTrip(trip) {
  return findDayOnTrip(trip, todayISO());
}

// Real today, or a simulated trip day on localhost only.
export function resolveTripDayContext(trip) {
  if (!trip?.stops?.length) return null;
  const dateISO = isLocalDev() ? devSimulatedDateISO(trip) : todayISO();
  const ctx = findDayOnTrip(trip, dateISO);
  if (!ctx) return null;
  return { ...ctx, devSimulated: isLocalDev() && dateISO !== todayISO() };
}

// Context for a manual "preview the welcome screen" trigger — works any day:
// today's trip day if you're on the trip, otherwise the very first day of the
// trip. This never changes the trip; it's just which day the preview renders.
export function previewTripDayContext(trip) {
  if (!trip?.stops?.length) return null;
  const todays = findTodayOnTrip(trip);
  if (todays) return todays;
  for (const stop of trip.stops) {
    const day = (stop.days || [])[0];
    if (day) return { stop, day, dayIndex: 0 };
  }
  return null;
}

export function shouldShowTripSplash(who, dateISO) {
  // Open exactly once — the first time the app is opened that day. On localhost
  // add ?forceSplash=1 to re-show while iterating on the design.
  if (isLocalDev()) {
    const params = new URLSearchParams(location.search);
    if (params.get('forceSplash')) return true;
  }
  return !isSplashSeen(who, dateISO);
}

function splashKey(who, dateISO) {
  return `${who || 'anon'}|${dateISO}`;
}

export function isSplashSeen(who, dateISO) {
  try {
    const m = JSON.parse(localStorage.getItem(SPLASH_KEY) || '{}');
    return !!m[splashKey(who, dateISO)];
  } catch { return false; }
}

export function markSplashSeen(who, dateISO) {
  try {
    const m = JSON.parse(localStorage.getItem(SPLASH_KEY) || '{}');
    m[splashKey(who, dateISO)] = true;
    localStorage.setItem(SPLASH_KEY, JSON.stringify(m));
  } catch { /* ignore */ }
}

export function greetingForNow(who) {
  const h = new Date().getHours();
  let phrase = 'Hello';
  if (h >= 5 && h < 12) phrase = 'Good morning';
  else if (h >= 12 && h < 17) phrase = 'Good afternoon';
  else if (h >= 17 && h < 22) phrase = 'Good evening';
  else phrase = 'Good night';
  return who ? `${phrase}, ${who}` : phrase;
}

function isRainCode(code) {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

// Three period rows from one daily forecast (we only have daily hi/lo).
export function periodWeather(wx) {
  if (!wx) return null;
  const info = weatherCodeInfo(wx.code);
  const lo = wx.lowF;
  const hi = wx.tempF;
  const mid = Math.round((lo + hi) / 2);
  const rain = isRainCode(wx.code);
  return [
    { label: 'Morning', temp: lo, code: wx.code, info, note: rain ? 'chance of rain' : '' },
    { label: 'Afternoon', temp: hi, code: wx.code, info, note: '' },
    { label: 'Evening', temp: mid, code: wx.code, info, note: '' },
  ];
}

export function wearAdvice(wx, stop, dateISO) {
  if (!wx) return ['Pack a light day bag.', 'Bring an evening layer.'];
  const hi = wx.tempF;
  const lo = wx.lowF;
  const rain = isRainCode(wx.code);

  let comfort = 'Layer a tee with a sweater.';
  if (lo < 50 || hi < 55) comfort = 'Wear warm layers.';
  else if (hi >= 78) comfort = 'Dress light and breathable.';
  else if (hi >= 65) comfort = 'T-shirt weather today.';

  const sun = stop && dateISO ? sunTimesForDay(dateISO, stop.lat, stop.lng, stop.country) : null;
  let carry = hi >= 65 ? 'Bring a light layer for evening.' : 'Pack a light jacket.';
  if (rain) carry = 'Bring a compact umbrella or rain jacket.';
  else if (sun && !sun.polar && wx.code <= 2) carry = 'Sunglasses will help.';

  return [comfort, carry];
}

export function buildDayOverview(stop, day, opts = {}) {
  const slotKeys = activitySlotKeysForHour(opts.hour);
  const morning = slotKeys.includes('morning') ? namesFor(slotItems(day, 'morning')) : [];
  const afternoon = slotKeys.includes('afternoon') ? namesFor(slotItems(day, 'afternoon')) : [];
  const evening = slotKeys.includes('evening') ? namesFor(slotItems(day, 'evening')) : [];
  const meals = mealKeysForHour(opts.hour)
    .map((k) => slotItems(day, k)[0])
    .filter(Boolean)
    .map((it) => it.name);
  const lodging = day.slots?.lodging;
  const fullness = dayFullness(day);

  const highlights = [];
  if (morning.length) highlights.push({ iconKey: 'morning', text: morning.join(', ') });
  if (afternoon.length) highlights.push({ iconKey: 'afternoon', text: afternoon.join(', ') });
  if (evening.length) highlights.push({ iconKey: 'evening', text: evening.join(', ') });
  if (!highlights.length && meals.length) highlights.push({ iconKey: 'meal', text: `Meals: ${meals.join(', ')}` });

  let paceLine = '';
  if (fullness.level === 'empty') paceLine = 'Nothing on the calendar yet — a blank slate.';
  else if (fullness.under) paceLine = `${fullness.label} pace — room to add more if you want.`;
  else if (fullness.level === 'packed') paceLine = 'Nicely packed — a full but doable day ahead.';
  else if (fullness.level === 'overstuffed') paceLine = 'Ambitious schedule — pace yourselves.';
  else paceLine = `${fullness.label} pace today.`;

  const lodgingLine = lodging ? `Tonight: ${lodging.name}` : '';

  return {
    city: stop.name,
    dateLabel: formatWithWeekday(day.date),
    dayNumber: (day.index ?? 0) + 1,
    highlights,
    paceLine,
    lodgingLine,
    activityCount: morning.length + afternoon.length + evening.length + meals.length,
  };
}

function naturalList(arr, max = 3) {
  const a = arr.slice(0, max);
  if (a.length === 0) return '';
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(', ')}, and ${a[a.length - 1]}`;
}

// A warm, two-sentence tour-guide intro to the day. Sentence 1 sketches the
// shape of the day from the planned sights; sentence 2 covers pace + weather.
export function daySummary(stop, day, wx) {
  const morning = namesFor(slotItems(day, 'morning'));
  const afternoon = namesFor(slotItems(day, 'afternoon'));
  const evening = namesFor(slotItems(day, 'evening'));
  const ordered = [...morning, ...afternoon, ...evening];
  const meals = ['breakfast', 'lunch', 'dinner']
    .map((k) => slotItems(day, k)[0]).filter(Boolean).map((it) => it.name);
  const city = stop.name;
  const fullness = dayFullness(day);

  const paceWord = {
    empty: 'wide-open', light: 'relaxed', easy: 'relaxed', relaxed: 'relaxed',
    balanced: 'well-rounded', packed: 'full', overstuffed: 'ambitious',
  }[fullness.level] || 'lovely';

  // ---- Sentence 1: the arc of the day ----
  let s1;
  if (ordered.length === 0 && meals.length === 0) {
    s1 = `${city} is yours to discover today, with nothing locked in yet — the perfect day to wander and follow your curiosity.`;
  } else if (ordered.length === 0) {
    s1 = `${city} keeps things easy today, built around good meals and time to roam at your own pace.`;
  } else if (ordered.length === 1) {
    s1 = `Today in ${city} centers on ${ordered[0]}, with plenty of room to wander around it.`;
  } else if (morning.length && evening.length) {
    s1 = `Your day in ${city} eases from ${morning[0]} in the morning to ${evening[evening.length - 1]} after dark.`;
  } else {
    s1 = `${city} has a ${paceWord} day in store, taking in ${naturalList(ordered)}.`;
  }

  // ---- Sentence 2: pace + weather + a gentle nudge ----
  let s2;
  if (wx) {
    const info = weatherCodeInfo(wx.code);
    const hi = wx.tempF;
    const desc = (info.label || '').toLowerCase();
    const rain = isRainCode(wx.code);
    if (rain) {
      s2 = `Skies lean toward ${desc} with highs near ${hi}°, so tuck a layer and something for the rain into your bag before you head out.`;
    } else if (hi >= 75) {
      s2 = `It's looking ${desc} and warm around ${hi}°, ideal for taking it slow and staying out a little longer.`;
    } else if (hi <= 55) {
      s2 = `Expect ${desc} skies and a cool ${hi}°, so layer up and you'll be comfortable all day.`;
    } else {
      s2 = `Expect ${desc} skies and a mild ${hi}° — great weather for getting around on foot.`;
    }
  } else if (fullness.level === 'overstuffed' || fullness.level === 'packed') {
    s2 = `It's a full one, so pace yourselves, take breaks, and savor it rather than rushing.`;
  } else {
    s2 = `Lace up some comfortable shoes, take it at your own pace, and enjoy every bit of it.`;
  }

  return `${s1} ${s2}`;
}

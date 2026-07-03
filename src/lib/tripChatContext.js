// Compact, up-to-date itinerary context for the in-app travel chat. Keeps the
// prompt small by focusing on today/next legs and a one-line-per-stop overview.

import {
  todayISO, addDays, formatRange, formatShort, formatLong, formatWithWeekday, nightsBetween, daysBetween,
  parseNamedDateInText,
} from './dates.js';
import { format12 } from './time.js';
import { resolveTransport, formatDuration } from '../data/logistics.js';
import { resolveTripDayContext, previewTripDayContext, findDayOnTrip } from './tripDay.js';
import { dayFullness } from '../data/pacing.js';

const SLOTS = ['morning', 'afternoon', 'evening', 'breakfast', 'lunch', 'dinner'];
const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'];
const SLOT_L = {
  morning: 'AM', afternoon: 'PM', evening: 'Eve',
  breakfast: 'Brk', lunch: 'Lun', dinner: 'Din',
};
const MEAL_L = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
};

// Auto-placed catalog delicacies (meatballs, markets, pastries, etc.) — not reservations.
// Confirmed meals/restaurants are pinByName or custom (manual add / renamed booking).
export function isUnbookedCatalogMeal(it) {
  return !!(it && it.type === 'eat' && !it.pinByName && !it.custom);
}

/** @deprecated use isUnbookedCatalogMeal */
export const isUnbookedMealPlaceholder = isUnbookedCatalogMeal;

function contextSlotItem(it) {
  if (isUnbookedCatalogMeal(it)) return null;
  return it;
}

function slotItems(day, key) {
  const v = day.slots?.[key];
  if (Array.isArray(v)) return v;
  if (v) return [v];
  return [];
}

// How a scheduled item reads in context — mirrors the Claude export logic so
// manual restaurants (pinByName), delicacies @ venue, and notes all come through.
function placeLabel(it) {
  if (!it) return '';
  let s = it.name || '';
  if (it.type === 'eat') {
    if (it.pinByName) {
      if (it.address) s += ` (${it.address})`;
    } else if (it.venue) {
      s += ` @ ${it.venue}`;
    }
  } else if (it.venue) {
    s += ` @ ${it.venue}`;
  } else if (it.pinByName && it.address) {
    s += ` (${it.address})`;
  }
  if (it.type === 'travel') {
    const times = [it.depTime && format12(it.depTime), it.arrTime && format12(it.arrTime)].filter(Boolean).join('–');
    if (times) s += ` ${times}`;
  }
  if (it.notes && String(it.notes).trim()) s += ` — ${String(it.notes).trim()}`;
  return s;
}

function itemFingerprint(it) {
  if (!it) return '';
  return [
    it.name, it.type, it.venue, it.address, it.pinByName, it.custom,
    it.depTime, it.arrTime, it.notes,
  ].join('\0');
}

function dayPlanLine(day) {
  const bits = [];
  SLOTS.forEach((k) => {
    slotItems(day, k)
      .map(contextSlotItem)
      .filter(Boolean)
      .forEach((it) => bits.push(`${SLOT_L[k]}:${placeLabel(it)}`));
  });
  const hotel = day.slots?.lodging;
  if (hotel?.name) bits.push(`Sleep:${placeLabel(hotel)}`);
  return bits.join(' · ') || 'empty';
}

function dayPlanForSlots(day, slotKeys) {
  const bits = [];
  slotKeys.forEach((k) => {
    slotItems(day, k)
      .map(contextSlotItem)
      .filter(Boolean)
      .forEach((it) => bits.push(`${SLOT_L[k]}:${placeLabel(it)}`));
  });
  return bits.join(' · ') || 'nothing planned';
}

// Trip-relative anchor: real today on trip, dev-simulated day, or calendar today.
function chatAnchorDate(trip) {
  const tripCtx = resolveTripDayContext(trip);
  if (tripCtx?.day?.date) return { dateISO: tripCtx.day.date, tripCtx };
  return { dateISO: todayISO(), tripCtx: null };
}

function describeTripDay(trip, dateISO) {
  const ctx = findDayOnTrip(trip, dateISO);
  if (!ctx) {
    const inWindow = trip?.startDate && trip?.endDate
      && daysBetween(trip.startDate, dateISO) >= 0
      && daysBetween(dateISO, trip.endDate) >= 0;
    return {
      dateISO,
      onTrip: false,
      label: `${formatWithWeekday(dateISO)} — ${inWindow ? 'on the trip window but no day plan' : 'not on the itinerary'}`,
    };
  }
  const { stop, day } = ctx;
  const dayNum = (typeof day.index === 'number' ? day.index : 0) + 1;
  return {
    dateISO,
    onTrip: true,
    stop,
    day,
    label: `${formatWithWeekday(dateISO)} (Day ${dayNum}) in ${stop.name}, ${stop.country}`,
    plan: dayPlanLine(day),
    lodging: day.slots?.lodging?.name || null,
  };
}

// Map words like "today", "tonight", "tomorrow" in the user's message to trip dates.
const TEMPORAL_RULES = [
  { re: /\bday after tomorrow\b/i, phrase: 'day after tomorrow', offset: 2 },
  { re: /\btomorrow\s+night\b/i, phrase: 'tomorrow night', offset: 1, slots: ['evening', 'dinner'], lodging: true },
  { re: /\btomorrow\s+evening\b/i, phrase: 'tomorrow evening', offset: 1, slots: ['evening', 'dinner'] },
  { re: /\btomorrow\s+morning\b/i, phrase: 'tomorrow morning', offset: 1, slots: ['morning', 'breakfast'] },
  { re: /\btomorrow\b/i, phrase: 'tomorrow', offset: 1 },
  { re: /\byesterday\b/i, phrase: 'yesterday', offset: -1 },
  { re: /\btonight\b/i, phrase: 'tonight', offset: 0, slots: ['evening', 'dinner'], lodging: true },
  { re: /\bthis\s+evening\b/i, phrase: 'this evening', offset: 0, slots: ['evening', 'dinner'] },
  { re: /\bthis\s+afternoon\b/i, phrase: 'this afternoon', offset: 0, slots: ['afternoon', 'lunch'] },
  { re: /\bthis\s+morning\b/i, phrase: 'this morning', offset: 0, slots: ['morning', 'breakfast'] },
  { re: /\blater\s+today\b/i, phrase: 'later today', offset: 0, slotsFromNow: true },
  { re: /\brest\s+of\s+(?:the\s+)?day\b/i, phrase: 'rest of the day', offset: 0, slotsFromNow: true },
  { re: /\btoday\b/i, phrase: 'today', offset: 0 },
];

const IMPLICIT_PLAN_RE = /\b(what (?:should|can|to) (?:we|I) (?:do|see)|where (?:should|to) (?:we )?(?:eat|go)|suggestions?|ideas? for)\b/i;

function slotsRemainingToday(hour) {
  if (hour < 11) return ['morning', 'afternoon', 'evening', 'lunch', 'dinner'];
  if (hour < 14) return ['afternoon', 'evening', 'lunch', 'dinner'];
  if (hour < 17) return ['afternoon', 'evening', 'dinner'];
  if (hour < 21) return ['evening', 'dinner'];
  return ['evening', 'dinner'];
}

const COUNTRY_ISO = {
  Denmark: 'DK',
  Sweden: 'SE',
  Norway: 'NO',
  Finland: 'FI',
  Estonia: 'EE',
  Canada: 'CA',
};

// IANA timezones for web_search user_location (Claude web search tool).
const COUNTRY_TZ = {
  Denmark: 'Europe/Copenhagen',
  Sweden: 'Europe/Stockholm',
  Norway: 'Europe/Oslo',
  Finland: 'Europe/Helsinki',
  Estonia: 'Europe/Tallinn',
  Canada: 'America/Toronto',
};

const CITY_TZ = {
  copenhagen: 'Europe/Copenhagen',
  aarhus: 'Europe/Copenhagen',
  aero: 'Europe/Copenhagen',
  kalmar: 'Europe/Stockholm',
  stockholm: 'Europe/Stockholm',
  gothenburg: 'Europe/Stockholm',
  malmo: 'Europe/Stockholm',
  oslo: 'Europe/Oslo',
  bergen: 'Europe/Oslo',
  flam: 'Europe/Oslo',
  geiranger: 'Europe/Oslo',
  stavanger: 'Europe/Oslo',
  tromso: 'Europe/Oslo',
  lofoten: 'Europe/Oslo',
  helsinki: 'Europe/Helsinki',
  tallinn: 'Europe/Tallinn',
  munich: 'Europe/Berlin',
};

function timezoneForStop(stop) {
  if (!stop) return 'Europe/Oslo';
  if (stop.cityId && CITY_TZ[stop.cityId]) return CITY_TZ[stop.cityId];
  return COUNTRY_TZ[stop.country] || 'Europe/Oslo';
}

function localNowInTimezone(timezone) {
  const now = new Date();
  try {
    const label = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(now);
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(now));
    return { label, hour: Number.isFinite(hour) ? hour : now.getHours(), timezone };
  } catch {
    return {
      label: now.toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      }),
      hour: now.getHours(),
      timezone,
    };
  }
}

function formatTimeAnchors(trip) {
  const { dateISO: anchorDate, tripCtx } = chatAnchorDate(trip);
  const calendarToday = todayISO();
  const anchorStop = tripCtx?.stop || previewTripDayContext(trip)?.stop || null;
  const { label: localNow, hour } = anchorStop
    ? localNowInTimezone(timezoneForStop(anchorStop))
    : localNowInTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const lines = [
    `Calendar today: ${formatWithWeekday(calendarToday)}`,
    `Trip anchor (resolve "today"/"tonight"/"tomorrow" from here): ${formatWithWeekday(anchorDate)}${tripCtx ? ` in ${tripCtx.stop.name}` : ' (not on a planned trip day)'}`,
    anchorStop
      ? `Local time now in ${anchorStop.name}: ${localNow} (${timezoneForStop(anchorStop)})`
      : `Local time now: ${localNow}`,
  ];
  const tomorrow = describeTripDay(trip, addDays(anchorDate, 1));
  lines.push(`Tomorrow from anchor: ${tomorrow.label}`);
  if (tripCtx?.day) {
    const lodging = tripCtx.day.slots?.lodging?.name;
    if (lodging) lines.push(`Tonight's lodging (anchor date): ${lodging}`);
    if (hour >= 17) lines.push('Note: it\'s evening/night at the destination — "tonight" means this anchor date.');
  }
  return lines.join('\n');
}

// Per-message block — always sent so follow-up turns keep date awareness.
export function buildQueryTimeFocus(trip, message) {
  const text = String(message || '').trim();
  if (!text || !trip?.stops?.length) return '';

  const { dateISO: anchorDate } = chatAnchorDate(trip);
  const seen = new Set();
  const lines = [];

  for (const rule of TEMPORAL_RULES) {
    if (!rule.re.test(text) || seen.has(rule.phrase)) continue;
    seen.add(rule.phrase);

    const targetDate = addDays(anchorDate, rule.offset);
    const info = describeTripDay(trip, targetDate);
    lines.push(`"${rule.phrase}" → ${info.label}`);

    if (info.onTrip) {
      const hour = localNowInTimezone(timezoneForStop(info.stop)).hour;
      let slotKeys = rule.slots;
      if (rule.slotsFromNow && rule.offset === 0) slotKeys = slotsRemainingToday(hour);
      if (slotKeys) {
        const partial = dayPlanForSlots(info.day, slotKeys);
        lines.push(`  Focus (${slotKeys.map((k) => SLOT_L[k] || k).join(', ')}): ${partial}`);
      } else {
        lines.push(`  Plan: ${info.plan}`);
      }
      if (rule.lodging && info.lodging) lines.push(`  Lodging: ${info.lodging}`);
      else if (rule.phrase === 'tonight' || rule.phrase === 'tomorrow night') {
        lines.push(info.lodging ? `  Lodging: ${info.lodging}` : '  Lodging: not booked yet');
      }
    }
  }

  if (!lines.length && IMPLICIT_PLAN_RE.test(text)) {
    const { dateISO: anchorDate, tripCtx } = chatAnchorDate(trip);
    if (tripCtx) {
      const info = describeTripDay(trip, anchorDate);
      if (info.onTrip) {
        const hour = localNowInTimezone(timezoneForStop(tripCtx.stop)).hour;
        const slotKeys = slotsRemainingToday(hour);
        lines.push(`Planning question with no date word — assuming trip anchor (today on trip): ${info.label}`);
        lines.push(`  Focus (${slotKeys.map((k) => SLOT_L[k] || k).join(', ')}): ${dayPlanForSlots(info.day, slotKeys)}`);
        if (info.lodging && hour >= 17) lines.push(`  Lodging tonight: ${info.lodging}`);
      }
    }
  }

  if (!lines.length) {
    const tripYear = Number((trip?.startDate || '').slice(0, 4)) || new Date().getFullYear();
    const named = parseNamedDateInText(text, tripYear);
    if (named) {
      const info = describeTripDay(trip, named);
      lines.push(`calendar date in message → ${info.label} (${named})`);
      if (info.onTrip) {
        if (/\bdinner\b/i.test(text)) lines.push(`  Use dinner slot on ${named} in ${info.stop.name} (stopId ${info.stop.id})`);
        else if (/\blunch\b/i.test(text)) lines.push(`  Use lunch slot on ${named} in ${info.stop.name} (stopId ${info.stop.id})`);
        else if (/\bbreakfast\b/i.test(text)) lines.push(`  Use breakfast slot on ${named} in ${info.stop.name} (stopId ${info.stop.id})`);
      }
    }
  }

  if (!lines.length) return '';
  return `[QUERY FOCUS — user's relative dates]\n${lines.join('\n')}`;
}

function normalizeForMatch(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

const CITY_ALIASES = {
  copenhagen: ['cph', 'kobenhavn', 'københavn'],
  stockholm: ['sto'],
  helsinki: ['hel'],
  bergen: [],
  oslo: [],
  tromso: ['tromso'],
  malmo: ['malmo'],
  aero: ['aeroskobing', 'aroskobing', 'aero'],
  flam: ['flam', 'aurland'],
  geiranger: ['geirangerfjord'],
  stavanger: ['lysefjord'],
  lofoten: ['lofoten islands', 'svolvaer', 'reine'],
  tallinn: [],
  aarhus: ['arhus'],
  kalmar: [],
  gothenburg: ['goteborg'],
  munich: ['münchen', 'munchen'],
};

const VAGUE_FOLLOW_UP_RE = /^(?:any|what about|how about|also|and |more |those|that|there\b|ones?\b|options?|alternatives?|instead|vegetarian|vegan|gluten|cheaper|closer|nicer|quieter|which\b|worth\b|still\b|really\b|open\b)/i;

const WHOLE_TRIP_RE = /\b(?:whole|entire|full)\s+(?:trip|itinerary|route|plan)\b|\ball\s+stops\b|\bacross\s+the\s+trip\b|\bwhole\s+scandinav|\bbiggest\s+gaps?\b|\btrip\s+overview\b|\bevery\s+(?:stop|city|leg)\b/i;

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenMatchesText(text, token) {
  if (!token || token.length < 3) return false;
  if (token.length < 4) return new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i').test(text);
  return text.includes(token);
}

function stopSearchTokens(stop) {
  const tokens = new Set();
  const full = normalizeForMatch(stop.name);
  tokens.add(full);
  const short = full.split(/[/(]/)[0].trim();
  if (short) tokens.add(short);
  if (stop.cityId && CITY_ALIASES[stop.cityId]) {
    CITY_ALIASES[stop.cityId].forEach((a) => tokens.add(normalizeForMatch(a)));
  }
  return [...tokens].sort((a, b) => b.length - a.length);
}

function findMentionedStop(trip, message) {
  const text = normalizeForMatch(message);
  let best = null;
  let bestLen = 0;
  for (const stop of trip.stops || []) {
    for (const token of stopSearchTokens(stop)) {
      if (!tokenMatchesText(text, token)) continue;
      if (token.length > bestLen) {
        best = stop;
        bestLen = token.length;
      }
    }
  }
  return best;
}

function findLegPhraseStop(trip, message) {
  const text = normalizeForMatch(message);
  for (const stop of trip.stops || []) {
    for (const token of stopSearchTokens(stop)) {
      if (token.length < 4) continue;
      const esc = escapeRegExp(token);
      if (new RegExp(`\\b${esc}\\s+(?:leg|stop|days?)\\b`, 'i').test(text)) return stop;
      if (new RegExp(`\\bin\\s+${esc}\\b`, 'i').test(text)) return stop;
      if (new RegExp(`\\bwhen\\s+we(?:'re|\\s+are)\\s+in\\s+${esc}\\b`, 'i').test(text)) return stop;
    }
  }
  return null;
}

function findCountryMentionedStop(trip, message) {
  const text = normalizeForMatch(message);
  const { dateISO: anchorDate } = chatAnchorDate(trip);
  for (const country of Object.keys(COUNTRY_ISO)) {
    const cn = normalizeForMatch(country);
    if (!new RegExp(`\\b${escapeRegExp(cn)}\\b`, 'i').test(text)) continue;
    const inCountry = (trip.stops || []).filter((s) => s.country === country);
    if (!inCountry.length) continue;
    if (inCountry.length === 1) return inCountry[0];
    const anchorCtx = findDayOnTrip(trip, anchorDate);
    if (anchorCtx?.stop?.country === country) return anchorCtx.stop;
    const anchorIdx = anchorCtx ? trip.stops.indexOf(anchorCtx.stop) : 0;
    return inCountry.find((s) => trip.stops.indexOf(s) >= anchorIdx) || inCountry[0];
  }
  return null;
}

function stopFromTemporalFocus(trip, message) {
  const text = String(message || '').trim();
  if (!text) return null;
  const { dateISO: anchorDate } = chatAnchorDate(trip);
  for (const rule of TEMPORAL_RULES) {
    if (!rule.re.test(text)) continue;
    const info = describeTripDay(trip, addDays(anchorDate, rule.offset));
    if (info.onTrip && info.stop) return info.stop;
  }
  if (IMPLICIT_PLAN_RE.test(text)) {
    const { tripCtx } = chatAnchorDate(trip);
    if (tripCtx?.stop) return tripCtx.stop;
  }
  return null;
}

function isVagueFollowUp(message) {
  const t = String(message || '').trim();
  if (!t || t.length > 160) return false;
  if (VAGUE_FOLLOW_UP_RE.test(t)) return true;
  return t.split(/\s+/).length <= 8 && !/\b(in|at|near|from)\s+\w/i.test(t);
}

function stopFromRecentMessages(trip, recentMessages, skipText) {
  const skip = normalizeForMatch(skipText);
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const prev = String(recentMessages[i] || '').trim();
    if (!prev || normalizeForMatch(prev) === skip) continue;
    const stop = findMentionedStop(trip, prev)
      || findLegPhraseStop(trip, prev)
      || stopFromTemporalFocus(trip, prev)
      || findCountryMentionedStop(trip, prev);
    if (stop) return stop;
  }
  return null;
}

function resolveWebSearchStop(trip, message, opts = {}) {
  const { recentMessages = [], priorStop = null } = opts;
  const text = String(message || '').trim();
  if (!text || !trip?.stops?.length) return null;

  let stop = findMentionedStop(trip, text) || findLegPhraseStop(trip, text);
  if (stop) return { stop, source: 'mentioned' };

  stop = stopFromTemporalFocus(trip, text);
  if (stop) return { stop, source: 'time' };

  stop = findCountryMentionedStop(trip, text);
  if (stop) return { stop, source: 'country' };

  stop = stopFromRecentMessages(trip, recentMessages, text);
  if (stop) return { stop, source: 'thread' };

  if (priorStop && isVagueFollowUp(text)) {
    return { stop: priorStop, source: 'follow-up' };
  }

  if (IMPLICIT_PLAN_RE.test(text)) {
    const { tripCtx } = chatAnchorDate(trip);
    if (tripCtx?.stop) return { stop: tripCtx.stop, source: 'anchor' };
  }

  stop = chatAnchorDate(trip).tripCtx?.stop
    || previewTripDayContext(trip)?.stop
    || trip.stops[0];
  return stop ? { stop, source: 'default' } : null;
}

/** City/country in the message → scoped context; otherwise full trip. */
export function resolveContextScope(trip, message) {
  const text = String(message || '').trim();
  if (!text || !trip?.stops?.length || WHOLE_TRIP_RE.test(text)) {
    return { mode: 'full' };
  }
  const stop = findMentionedStop(trip, text)
    || findLegPhraseStop(trip, text)
    || findCountryMentionedStop(trip, text);
  if (!stop) return { mode: 'full' };
  const idx = trip.stops.indexOf(stop);
  return {
    mode: 'stop',
    stop,
    prev: idx > 0 ? trip.stops[idx - 1] : null,
    next: idx < trip.stops.length - 1 ? trip.stops[idx + 1] : null,
  };
}

// City + IANA timezone for Claude web_search user_location (type: approximate).
export function resolveWebSearchLocation(trip, message, opts = {}) {
  const resolved = resolveWebSearchStop(trip, message, opts);
  if (!resolved?.stop) return null;
  const { stop, source } = resolved;
  const city = stop.name.split(/[/(]/)[0].trim();
  const timezone = timezoneForStop(stop);
  const { label: localNow } = localNowInTimezone(timezone);
  return {
    stopId: stop.id,
    source,
    city,
    region: stop.country,
    country: COUNTRY_ISO[stop.country] || 'NO',
    timezone,
    localNow,
    label: `${city}, ${stop.country}`,
  };
}

export function formatWebSearchLocationBlock(location) {
  if (!location?.label) return '';
  const lines = [`Place: ${location.label}`];
  if (location.timezone) lines.push(`IANA timezone: ${location.timezone}`);
  if (location.localNow) lines.push(`Local time now: ${location.localNow}`);
  lines.push('Treat "today", "tonight", "open now", and opening hours in this destination timezone — not the traveler\'s home timezone.');
  return `[WEB SEARCH LOCATION — bias live results here]\n${lines.join('\n')}`;
}

function collectBookedMeals(trip, { stopId } = {}) {
  const rows = [];
  for (const stop of trip.stops || []) {
    if (stopId && stop.id !== stopId) continue;
    for (const day of stop.days || []) {
      MEAL_SLOTS.forEach((key) => {
        slotItems(day, key).forEach((it) => {
          if (!it.pinByName && !it.custom) return;
          const label = placeLabel(it);
          if (!label) return;
          rows.push(`${formatShort(day.date)} · ${MEAL_L[key]} · ${stop.name}: ${label} [booked]`);
        });
      });
      ['morning', 'afternoon', 'evening'].forEach((key) => {
        slotItems(day, key).forEach((it) => {
          if (it.type !== 'eat' || (!it.pinByName && !it.custom)) return;
          const label = placeLabel(it);
          if (!label) return;
          rows.push(`${formatShort(day.date)} · ${SLOT_L[key]} meal · ${stop.name}: ${label} [booked]`);
        });
      });
    }
  }
  return rows;
}

function lodgingStatus(stop) {
  const nights = nightsBetween(stop.startDate, stop.endDate);
  const booked = (stop.days || []).map((d) => d.slots?.lodging?.name).filter(Boolean);
  const unique = [...new Set(booked)];
  const unbooked = nights - booked.length;
  if (!unique.length) return `UNBOOKED (${nights}n)`;
  if (unbooked > 0) return `${unique.join(', ')} (${unbooked}n unbooked)`;
  return unique.join(', ');
}

// Fingerprint the plan so we only resend context when the itinerary changes.
export function tripContextHash(trip) {
  const parts = [trip.startDate, trip.endDate, trip.name];
  for (const s of trip.stops || []) {
    parts.push(s.id, s.startDate, s.endDate, s.name);
    for (const d of s.days || []) {
      parts.push(d.date);
      for (const k of [...SLOTS, 'lodging']) {
        const v = d.slots?.[k];
        if (Array.isArray(v)) v.forEach((it) => parts.push(itemFingerprint(it)));
        else if (v) parts.push(itemFingerprint(v));
      }
    }
    if (s.transportToNext) parts.push(JSON.stringify(s.transportToNext));
  }
  let h = 0;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function contextHeaderLines(trip, who) {
  const todayCtx = resolveTripDayContext(trip);
  const previewCtx = !todayCtx ? previewTripDayContext(trip) : null;
  const anchorStop = todayCtx?.stop || previewCtx?.stop || null;
  const nowLine = anchorStop
    ? (() => {
      const { label } = localNowInTimezone(timezoneForStop(anchorStop));
      return `Now in ${anchorStop.name}: ${label} (${timezoneForStop(anchorStop)})`;
    })()
    : (() => {
      const { label } = localNowInTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      return `Now: ${label} (device local time)`;
    })();

  return [
    `# ${trip.name}`,
    `Dates: ${formatRange(trip.startDate, trip.endDate)} · ${trip.stops.length} stops`,
    `Travelers: Tyler & Edwin${who ? ` · asking as ${who}` : ''}`,
    nowLine,
    '',
    '## TIME ANCHORS',
    formatTimeAnchors(trip),
  ];
}

function appendTodaySection(lines, trip, todayCtx, previewCtx) {
  const today = todayISO();
  if (todayCtx) {
    const { stop, day } = todayCtx;
    const fullness = dayFullness(day);
    lines.push('');
    lines.push(`## TODAY — ${formatWithWeekday(day.date)} in ${stop.name}, ${stop.country}`);
    lines.push(`Pace: ${fullness.label}${fullness.under ? ' (room to add more)' : ''}`);
    lines.push(`Plan: ${dayPlanLine(day)}`);
    const lodging = day.slots?.lodging;
    if (lodging?.name) lines.push(`Tonight: ${lodging.name}`);

    const nextDays = (stop.days || []).slice(todayCtx.dayIndex + 1, todayCtx.dayIndex + 3);
    nextDays.forEach((d, i) => {
      lines.push(`Next+${i + 1} (${formatWithWeekday(d.date)}): ${dayPlanLine(d)}`);
    });
    return stop;
  }
  if (today < trip.startDate) {
    lines.push('');
    lines.push(`## UPCOMING — trip starts ${formatShort(trip.startDate)} (${daysBetween(today, trip.startDate)} days away)`);
    if (previewCtx) {
      lines.push(`First day (${formatWithWeekday(previewCtx.day.date)}): ${dayPlanLine(previewCtx.day)}`);
    }
    return previewCtx?.stop || null;
  }
  if (today > trip.endDate) {
    lines.push('');
    lines.push(`## PAST — trip ended ${formatShort(trip.endDate)}`);
    return null;
  }
  lines.push('');
  lines.push(`## GAP DAY — ${formatWithWeekday(today)} falls between planned stops`);
  return null;
}

function appendStopDayDetail(lines, stop) {
  lines.push('');
  lines.push(`### All days in ${stop.name}`);
  (stop.days || []).forEach((d) => {
    lines.push(`${formatWithWeekday(d.date)}: ${dayPlanLine(d)}`);
  });
}

function formatTransportLegLine(fromStop, toStop) {
  const t = resolveTransport(fromStop, toStop);
  if (!t) return '';
  const tr = fromStop.transportToNext || {};
  const dep = [formatShort(t.depDate), format12(t.depTime), t.depStation].filter(Boolean).join(' ');
  const arr = [formatShort(t.arrDate), format12(t.arrTime), t.arrStation].filter(Boolean).join(' ');
  let leg = `${fromStop.name} → ${toStop.name}: ${t.mode} ~${formatDuration(t.durationMin)}`;
  if (dep) leg += ` · dep ${dep}`;
  if (arr) leg += ` → arr ${arr}`;
  if (tr.bookingRef) leg += ` · ref ${tr.bookingRef}`;
  if (t.note || tr.note) leg += ` (${t.note || tr.note})`;
  return leg;
}

function appendMustDos(lines, stop) {
  const picks = ['see', 'do'].map((k) => {
    const items = (stop.recs?.[k] || []).filter((r) => r.tier === 1).map((r) => r.name);
    return items.length ? `${k}: ${items.slice(0, 5).join(', ')}` : null;
  }).filter(Boolean);
  if (picks.length) lines.push(`\n★ Must-dos in ${stop.name}: ${picks.join(' · ')}`);
}

function appendCompactRoute(lines, trip, focusStop) {
  lines.push('');
  lines.push('## ROUTE');
  const focusIdx = trip.stops.indexOf(focusStop);
  trip.stops.forEach((s, i) => {
    const n = nightsBetween(s.startDate, s.endDate);
    const marker = i === focusIdx ? ' ← query focus' : '';
    lines.push(`${i + 1}. ${s.name}, ${s.country} (${formatShort(s.startDate)}–${formatShort(s.endDate)}, ${n}n) · Lodging: ${lodgingStatus(s)}${marker}`);
  });
}

function buildScopedTripChatContext(trip, who, scope) {
  const { stop, prev, next } = scope;
  const lines = contextHeaderLines(trip, who);

  const todayCtx = resolveTripDayContext(trip);
  const previewCtx = !todayCtx ? previewTripDayContext(trip) : null;
  const todayStop = appendTodaySection(lines, trip, todayCtx, previewCtx);
  if (todayStop && todayStop.id !== stop.id) {
    lines.push(`(Today is in ${todayStop.name}; query focuses on ${stop.name}.)`);
  }

  lines.push('');
  lines.push(`## FOCUS — ${stop.name}, ${stop.country}`);
  lines.push('Detailed plan for the city named in the user\'s question (other stops summarized in ROUTE).');
  appendStopDayDetail(lines, stop);
  appendMustDos(lines, stop);

  lines.push('');
  lines.push('## TRANSPORT');
  if (prev) {
    const inbound = formatTransportLegLine(prev, stop);
    if (inbound) lines.push(`Inbound: ${inbound}`);
  } else {
    lines.push('Inbound: trip start (no prior leg).');
  }
  if (next) {
    const outbound = formatTransportLegLine(stop, next);
    if (outbound) lines.push(`Outbound: ${outbound}`);
  } else {
    lines.push('Outbound: trip end (no following leg).');
  }

  appendCompactRoute(lines, trip, stop);

  const bookedMeals = collectBookedMeals(trip, { stopId: stop.id });
  if (bookedMeals.length) {
    lines.push('');
    lines.push(`## BOOKED MEALS — ${stop.name}`);
    lines.push('Confirmed reservations in this stop only:');
    bookedMeals.forEach((row) => lines.push(`- ${row}`));
  }

  return lines.join('\n').trim();
}

function buildFullTripChatContext(trip, who) {
  const todayCtx = resolveTripDayContext(trip);
  const previewCtx = !todayCtx ? previewTripDayContext(trip) : null;
  const lines = contextHeaderLines(trip, who);

  const activeStop = appendTodaySection(lines, trip, todayCtx, previewCtx);
  if (todayCtx) {
    appendStopDayDetail(lines, todayCtx.stop);
  }

  lines.push('');
  lines.push('## ROUTE');
  trip.stops.forEach((s, i) => {
    const n = nightsBetween(s.startDate, s.endDate);
    lines.push(`${i + 1}. ${s.name}, ${s.country} (${formatShort(s.startDate)}–${formatShort(s.endDate)}, ${n}n) · Lodging: ${lodgingStatus(s)}`);
    if (i < trip.stops.length - 1) {
      const leg = formatTransportLegLine(s, trip.stops[i + 1]);
      if (leg) lines.push(`   ${leg}`);
    }
  });

  const bookedMeals = collectBookedMeals(trip);
  if (bookedMeals.length) {
    lines.push('');
    lines.push('## BOOKED MEALS & RESTAURANTS');
    lines.push('Confirmed restaurant reservations and manual meal entries (auto-placed catalog delicacies excluded):');
    bookedMeals.forEach((row) => lines.push(`- ${row}`));
  }

  const stopsToDetail = [];
  if (activeStop) stopsToDetail.push(activeStop);
  const nextIdx = activeStop ? trip.stops.indexOf(activeStop) + 1 : 0;
  if (nextIdx < trip.stops.length && trip.stops[nextIdx] !== activeStop) {
    stopsToDetail.push(trip.stops[nextIdx]);
  }
  for (const s of stopsToDetail) {
    if (todayCtx && s.id === todayCtx.stop.id) continue;
    appendMustDos(lines, s);
  }

  return lines.join('\n').trim();
}

export function buildTripChatContext(trip, who, opts = {}) {
  if (!trip?.stops?.length) return 'No stops planned yet.';

  const message = opts.message ? String(opts.message) : '';
  const scope = message ? resolveContextScope(trip, message) : { mode: 'full' };
  if (scope.mode === 'stop') {
    return buildScopedTripChatContext(trip, who, scope);
  }
  return buildFullTripChatContext(trip, who);
}

function hasDinner(day) {
  return slotItems(day, 'dinner').some((it) => !isUnbookedMealPlaceholder(it));
}

function stopsWithLodgingGaps(trip) {
  return (trip.stops || []).filter((s) => {
    const nights = nightsBetween(s.startDate, s.endDate);
    const booked = (s.days || []).map((d) => d.slots?.lodging?.name).filter(Boolean).length;
    return booked < nights;
  });
}

// Context-aware starter prompts — prioritized for the traveler's current moment.
// Iconic, city-specific ideas so the starter prompts read like real agentic
// edits ("Book Noma…", "Add a Nærøyfjord cruise…") rather than generic Q&A.
// Keyed by a substring of the stop name so renamed/compound stops still match.
const CITY_IDEAS = {
  copenhagen: { table: 'Noma', add: 'a Reffen street-food night', swap: 'a canal kayak tour' },
  bergen: { table: 'Lysverket', add: 'the Fløibanen funicular at sunset', swap: 'a Bryggen wharf morning' },
  'flåm': { table: 'Ægir BrewPub', add: 'a Nærøyfjord cruise', swap: 'the Flåm Railway ride' },
  sognefjord: { table: 'Ægir BrewPub', add: 'a Nærøyfjord cruise', swap: 'a kayak paddle on the fjord' },
  oslo: { table: 'Maaemo', add: 'a Bygdøy museums morning', swap: 'the Vigeland sculpture park' },
  stockholm: { table: 'Frantzén', add: 'a Gamla Stan food crawl', swap: 'a Vasa Museum visit' },
  helsinki: { table: 'Olo', add: 'a harbor sauna evening', swap: 'a Suomenlinna ferry trip' },
  tallinn: { table: 'NOA', add: 'an Old Town walking tour', swap: 'a Telliskivi design afternoon' },
  munich: { table: 'Tantris', add: 'a day trip to Neuschwanstein', swap: 'an English Garden beer-garden stop' },
};

function cityIdea(stop) {
  const n = (stop?.name || '').toLowerCase();
  for (const key of Object.keys(CITY_IDEAS)) {
    if (n.includes(key)) return CITY_IDEAS[key];
  }
  return null;
}

// Agentic starter prompts: imperative edits grounded in real stops + dates
// ("Book Noma for our first night in Copenhagen") mixed with a few harder,
// reflective questions. Returns up to ~12 for the two-row marquee.
export function buildChatSuggestions(trip) {
  if (!trip?.stops?.length) return [];

  const out = [];
  const push = (s) => { if (s && !out.includes(s)) out.push(s); };
  const stops = trip.stops;
  const first = stops[0];
  const today = todayISO();

  // Prompts mirror what Claus can actually do — add things to the itinerary,
  // rearrange days, and advise — not make real reservations. So it's "Add Noma
  // to…" (a real edit), never "Book a flight" (something it can't do).

  // Showcase edit: drop an iconic table onto the first night.
  const firstIdea = cityIdea(first);
  if (firstIdea?.table) {
    push(`Add ${firstIdea.table} to our first night in ${first.name}`);
  }

  // Current-moment actions.
  const todayCtx = resolveTripDayContext(trip);
  if (todayCtx) {
    const { stop, day } = todayCtx;
    const fullness = dayFullness(day);
    if (fullness.level === 'packed' || fullness.level === 'overstuffed') {
      push(`Trim today in ${stop.name} — what should we cut?`);
    } else if (fullness.level === 'empty' || fullness.under) {
      push(`Fill today in ${stop.name} with something local`);
    }
    if (!hasDinner(day)) {
      const idea = cityIdea(stop);
      push(idea?.table
        ? `Add ${idea.table} for dinner tonight in ${stop.name}`
        : `Add a dinner spot tonight in ${stop.name}`);
    }
  } else if (today < trip.startDate) {
    push(`What should we lock in before ${formatLong(trip.startDate)}?`);
  }

  // Transport legs → advice, not booking.
  let legs = 0;
  for (let i = 0; i < stops.length - 1 && legs < 2; i++) {
    const a = stops[i];
    if (a.transportToNext?.bookingRef) continue;
    const b = stops[i + 1];
    push(`What's the best way to get from ${a.name} to ${b.name}?`);
    legs++;
  }

  // Lodging gap → advice.
  const gap = stopsWithLodgingGaps(trip)[0];
  if (gap) push(`Where should we stay in ${gap.name}?`);

  // Grounded activity adds spread across the trip.
  let adds = 0;
  for (const stop of stops) {
    if (adds >= 3) break;
    const idea = cityIdea(stop);
    if (idea?.add) {
      push(`Add ${idea.add} in ${stop.name} on ${formatLong(stop.startDate)}`);
      adds++;
    }
  }

  // Harder, reflective prompts.
  [
    "What's the riskiest connection in our whole trip?",
    'Where are we over-planned versus under-planned?',
    'If we had to cut a day, which should it be?',
    'Which day feels most rushed?',
  ].forEach(push);

  return out.slice(0, 12);
}

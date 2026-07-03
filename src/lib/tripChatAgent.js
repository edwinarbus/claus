import { formatWithWeekday, parseNamedDateInText } from './dates.js';
import { format12, formatTimesInText, parseFlexibleClock } from './time.js';
import { daySlotForClock, SLOT_BY_KEY } from '../data/slots.js';
import {
  minutesBetweenClock, resolveTransport, transportIcon, transportTargetsLeg,
} from '../data/logistics.js';
import { CITIES } from '../data/catalog.js';
import { isUnbookedCatalogMeal } from './tripChatContext.js';

export const TICKET_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const TICKET_ACCEPT = 'application/pdf,image/*';

const EDIT_DATE_RE = /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/;
const EDIT_TIME_RE = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}:\d{2}\b/i;
const EDIT_MONTH_DATE_RE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

const EDIT_CONFIRM_RE = /^(yes|yep|yeah|ok|okay|sure|do it|go ahead|please add|please do|that works|sounds good)\b[!.?]*$/i;

/** Short affirmations after Claus proposed something ("do it", "yes", …). */
export function isEditConfirmation(text) {
  const t = String(text || '').trim();
  return t.length > 0 && t.length <= 80 && EDIT_CONFIRM_RE.test(t);
}

const EDIT_INTENT_RE = /\b(add|move|remove|delete|book|schedule|put|place|swap|change|update|shift|reschedule|insert)\b/i;

/** Whether a web-search turn should also expose propose_trip_edits (adds latency). */
export function wantsTripEditTool(text, { webSearch = false } = {}) {
  if (!webSearch) return true;
  const t = String(text || '').trim();
  if (!t) return false;
  if (isEditConfirmation(t)) return true;
  return EDIT_INTENT_RE.test(t);
}

function parseTimeFromUserText(raw) {
  const s = String(raw || '');
  const hm12 = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (hm12) return parseFlexibleClock(hm12[0]);
  const hm24 = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (hm24) return parseFlexibleClock(hm24[0]);
  return '';
}

function mealSlotFromUserText(raw) {
  const s = String(raw || '');
  if (/\bbreakfast\b/i.test(s)) return 'breakfast';
  if (/\blunch\b/i.test(s)) return 'lunch';
  if (/\bdinner\b|\bsupper\b/i.test(s)) return 'dinner';
  return '';
}

function defaultArrTime(depTime) {
  const clock = parseFlexibleClock(depTime);
  if (!clock) return '';
  const h = Number(clock.slice(0, 2));
  const m = clock.slice(3, 5);
  if (!Number.isFinite(h)) return clock;
  return `${String(Math.min(23, h + 2)).padStart(2, '0')}:${m}`;
}

function isAddMetadataLine(line, trip) {
  const l = String(line || '').trim();
  if (!l) return true;
  if (/^add\s*:?$/i.test(l)) return true;
  if (EDIT_DATE_RE.test(l) || EDIT_MONTH_DATE_RE.test(l) || EDIT_TIME_RE.test(l)) return true;
  if (resolveDate(l, trip) || parseNamedDateInText(l, tripYear(trip))) return true;
  return false;
}

function parseVenueFromAddText(raw, trip) {
  const lines = String(raw || '').split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (isAddMetadataLine(line, trip)) continue;
    const inline = line.replace(/^add\s*:?\s*/i, '').trim();
    if (inline && !isAddMetadataLine(inline, trip)) return text(inline, 180);
  }
  let s = String(raw || '').replace(/^add\s*:?\s*/i, '').trim();
  s = s.replace(EDIT_MONTH_DATE_RE, ' ').replace(EDIT_TIME_RE, ' ').replace(EDIT_DATE_RE, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(?:breakfast|lunch|dinner|supper)\b/ig, ' ');
  s = s.replace(/\b(?:to|on|for|at)\s+(?:the\s+)?$/i, ' ');
  s = s.replace(/\s+\b(?:to|on|for|at)\s*$/i, ' ');
  return text(s.replace(/[,\s]+$/, '').replace(/\s+/g, ' ').trim(), 180) || '';
}

function isPronounVenueReference(venue) {
  return /^(?:ok(?:ay)?\s+)?(?:please\s+)?(?:add\s+)?(?:it|that|this|the\s+(?:place|restaurant|spot|one))(?:\b|$)/i
    .test(String(venue || '').trim());
}

function resolveDateFromUserText(raw, trip) {
  const body = String(raw || '');
  for (const line of body.split(/\n/)) {
    const iso = resolveDate(line.trim(), trip) || parseNamedDateInText(line, tripYear(trip));
    if (iso) return iso;
  }
  return resolveDate(body, trip) || parseNamedDateInText(body, tripYear(trip)) || '';
}

// Deterministic restaurant/meal add when user gives venue + date (+ optional time).
export function buildDirectMealAddAction(userText, trip) {
  const raw = String(userText || '').trim();
  if (!/\badd\b/i.test(raw)) return null;

  const dateIso = resolveDateFromUserText(raw, trip);
  const venue = parseVenueFromAddText(raw, trip);
  if (!dateIso || !venue || isPronounVenueReference(venue)) return null;

  const clock = parseTimeFromUserText(raw);
  const slotKey = clock ? mealSlotForClock(clock) : mealSlotFromUserText(raw) || 'dinner';
  const stop = findStopForDate(trip, dateIso);
  if (!stop || !findDay(stop, dateIso)) return null;

  const depTime = clock || '';
  const arrTime = depTime ? defaultArrTime(depTime) : '';

  return {
    type: 'set_day_slot',
    op: 'add',
    confidence: 0.95,
    needsConfirmation: false,
    summary: `Add ${venue} to ${slotKey} on ${formatWithWeekday(dateIso)}`,
    stopId: stop.id,
    date: dateIso,
    slotKey,
    itemName: venue,
    item: {
      name: venue,
      type: 'eat',
      pinByName: true,
      venue,
      depTime,
      arrTime,
    },
  };
}

const SLOT_KEYS = ['morning', 'afternoon', 'evening', 'breakfast', 'lunch', 'dinner', 'lodging'];
const MEAL_KEYS = ['breakfast', 'lunch', 'dinner'];
const MULTI_SLOTS = new Set(['morning', 'afternoon', 'evening']);
const TRANSPORT_MODES = ['train', 'bus', 'car', 'ferry', 'express boat', 'overnight boat', 'flight'];

function text(v, max = 400) {
  return String(v || '').trim().slice(0, max);
}

function isDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '');
}

function normalizeDate(v) {
  const s = String(v || '').trim();
  if (isDate(s)) return s;
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const ymd = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return '';
}

const MONTH_IDX = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

// Parse a month-name date ("July 20", "Jul 20", "20 July", "July 20 2026") and,
// when the year is omitted, infer it from the trip (pick the year that lands the
// date inside the trip window). Returns '' if it isn't a month-name date.
function monthDayToISO(raw, trip) {
  const s = String(raw || '').trim().toLowerCase();
  let mon; let day; let yr;
  let m = s.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/);
  if (m && MONTH_IDX[m[1]] != null) { mon = MONTH_IDX[m[1]]; day = +m[2]; yr = m[3] ? +m[3] : null; }
  else {
    m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?(?:,?\s*(\d{4}))?$/);
    if (m && MONTH_IDX[m[2]] != null) { mon = MONTH_IDX[m[2]]; day = +m[1]; yr = m[3] ? +m[3] : null; }
  }
  if (mon == null || !day || day < 1 || day > 31) return '';
  const mm = String(mon + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  if (yr) return `${yr}-${mm}-${dd}`;
  const years = [];
  if (trip?.startDate) years.push(+trip.startDate.slice(0, 4));
  if (trip?.endDate) years.push(+trip.endDate.slice(0, 4));
  if (!years.length) years.push(new Date().getFullYear());
  let fallback = '';
  for (const y of years) {
    const iso = `${y}-${mm}-${dd}`;
    fallback = fallback || iso;
    if (trip?.startDate && trip?.endDate && iso >= trip.startDate && iso <= trip.endDate) return iso;
  }
  return fallback;
}

// Numeric (normalizeDate) first, then a month-name date understood against the trip.
function resolveDate(raw, trip) {
  return normalizeDate(raw) || monthDayToISO(raw, trip);
}

function mealSlotForClock(clock) {
  const min = clock ? parseInt(clock.split(':')[0], 10) : NaN;
  if (!Number.isFinite(min)) return '';
  if (min < 11) return 'breakfast';
  if (min < 16) return 'lunch';
  return 'dinner';
}

function inferSlotKey(action, payload = {}) {
  const type = payload.type || '';
  const clock = parseFlexibleClock(payload.depTime || payload.arrTime);
  const namedVenue = text(payload.name || action?.itemName);
  const eatLike = type === 'eat' || payload.pinByName || payload.venue
    || (namedVenue && clock)
    || ['breakfast', 'lunch', 'dinner'].some((k) => new RegExp(`\\b${k}\\b`, 'i').test(`${action?.summary || ''} ${action?.itemName || ''} ${action?.reason || ''}`));
  // A meal with a booking time is slotted BY THE CLOCK — 6pm dinner, noon lunch,
  // 8am breakfast — overriding whatever slot the model guessed.
  if (eatLike && clock) return mealSlotForClock(clock);
  if (SLOT_KEYS.includes(action?.slotKey)) return action.slotKey;
  if (eatLike) {
    const hint = `${action?.summary || ''} ${action?.reason || ''}`;
    if (/\bbreakfast\b/i.test(hint)) return 'breakfast';
    if (/\blunch\b/i.test(hint)) return 'lunch';
    if (/\bdinner\b/i.test(hint)) return 'dinner';
    return 'dinner';
  }
  if (type === 'lodging' || /\b(hotel|lodging|check[- ]?in)\b/i.test(action?.summary || '')) return 'lodging';
  if (clock) return daySlotForClock(clock) || 'morning';
  return '';
}

function enrichPayload(action) {
  const payload = { ...(payloadSource(action) || {}) };
  if (!text(payload.name) && text(action?.itemName)) payload.name = text(action.itemName);
  if (!text(payload.name) && text(payload.venue)) payload.name = text(payload.venue);
  if (!text(payload.venue) && text(payload.name) && payload.pinByName) payload.venue = text(payload.name);
  return payload;
}

function tripYear(trip) {
  return Number((trip?.startDate || '').slice(0, 4)) || new Date().getFullYear();
}

function mergeMealTimes(action, trip) {
  const hay = [action?.summary, action?.reason, action?.itemName, action?.item?.notes].filter(Boolean).join(' ');
  const clock = parseFlexibleClock(action?.item?.depTime)
    || parseFlexibleClock(action?.patch?.depTime)
    || parseTimeFromUserText(hay);
  if (!clock) return action;
  const next = { ...action };
  const merged = {
    ...(next.item || {}),
    depTime: parseFlexibleClock(next.item?.depTime) || clock,
    arrTime: parseFlexibleClock(next.item?.arrTime) || defaultArrTime(clock),
  };
  if (!merged.type && text(merged.name || next.itemName)) {
    merged.type = 'eat';
    merged.pinByName = true;
  }
  if (!merged.venue && merged.pinByName && merged.name) merged.venue = merged.name;
  next.item = merged;
  return next;
}

function prepareAction(action, trip) {
  if (!action || typeof action !== 'object') return action;
  let next = mergeMealTimes({ ...action }, trip);
  const resolvedDate = resolveActionDate(next, trip);
  if (resolvedDate) next.date = resolvedDate;
  else next.date = resolveDate(next.date, trip) || next.date;
  next.fromDate = resolveDate(next.fromDate, trip) || next.fromDate;
  next.toDate = resolveDate(next.toDate, trip) || next.toDate;
  // No explicit date but the item carries one (e.g. a travel depDate)? Use it.
  if (!next.date && next.item) next.date = resolveDate(next.item.depDate || next.item.date, trip) || next.date;
  if (!next.stopId && next.date) {
    const stop = findStopForDate(trip, next.date);
    if (stop) next.stopId = stop.id;
  }
  if (!next.stopId) {
    const mentioned = findStopMentionedInAction(trip, next);
    if (mentioned) next.stopId = mentioned.id;
  }
  const payload = enrichPayload(next);
  if (!SLOT_KEYS.includes(next.slotKey)) {
    const inferred = inferSlotKey(next, payload);
    if (inferred) next.slotKey = inferred;
  }
  if (next.item && typeof next.item === 'object') {
    next.item = { ...next.item };
    if (!text(next.item.name) && text(payload.name)) next.item.name = payload.name;
    if (!text(next.item.depTime) && payload.depTime) next.item.depTime = payload.depTime;
    if (!text(next.item.arrTime) && payload.arrTime) next.item.arrTime = payload.arrTime;
  }
  return next;
}

function formatStoredClock(v) {
  return parseFlexibleClock(v);
}

function formatNoteText(note) {
  return text(formatTimesInText(note), 1200);
}

function slotItems(day, key) {
  const v = day?.slots?.[key];
  if (Array.isArray(v)) return v;
  if (v) return [v];
  return [];
}

function daySlotItemBrief(it) {
  if (!it || isUnbookedCatalogMeal(it)) return null;
  return {
    id: it.id || '',
    name: it.name || '',
    type: it.type || '',
    venue: it.venue || '',
    address: it.address || '',
    depTime: it.depTime || '',
    arrTime: it.arrTime || '',
    notes: text(it.notes, 180),
  };
}

function daySlotBrief(day, key) {
  const v = day?.slots?.[key];
  if (Array.isArray(v)) {
    return v.map(daySlotItemBrief).filter(Boolean);
  }
  return daySlotItemBrief(v);
}

function itemTypeForSlot(slotKey, provided) {
  if (provided && ['see', 'do', 'eat', 'lodging', 'travel'].includes(provided)) return provided;
  if (['breakfast', 'lunch', 'dinner'].includes(slotKey)) return 'eat';
  if (slotKey === 'lodging') return 'lodging';
  return 'do';
}

function cleanItem(src = {}, slotKey = '') {
  const type = itemTypeForSlot(slotKey, src.type);
  const item = {
    name: text(src.name, 180) || (type === 'travel' ? 'Travel' : 'Untitled'),
    type,
    emoji: text(src.emoji, 16),
    address: text(src.address, 240),
    venue: text(src.venue, 180),
    venueAddress: text(src.venueAddress, 240),
    notes: formatNoteText(src.notes),
    sourceUrl: text(src.sourceUrl, 500),
    pinByName: !!src.pinByName || ['breakfast', 'lunch', 'dinner', 'lodging'].includes(slotKey),
    custom: true,
  };

  if (type === 'travel') {
    if (TRANSPORT_MODES.includes(src.mode)) item.mode = src.mode;
    if (item.mode && !item.emoji) item.emoji = transportIcon(item.mode);
    ['depStation', 'arrStation', 'bookingRef'].forEach((k) => {
      const v = text(src[k], 180);
      if (v) item[k] = v;
    });
    ['depTime', 'arrTime'].forEach((k) => {
      const clock = formatStoredClock(src[k]);
      if (clock) item[k] = clock;
    });
    ['depDate', 'arrDate'].forEach((k) => {
      const date = normalizeDate(src[k]);
      if (date) item[k] = date;
    });
    if (Number.isFinite(src.durationMin) && src.durationMin > 0) item.durationMin = Math.round(src.durationMin);
    if (Array.isArray(src.tickets) && src.tickets.length) item.tickets = src.tickets.map((t) => ({ ...t }));
  } else {
    ['depTime', 'arrTime'].forEach((k) => {
      const clock = formatStoredClock(src[k]);
      if (clock) item[k] = clock;
    });
    if (item.depTime && item.arrTime && !item.notes) {
      item.notes = `Reservation ${format12(item.depTime)}–${format12(item.arrTime)}`;
    }
  }

  if (item.sourceUrl) item.links = [{ label: 'Link', url: item.sourceUrl }];
  Object.keys(item).forEach((k) => {
    if (item[k] === '' || item[k] == null) delete item[k];
  });
  return item;
}

function cleanPatch(src = {}, slotKey = '') {
  const patch = {};
  ['name', 'emoji', 'address', 'venue', 'venueAddress', 'sourceUrl'].forEach((k) => {
    const v = text(src[k], k === 'notes' ? 1200 : 500);
    if (v) patch[k] = v;
  });
  const note = formatNoteText(src.notes);
  if (note) patch.notes = note;
  if (src.pinByName) patch.pinByName = true;
  const type = src.type ? itemTypeForSlot(slotKey, src.type) : '';
  if (type) patch.type = type;

  if (type === 'travel' || TRANSPORT_MODES.includes(src.mode)) {
    if (TRANSPORT_MODES.includes(src.mode)) {
      patch.mode = src.mode;
      patch.emoji = transportIcon(src.mode);
    }
    ['depStation', 'arrStation', 'bookingRef'].forEach((k) => {
      const v = text(src[k], 180);
      if (v) patch[k] = v;
    });
    ['depTime', 'arrTime'].forEach((k) => {
      const clock = formatStoredClock(src[k]);
      if (clock) patch[k] = clock;
    });
    ['depDate', 'arrDate'].forEach((k) => {
      const date = normalizeDate(src[k]);
      if (date) patch[k] = date;
    });
    if (Number.isFinite(src.durationMin) && src.durationMin > 0) patch.durationMin = Math.round(src.durationMin);
  } else {
    ['depTime', 'arrTime'].forEach((k) => {
      const clock = formatStoredClock(src[k]);
      if (clock) patch[k] = clock;
    });
  }

  if (patch.sourceUrl) patch.links = [{ label: 'Link', url: patch.sourceUrl }];
  return patch;
}

function hasPayload(src = {}) {
  return Object.entries(src || {}).some(([key, value]) => {
    if (key === 'pinByName') return value === true;
    if (key === 'durationMin') return Number.isFinite(value) && value > 0;
    return typeof value === 'string' ? value.trim() !== '' : value != null && value !== false;
  });
}

function payloadSource(action) {
  return hasPayload(action.patch) ? action.patch : (action.item || {});
}

function cleanTransportPatch(src = {}) {
  const patch = {};
  if (TRANSPORT_MODES.includes(src.mode)) patch.mode = src.mode;
  ['depStation', 'arrStation', 'bookingRef'].forEach((k) => {
    const v = text(src[k], 180);
    if (v) patch[k] = v;
  });
  ['depTime', 'arrTime'].forEach((k) => {
    const clock = formatStoredClock(src[k]);
    if (clock) patch[k] = clock;
  });
  ['depDate', 'arrDate'].forEach((k) => {
    const date = normalizeDate(src[k]);
    if (date) patch[k] = date;
  });
  const note = formatNoteText(src.note || src.notes);
  if (note) patch.note = note;
  if (Number.isFinite(src.durationMin) && src.durationMin > 0) patch.durationMin = Math.round(src.durationMin);
  if (patch.bookingRef) patch.booked = true;
  return patch;
}

function findStop(trip, id) {
  return (trip?.stops || []).find((s) => s.id === id) || null;
}

function findStopForDate(trip, date) {
  const iso = resolveDate(date, trip) || (isDate(date) ? date : '');
  if (!iso) return null;
  // Exact day, else the stop whose date range contains it (covers checkout /
  // arrival overlap days and any date not explicitly in the days array).
  return (trip?.stops || []).find((stop) => findDay(stop, iso))
    || (trip?.stops || []).find((stop) => stop.startDate && stop.endDate && iso >= stop.startDate && iso <= stop.endDate)
    || null;
}

function normalizeMatchText(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function diningHaystack(fields = {}, match = {}) {
  return normalizeMatchText([
    fields.venue,
    fields.venueAddress,
    fields.title,
    fields.note,
    fields.depStation,
    fields.arrStation,
    match.reason,
  ].filter(Boolean).join(' '));
}

function diningStopMatches(stop, fields = {}, match = {}) {
  const hay = diningHaystack(fields, match);
  if (!hay || !stop) return false;
  const city = stop.cityId ? CITIES[stop.cityId] : null;
  const needles = [
    stop.name,
    stop.cityId,
    stop.country,
    city?.name,
    city?.country,
  ].map(normalizeMatchText).filter((s) => s.length >= 3);
  return needles.some((needle) => hay.includes(needle));
}

function diningDates(trip, target = {}, fields = {}, match = {}) {
  const out = [];
  [
    target.date,
    fields.resDate,
    fields.depDate,
    fields.arrDate,
    (match.reason || '').match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0],
  ].forEach((candidate) => {
    const date = resolveDate(candidate, trip) || (isDate(candidate) ? candidate : '');
    if (date && !out.includes(date)) out.push(date);
  });
  return out;
}

function chooseDiningStopForDate(trip, date, target = {}, fields = {}, match = {}) {
  const explicit = findStop(trip, target.stopId);
  if (explicit && findDay(explicit, date)) return explicit;
  const candidates = (trip?.stops || []).filter((stop) => findDay(stop, date));
  if (!candidates.length) return null;
  const cityMatched = candidates.find((stop) => diningStopMatches(stop, fields, match));
  if (cityMatched) return cityMatched;
  const mentionsAnotherTripStop = (trip?.stops || []).some((stop) => diningStopMatches(stop, fields, match));
  return mentionsAnotherTripStop ? null : candidates[0];
}

function resolveDiningPlacement(trip, target = {}, fields = {}, match = {}) {
  for (const date of diningDates(trip, target, fields, match)) {
    const stop = chooseDiningStopForDate(trip, date, target, fields, match);
    const day = findDay(stop, date);
    if (stop && day) return { stop, day };
  }
  return { stop: null, day: null };
}

function findStopMentionedInAction(trip, action) {
  const hay = `${action?.summary || ''} ${action?.reason || ''} ${action?.itemName || ''}`.toLowerCase();
  if (!hay.trim()) return null;
  for (const stop of trip?.stops || []) {
    const name = text(stop.name).toLowerCase();
    const cityId = text(stop.cityId).toLowerCase();
    if (name && hay.includes(name)) return stop;
    if (cityId && hay.includes(cityId)) return stop;
  }
  return null;
}

function resolveActionDate(action, trip) {
  const fields = [action?.date, action?.fromDate, action?.toDate];
  for (const field of fields) {
    const resolved = resolveDate(field, trip);
    if (resolved) return resolved;
  }
  const hay = [action?.summary, action?.reason, action?.itemName].filter(Boolean).join(' ');
  return resolveDate(hay, trip) || parseNamedDateInText(hay, tripYear(trip)) || '';
}

function isClearAddAction(trip, action) {
  if (action?.type !== 'set_day_slot') return false;
  const op = String(action?.op || 'add').toLowerCase();
  if (op && !['add', 'replace', ''].includes(op)) return false;
  const { stop, day, slotKey, date } = resolveSlotContext(trip, action);
  const dateIso = day?.date || (isDate(date) ? date : '');
  const payload = enrichPayload(prepareAction(action, trip));
  const name = text(payload.name || action?.itemName || action?.item?.name);
  return !!(stop && dateIso && slotKey && name);
}

function findDay(stop, date) {
  const iso = normalizeDate(date) || (isDate(date) ? date : '');
  if (!iso || !stop) return null;
  return (stop?.days || []).find((d) => d.date === iso) || null;
}

function findItem(day, slotKey, itemId, itemName) {
  const items = slotItems(day, slotKey);
  if (itemId) {
    const exact = items.find((it) => it.id === itemId);
    if (exact) return exact;
  }
  const needle = text(itemName).toLowerCase();
  if (!needle) return null;
  return items.find((it) => text(it.name).toLowerCase() === needle)
    || items.find((it) => text(it.venue).toLowerCase() === needle)
    || items.find((it) => text(it.name).toLowerCase().includes(needle))
    || items.find((it) => text(it.venue).toLowerCase().includes(needle));
}

function findItemOnDay(day, itemId, itemName) {
  if (!day) return null;
  if (itemId) {
    for (const slotKey of SLOT_KEYS) {
      const item = findItem(day, slotKey, itemId, '');
      if (item) return { slotKey, item };
    }
  }
  const needle = text(itemName).toLowerCase();
  if (needle) {
    for (const slotKey of SLOT_KEYS) {
      const item = findItem(day, slotKey, '', itemName);
      if (item) return { slotKey, item };
    }
  }
  return null;
}

function resolveSlotContext(trip, action) {
  const prepared = prepareAction(action, trip);
  const date = resolveActionDate(prepared, trip) || prepared.date || '';
  let stop = findStop(trip, prepared.stopId);
  if (!stop && date) stop = findStopForDate(trip, date);
  if (!stop) stop = findStopMentionedInAction(trip, prepared);
  const day = findDay(stop, date);
  let slotKey = SLOT_KEYS.includes(prepared.slotKey) ? prepared.slotKey : '';
  if (!slotKey && day) {
    const located = findItemOnDay(day, prepared.itemId, prepared.itemName || prepared.item?.name);
    if (located) slotKey = located.slotKey;
  }
  if (!slotKey) slotKey = inferSlotKey(prepared, enrichPayload(prepared));
  return { action: prepared, stop, day, date, slotKey };
}

function actionSummary(action, fallback) {
  return text(action.summary, 180) || fallback;
}

function appliedResult(summary, stop, date, slotKey, itemName, verb = 'Updated') {
  return {
    ok: true,
    summary,
    stopId: stop?.id || '',
    date: date || '',
    slotKey: slotKey || '',
    itemName: text(itemName, 180),
    verb,
  };
}

function formatAppliedDate(date) {
  if (!isDate(date)) return '';
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function formatAppliedEdit(row) {
  if (!row || typeof row === 'string') return text(row, 180);
  const name = text(row.itemName, 180);
  const verb = text(row.verb, 40) || 'Updated';
  const slot = text(row.slotKey, 40);
  const date = formatAppliedDate(row.date);
  if (name && slot && date) return `${verb} ${name} for ${slot} on ${date}.`;
  if (name && date) return `${verb} ${name} on ${date}.`;
  if (name) return `${verb} ${name}.`;
  return text(row.summary, 180);
}

function formatAppliedEdits(applied = []) {
  const rows = applied.map(formatAppliedEdit).filter(Boolean).slice(0, 4);
  if (!rows.length) return 'Done.';
  return rows.join('\n');
}

function skip(reason, action) {
  return { ok: false, summary: actionSummary(action, reason), reason };
}

function applySetDaySlot(trip, dispatch, action) {
  const { action: prepared, stop, day, date, slotKey } = resolveSlotContext(trip, action);
  const dateIso = day?.date || (isDate(date) ? date : '');
  if (!slotKey || !stop || !dateIso || !SLOT_BY_KEY[slotKey]) {
    if (stop && dateIso && !day) {
      return skip(`I couldn't find ${formatWithWeekday(dateIso)} on your plan in ${stop.name}.`, prepared);
    }
    return skip('I could not find that day or slot.', prepared);
  }

  const itemName = prepared.itemName || prepared.item?.name || prepared.item?.venue;
  const existing = findItem(day, slotKey, prepared.itemId, itemName);
  const op = prepared.op || 'add';
  const slotDef = SLOT_BY_KEY[slotKey];
  const payload = enrichPayload(prepared);
  const dayDate = day?.date || dateIso;

  if (existing && op === 'update') {
    const patch = cleanPatch(payload, slotKey);
    if (!Object.keys(patch).length) return skip('There was nothing new to change.', prepared);
    dispatch({ type: 'UPDATE_SLOT_ITEM', stopId: stop.id, date: dayDate, slotKey, itemId: existing.id, patch });
    return appliedResult(actionSummary(prepared, `Updated ${existing.name}`), stop, dayDate, slotKey, existing.name, 'Updated');
  }

  if (existing && prepared.itemId) {
    const patch = cleanPatch(payload, slotKey);
    if (!Object.keys(patch).length) return skip('There was nothing new to change.', prepared);
    dispatch({ type: 'UPDATE_SLOT_ITEM', stopId: stop.id, date: dayDate, slotKey, itemId: existing.id, patch });
    return appliedResult(actionSummary(prepared, `Updated ${existing.name}`), stop, dayDate, slotKey, existing.name, 'Updated');
  }

  const item = cleanItem({ ...(prepared.item || {}), ...payload }, slotKey);
  if (!text(item.name) || item.name === 'Untitled') {
    return skip('I need a name or venue for the new plan item.', prepared);
  }

  dispatch({ type: 'ASSIGN_TO_SLOT', stopId: stop.id, date: dayDate, slotKey, item });
  const verb = existing && slotDef.kind === 'single' ? 'Set' : 'Added';
  return appliedResult(actionSummary(prepared, `${verb} ${item.name} on ${formatWithWeekday(dayDate)}`), stop, dayDate, slotKey, item.name, verb);
}

function applyUpdateDaySlotItem(trip, dispatch, action) {
  let { action: prepared, stop, day, slotKey } = resolveSlotContext(trip, action);
  let item = slotKey ? findItem(day, slotKey, prepared.itemId, prepared.itemName || prepared.item?.name) : null;
  if (!item && day) {
    const located = findItemOnDay(day, prepared.itemId, prepared.itemName || prepared.item?.name);
    if (located) {
      slotKey = located.slotKey;
      item = located.item;
    }
  }
  if (!slotKey || !stop || !day || !item) return skip('I could not find the item to update.', prepared);
  const patch = cleanPatch(enrichPayload(prepared), slotKey);
  if (!Object.keys(patch).length) return skip('There was nothing new to change.', prepared);
  dispatch({ type: 'UPDATE_SLOT_ITEM', stopId: stop.id, date: day.date, slotKey, itemId: item.id, patch });
  return appliedResult(actionSummary(prepared, `Updated ${item.name}`), stop, day.date, slotKey, item.name, 'Updated');
}

function applyRemoveDaySlotItem(trip, dispatch, action) {
  let { action: prepared, stop, day, slotKey } = resolveSlotContext(trip, action);
  let item = slotKey ? findItem(day, slotKey, prepared.itemId, prepared.itemName || prepared.item?.name) : null;
  if (!item && day) {
    const located = findItemOnDay(day, prepared.itemId, prepared.itemName || prepared.item?.name);
    if (located) {
      slotKey = located.slotKey;
      item = located.item;
    }
  }
  if (!slotKey || !stop || !day || !item) return skip('I could not find the item to remove.', prepared);
  dispatch({ type: 'REMOVE_FROM_SLOT', stopId: stop.id, date: day.date, slotKey, itemId: item.id });
  return appliedResult(actionSummary(prepared, `Removed ${item.name}`), stop, day.date, slotKey, item.name, 'Removed');
}

function applyMoveDaySlotItem(trip, dispatch, action) {
  const prepared = prepareAction(action, trip);
  const fromStop = findStop(trip, prepared.fromStopId || prepared.stopId)
    || findStopForDate(trip, prepared.fromDate || prepared.date);
  const fromDate = normalizeDate(prepared.fromDate || prepared.date);
  const fromDay = findDay(fromStop, fromDate);
  let fromSlotKey = SLOT_KEYS.includes(prepared.fromSlotKey) ? prepared.fromSlotKey : '';
  let item = fromSlotKey
    ? findItem(fromDay, fromSlotKey, prepared.fromItemId || prepared.itemId, prepared.itemName)
    : null;
  if (!item && fromDay) {
    const located = findItemOnDay(fromDay, prepared.fromItemId || prepared.itemId, prepared.itemName);
    if (located) {
      fromSlotKey = located.slotKey;
      item = located.item;
    }
  }

  const toStop = findStop(trip, prepared.toStopId || prepared.stopId || prepared.fromStopId)
    || findStopForDate(trip, prepared.toDate || prepared.date);
  const toDate = normalizeDate(prepared.toDate || prepared.date);
  const toDay = findDay(toStop, toDate);
  let toSlotKey = SLOT_KEYS.includes(prepared.toSlotKey) ? prepared.toSlotKey : '';
  if (!toSlotKey) toSlotKey = inferSlotKey(prepared, enrichPayload(prepared));

  if (!fromStop || !fromDay || !toStop || !toDay || !fromSlotKey || !toSlotKey || !item) {
    return skip('I could not find the item or destination for the move.', prepared);
  }

  const patch = cleanPatch(prepared.patch, toSlotKey);
  const sameDay = fromStop.id === toStop.id && fromDay.date === toDay.date;
  if (sameDay && MULTI_SLOTS.has(fromSlotKey) && MULTI_SLOTS.has(toSlotKey)) {
    dispatch({
      type: 'MOVE_SLOT_ITEM',
      stopId: fromStop.id,
      date: fromDay.date,
      fromSlotKey,
      toSlotKey,
      itemId: item.id,
      patch,
    });
  } else {
    dispatch({ type: 'REMOVE_FROM_SLOT', stopId: fromStop.id, date: fromDay.date, slotKey: fromSlotKey, itemId: item.id });
    dispatch({ type: 'ASSIGN_TO_SLOT', stopId: toStop.id, date: toDay.date, slotKey: toSlotKey, item: { ...item, ...patch, custom: true } });
  }
  return appliedResult(actionSummary(prepared, `Moved ${item.name}`), toStop, toDay.date, toSlotKey, item.name, 'Moved');
}

function applyUpdateTransportLeg(trip, dispatch, action) {
  const fromStop = findStop(trip, action.fromStopId || action.stopId);
  if (!fromStop) return skip('I could not find that transport leg.', action);
  const patch = cleanTransportPatch(payloadSource(action));
  if (!Object.keys(patch).length) return skip('There was nothing new to change on that leg.', action);
  dispatch({ type: 'SET_TRANSPORT', stopId: fromStop.id, transport: patch });
  return { ok: true, summary: actionSummary(action, `Updated travel from ${fromStop.name}`), stopId: fromStop.id };
}

export function applyTripChatActions(trip, dispatch, actions = []) {
  const applied = [];
  const skipped = [];
  let focus = null;
  for (const action of actions || []) {
    if (!action || action.type === 'none') continue;
    const gated = action.needsConfirmation || (Number(action.confidence) || 0) < 0.55;
    if (gated && !isClearAddAction(trip, action)) {
      skipped.push(actionSummary(action, action.reason || 'Needs confirmation'));
      continue;
    }
    let result = null;
    if (action.type === 'set_day_slot') result = applySetDaySlot(trip, dispatch, action);
    else if (action.type === 'update_day_slot_item') result = applyUpdateDaySlotItem(trip, dispatch, action);
    else if (action.type === 'remove_day_slot_item') result = applyRemoveDaySlotItem(trip, dispatch, action);
    else if (action.type === 'move_day_slot_item') result = applyMoveDaySlotItem(trip, dispatch, action);
    else if (action.type === 'update_transport_leg') result = applyUpdateTransportLeg(trip, dispatch, action);
    else if (action.type === 'set_trip_dates') {
      const startDate = normalizeDate(action.item?.depDate);
      const endDate = normalizeDate(action.item?.arrDate);
      if (startDate && endDate) {
        dispatch({ type: 'SET_TRIP_DATES', startDate, endDate });
        result = { ok: true, summary: actionSummary(action, 'Updated trip dates') };
      } else result = skip('I need exact trip start and end dates.', action);
    } else if (action.type === 'set_arrival') {
      const patch = cleanTransportPatch(enrichPayload(action));
      const date = normalizeDate(action.item?.depDate);
      if (date) patch.date = date;
      dispatch({ type: 'SET_ARRIVAL', patch });
      result = { ok: true, summary: actionSummary(action, 'Updated arrival') };
    } else if (action.type === 'set_departure') {
      const patch = cleanTransportPatch(enrichPayload(action));
      const date = normalizeDate(action.item?.depDate);
      if (date) patch.date = date;
      dispatch({ type: 'SET_DEPARTURE', patch });
      result = { ok: true, summary: actionSummary(action, 'Updated departure') };
    } else {
      result = skip('That edit is not supported yet.', action);
    }

    if (result?.ok) {
      applied.push({
        summary: result.summary,
        date: result.date || '',
        slotKey: result.slotKey || '',
        itemName: result.itemName || '',
        verb: result.verb || '',
      });
      // Remember the first edited stop/day so the UI can scroll + expand it.
      if (!focus && result.stopId) {
        focus = {
          stopId: result.stopId,
          date: result.date || '',
          slotKey: result.slotKey || '',
        };
      }
    } else if (result?.summary) skipped.push(result.summary);
  }
  return { applied, skipped, focus };
}

export function composeAgentReply(reply, outcome, clarification) {
  const parts = [];
  const body = text(reply, 2400);
  const clarify = text(clarification, 2400);
  if (body) parts.push(body);
  if (outcome?.applied?.length) parts.push(formatAppliedEdits(outcome.applied));
  else if (clarify) parts.push(clarify);
  else if (outcome?.skipped?.length) parts.push(`Couldn't apply: ${outcome.skipped.slice(0, 3).join('; ')}.`);
  if (!parts.length) parts.push('Done.');
  return parts.join('\n\n');
}

export function buildTripChatEditContext(trip) {
  const dateIndex = [];
  const stops = (trip?.stops || []).map((stop, index) => {
    const nextStop = trip.stops[index + 1] || null;
    const transport = nextStop ? resolveTransport(stop, nextStop) : null;
    (stop.days || []).forEach((day) => {
      dateIndex.push({
        date: day.date,
        label: formatWithWeekday(day.date),
        stopId: stop.id,
        cityId: stop.cityId || '',
        stopName: stop.name,
        slots: SLOT_KEYS,
      });
    });
    return {
      id: stop.id,
      cityId: stop.cityId || '',
      name: stop.name,
      country: stop.country,
      startDate: stop.startDate,
      endDate: stop.endDate,
      transportToNext: nextStop ? {
        fromStopId: stop.id,
        toStopId: nextStop.id,
        label: `${stop.name} -> ${nextStop.name}`,
        plannedDepDate: transport?.depDate || '',
        plannedArrDate: transport?.arrDate || transport?.depDate || '',
        mode: transport?.mode || stop.transportToNext?.mode || '',
        depTime: transport?.depTime || '',
        arrTime: transport?.arrTime || '',
        existing: stop.transportToNext || null,
      } : null,
      days: (stop.days || []).map((day) => ({
        id: day.id || '',
        date: day.date,
        label: formatWithWeekday(day.date),
        slots: Object.fromEntries(SLOT_KEYS.map((key) => [key, daySlotBrief(day, key)])),
      })),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    deviceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    trip: {
      name: trip?.name || '',
      startDate: trip?.startDate || '',
      endDate: trip?.endDate || '',
    },
    slotKeys: SLOT_KEYS,
    dateIndex,
    stops,
  };
}

export function buildTicketMatchContext(trip) {
  const timelineLegs = [];
  const days = [];
  (trip?.stops || []).forEach((stop, index) => {
    const nextStop = trip.stops[index + 1] || null;
    if (nextStop) {
      const transport = resolveTransport(stop, nextStop);
      timelineLegs.push({
        fromStopId: stop.id,
        toStopId: nextStop.id,
        label: `${stop.name} -> ${nextStop.name}`,
        fromCity: stop.name,
        toCity: nextStop.name,
        plannedDepDate: transport?.depDate || '',
        plannedArrDate: transport?.arrDate || transport?.depDate || '',
        mode: transport?.mode || '',
        current: transportTargetsLeg(stop.transportToNext, stop, nextStop) ? (stop.transportToNext || null) : null,
      });
    }
    (stop.days || []).forEach((day) => {
      const travelItems = [];
      ['morning', 'afternoon', 'evening'].forEach((slotKey) => {
        slotItems(day, slotKey).filter((it) => it.type === 'travel').forEach((it) => {
          travelItems.push({
            slotKey,
            itemId: it.id || '',
            name: it.name || '',
            depStation: it.depStation || '',
            arrStation: it.arrStation || '',
            depTime: it.depTime || '',
            arrTime: it.arrTime || '',
          });
        });
      });
      days.push({
        stopId: stop.id,
        stopName: stop.name,
        cityId: stop.cityId || '',
        country: stop.country || '',
        date: day.date,
        label: formatWithWeekday(day.date),
        mealSlots: Object.fromEntries(MEAL_KEYS.map((key) => [key, daySlotBrief(day, key)])),
        travelItems,
      });
    });
  });
  return {
    tripName: trip?.name || '',
    tripYear: (trip?.startDate || '').slice(0, 4),
    timelineLegs,
    days,
  };
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function downscaleImage(dataUrl, maxEdge = 1600) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      if (scale >= 1) { resolve(dataUrl); return; }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export async function ticketFromFile(file) {
  const dataUrl = await readAsDataUrl(file);
  return {
    id: `tk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    type: file.type || '',
    size: file.size,
    dataUrl,
  };
}

export async function matchTicket(ticket, trip) {
  let dataUrl = ticket.dataUrl;
  if ((ticket.type || '').startsWith('image/')) dataUrl = await downscaleImage(dataUrl);
  if (!dataUrl || dataUrl.length > 4 * 1024 * 1024) return { status: 'toobig' };
  const r = await fetch('/api/match-ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      dataUrl,
      filename: ticket.name || 'ticket',
      itinerary: buildTicketMatchContext(trip),
    }),
  });
  if (r.status === 503) return { status: 'unconfigured' };
  if (!r.ok) return { status: 'error' };
  return { status: 'ok', ...(await r.json()) };
}

function ticketFieldsPatch(fields = {}) {
  const patch = cleanTransportPatch(fields);
  if (fields.bookingRef && !patch.note) patch.note = fields.note || `Booking ref: ${fields.bookingRef}`;
  patch.booked = true;
  return patch;
}

function ticketTravelItem(fields = {}, ticket) {
  const dep = text(fields.depStation, 120);
  const arr = text(fields.arrStation, 120);
  const mode = TRANSPORT_MODES.includes(fields.mode) ? fields.mode : 'travel';
  const name = dep && arr
    ? `${mode === 'travel' ? 'Travel' : mode.replace(/\b\w/g, (ch) => ch.toUpperCase())}: ${dep} to ${arr}`
    : text(fields.title, 160) || 'Travel';
  const durationMin = minutesBetweenClock(fields.depTime, fields.arrTime);
  return cleanItem({
    ...fields,
    name,
    type: 'travel',
    emoji: mode === 'travel' ? transportIcon('train') : transportIcon(mode),
    mode: mode === 'travel' ? '' : mode,
    durationMin: durationMin ?? fields.durationMin,
    tickets: [ticket],
  }, daySlotForClock(fields.depTime || fields.arrTime) || 'morning');
}

// Build the booked-restaurant chip for a parsed dining reservation: a custom,
// name-pinned eat item with the reservation time / party size / booking ref
// folded into its notes (so the day map can geocode it and the notes carry the
// useful bits the chip itself doesn't render).
function ticketDiningItem(fields = {}, slotKey) {
  const venue = text(fields.venue, 180) || text(fields.title, 180) || 'Reservation';
  const resTime = formatStoredClock(fields.resTime || fields.depTime);
  const bits = [];
  if (resTime) bits.push(`Reservation ${format12(resTime)}`);
  if (Number.isFinite(fields.partySize) && fields.partySize > 0) bits.push(`party of ${Math.round(fields.partySize)}`);
  if (text(fields.bookingRef, 80)) bits.push(`Booking ref: ${text(fields.bookingRef, 80)}`);
  const notes = [bits.join(' · '), text(fields.note, 400)].filter(Boolean).join('\n');
  return cleanItem({
    name: venue,
    type: 'eat',
    pinByName: true,
    address: text(fields.venueAddress, 240),
    depTime: resTime,
    arrTime: defaultArrTime(resTime),
    notes,
  }, MEAL_KEYS.includes(slotKey) ? slotKey : 'dinner');
}

function fallbackDiningFields(fields = {}, match = {}) {
  const out = { ...(fields || {}) };
  const reason = String(match?.reason || '');
  const hay = [reason, out.note, out.title].filter(Boolean).join(' ');
  if (!out.kind && /\b(dining|restaurant|reservation|booking)\b/i.test(hay)) out.kind = 'dining';
  if (!out.resDate) out.resDate = hay.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || '';
  if (!out.resTime) out.resTime = parseTimeFromUserText(hay);
  if (!out.partySize) {
    const guests = hay.match(/\b(\d{1,2})\s+(?:guests?|people|persons?|pax)\b/i);
    if (guests) out.partySize = Number(guests[1]);
  }
  if (!text(out.venue)) {
    const venue = hay.match(/\b(?:dining\s+)?(?:reservation|booking)\s+(?:for|at)\s+(.+?)\s+(?:in|on|at)\b/i);
    if (venue) out.venue = text(venue[1].replace(/^restaurant\s+/i, ''), 180);
  }
  return out;
}

function looksLikeDiningMatch(target = {}, fields = {}, match = {}) {
  if (target.kind === 'meal_slot' || fields.kind === 'dining') return true;
  if (text(fields.venue) && (fields.resDate || fields.resTime)) return true;
  const reason = String(match?.reason || '');
  return /\b(restaurant|reservation|booking)\b/i.test(reason)
    && (/\b\d{4}-\d{2}-\d{2}\b/.test(reason) || parseTimeFromUserText(reason));
}

export function applyTicketMatch(trip, dispatch, ticket, match, ticketMemory = null) {
  const target = match?.target || {};
  const fields = fallbackDiningFields(match?.fields || {}, match);

  if (looksLikeDiningMatch(target, fields, match)) {
    const { stop, day } = resolveDiningPlacement(trip, target, fields, match);
    if (!stop || !day) return { ok: false, summary: 'Could not find a trip day for that reservation.' };
    const resTime = formatStoredClock(fields.resTime || fields.depTime || fields.arrTime);
    const slotKey = MEAL_KEYS.includes(target.slotKey) ? target.slotKey : (mealSlotForClock(resTime) || 'dinner');
    const item = ticketDiningItem(fields, slotKey);
    dispatch({ type: 'ASSIGN_TO_SLOT', stopId: stop.id, date: day.date, slotKey, item });
    const when = resTime ? ` (${format12(resTime)})` : '';
    return { ok: true, summary: `${item.name}${when} -> ${slotKey} on ${formatWithWeekday(day.date)}` };
  }

  if (!match?.matched || match.confidence < 0.45) {
    return { ok: false, summary: match?.reason || 'Could not match the ticket to the trip.' };
  }

  if (target.kind === 'timeline_leg') {
    const stop = findStop(trip, target.fromStopId);
    const nextStop = stop ? trip.stops[(trip.stops || []).findIndex((s) => s.id === stop.id) + 1] : null;
    if (!stop || !nextStop) return { ok: false, summary: 'Could not find the matching travel leg.' };
    const key = `leg:${stop.id}`;
    const currentTickets = ticketMemory?.get(key) || (Array.isArray(stop.transportToNext?.tickets) ? stop.transportToNext.tickets : []);
    const nextTickets = [...currentTickets, ticket];
    ticketMemory?.set(key, nextTickets);
    dispatch({
      type: 'SET_TRANSPORT',
      stopId: stop.id,
      transport: { ...ticketFieldsPatch(fields), tickets: nextTickets },
    });
    return { ok: true, summary: `${ticket.name || 'Ticket'} -> ${stop.name} to ${nextStop.name}` };
  }

  if (target.kind === 'day_slot' || target.kind === 'new_day_travel') {
    const stop = findStop(trip, target.stopId);
    const day = findDay(stop, target.date || fields.depDate || fields.arrDate);
    if (!stop || !day) return { ok: false, summary: 'Could not find the matching day.' };
    const slotKey = SLOT_KEYS.includes(target.slotKey)
      ? target.slotKey
      : daySlotForClock(fields.depTime || fields.arrTime) || 'morning';
    if (target.itemId) {
      const item = findItem(day, slotKey, target.itemId, '');
      if (item) {
        const key = `item:${stop.id}:${day.date}:${slotKey}:${item.id}`;
        const currentTickets = ticketMemory?.get(key) || (Array.isArray(item.tickets) ? item.tickets : []);
        const nextTickets = [...currentTickets, ticket];
        ticketMemory?.set(key, nextTickets);
        const durationMin = minutesBetweenClock(fields.depTime, fields.arrTime);
        dispatch({
          type: 'UPDATE_SLOT_ITEM',
          stopId: stop.id,
          date: day.date,
          slotKey,
          itemId: item.id,
          patch: {
            ...cleanPatch({
              ...fields,
              type: 'travel',
              durationMin: durationMin ?? fields.durationMin,
            }, slotKey),
            tickets: nextTickets,
          },
        });
        return { ok: true, summary: `${ticket.name || 'Ticket'} -> ${formatWithWeekday(day.date)}` };
      }
    }
    dispatch({
      type: 'ASSIGN_TO_SLOT',
      stopId: stop.id,
      date: day.date,
      slotKey,
      item: ticketTravelItem(fields, ticket),
    });
    return { ok: true, summary: `${ticket.name || 'Ticket'} -> ${formatWithWeekday(day.date)}` };
  }

  return { ok: false, summary: match?.reason || 'Could not place the ticket.' };
}

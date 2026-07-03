import {
  consolidateItemMoves,
  describePlanChange,
} from './planChangeLanguage.js';

function stopName(stop) {
  return (stop && stop.name) || 'a stop';
}

function findStop(trip, stopId) {
  return ((trip && trip.stops) || []).find((s) => s.id === stopId) || null;
}

function findAddedStop(before, after) {
  const beforeIds = new Set(((before && before.stops) || []).map((s) => s.id));
  return ((after && after.stops) || []).find((s) => !beforeIds.has(s.id)) || null;
}

function itemName(item) {
  return (item && item.name) || 'something';
}

function slotItem(stop, date, slotKey, itemId) {
  const day = stop && (stop.days || []).find((d) => d.date === date);
  const v = day && day.slots && day.slots[slotKey];
  if (Array.isArray(v)) return v.find((it) => it.id === itemId) || null;
  return v && (!itemId || v.id === itemId) ? v : null;
}

function bucketLabel(bucket) {
  if (bucket === 'eat') return 'food ideas';
  if (bucket === 'do') return 'to-do ideas';
  if (bucket === 'see') return 'sight ideas';
  return 'ideas';
}

function stopPair(before, stopId) {
  const stops = (before && before.stops) || [];
  const idx = stops.findIndex((s) => s.id === stopId);
  if (idx < 0) return '';
  const from = stops[idx];
  const to = stops[idx + 1];
  return to ? `${stopName(from)} to ${stopName(to)}` : stopName(from);
}

function textSummary(text) {
  return { kind: 'text', text };
}

export function summarizeTripEdit(before, after, action) {
  if (!before || !after || !action) return '';
  switch (action.type) {
    case 'ADD_STOP': {
      const added = findAddedStop(before, after);
      return textSummary(`added ${stopName(added)} to the route`);
    }
    case 'REMOVE_STOP':
      return textSummary(`removed ${stopName(findStop(before, action.stopId))} from the route`);
    case 'CHANGE_STOP_CITY': {
      const oldStop = findStop(before, action.stopId);
      const newStop = findStop(after, action.stopId);
      return textSummary(`changed ${stopName(oldStop)} to ${stopName(newStop)}`);
    }
    case 'MOVE_STOP':
    case 'REORDER_STOPS':
      return textSummary(`moved ${stopName(findStop(before, action.stopId))} on the route`);
    case 'SET_STOP_DATES':
      return textSummary(`changed dates for ${stopName(findStop(before, action.stopId))}`);
    case 'SET_TRIP_DATES':
      return textSummary('changed the trip dates');
    case 'LOAD_DEFAULT_ROUTE':
      return textSummary('loaded the default route');
    case 'RESET_ALL':
      return textSummary('cleared the trip');
    case 'SET_ARRIVAL':
      return textSummary('updated arrival details');
    case 'SET_DEPARTURE':
      return textSummary('updated departure details');
    case 'SET_TRANSPORT':
      return textSummary(`updated transport from ${stopPair(before, action.stopId)}`);
    case 'ASSIGN_TO_SLOT': {
      const stop = findStop(before, action.stopId);
      return {
        kind: 'add',
        name: itemName(action.item),
        stopId: action.stopId,
        stopName: stopName(stop),
        date: action.date,
        slot: action.slotKey,
      };
    }
    case 'REMOVE_FROM_SLOT': {
      const stop = findStop(before, action.stopId);
      const item = slotItem(stop, action.date, action.slotKey, action.itemId);
      return {
        kind: 'remove',
        name: itemName(item),
        stopId: action.stopId,
        stopName: stopName(stop),
        date: action.date,
        slot: action.slotKey,
      };
    }
    case 'UPDATE_SLOT_ITEM': {
      const stop = findStop(before, action.stopId);
      const item = slotItem(stop, action.date, action.slotKey, action.itemId);
      return {
        kind: 'update',
        name: itemName(item),
        stopId: action.stopId,
        stopName: stopName(stop),
        date: action.date,
      };
    }
    case 'MOVE_SLOT_ITEM': {
      const stop = findStop(before, action.stopId);
      const item = slotItem(stop, action.date, action.fromSlotKey, action.itemId);
      if (action.fromSlotKey === action.toSlotKey) {
        return {
          kind: 'update',
          name: itemName(item),
          stopId: action.stopId,
          stopName: stopName(stop),
          date: action.date,
        };
      }
      return {
        kind: 'move',
        name: itemName(item),
        stopName: stopName(stop),
        fromDate: action.date,
        toDate: action.date,
        toSlot: action.toSlotKey,
      };
    }
    case 'REORDER_SLOT':
    case 'OPTIMIZE_DAY_ROUTE': {
      const stop = findStop(before, action.stopId);
      const day = stop && (stop.days || []).find((d) => d.date === action.date);
      return textSummary(day
        ? `reworked the plan for ${stopName(stop)}`
        : `reworked a day in ${stopName(stop)}`);
    }
    case 'ADD_ITEM':
      return textSummary(`added ${itemName(action.item)} to ${stopName(findStop(before, action.stopId))} ${bucketLabel(action.bucket)}`);
    case 'DELETE_ITEM': {
      const stop = findStop(before, action.stopId);
      const item = (stop?.recs?.[action.bucket] || []).find((it) => it.id === action.itemId);
      return textSummary(`removed ${itemName(item)} from ${stopName(stop)} ${bucketLabel(action.bucket)}`);
    }
    case 'UPDATE_ITEM': {
      const stop = findStop(before, action.stopId);
      const item = (stop?.recs?.[action.bucket] || []).find((it) => it.id === action.itemId);
      return textSummary(`edited ${itemName(item)} in ${stopName(stop)}`);
    }
    default:
      return '';
  }
}

function joinList(parts) {
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function finishSentence(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  // Capitalize the first letter — the phrase stands alone as the push body
  // ("Updated transport…"), separate from the "<name> updated the plan" title.
  const sentence = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function normalizeSummary(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return textSummary(entry);
  return entry;
}

function describeSummary(entry) {
  const ev = normalizeSummary(entry);
  if (!ev) return '';
  return describePlanChange(ev);
}

function consolidateSummaries(items) {
  const events = items.map(normalizeSummary).filter(Boolean);
  const slotEvents = events.filter((e) => e.kind === 'add' || e.kind === 'remove');
  const other = events.filter((e) => e.kind !== 'add' && e.kind !== 'remove');
  const consolidated = consolidateItemMoves(slotEvents, {
    matchKey: (rem, add) => rem.stopId === add.stopId && rem.name === add.name,
  });
  return [...consolidated, ...other];
}

// Body text for a plan-change push — editor name lives in the notification title.
export function composePlanEditNotification(summaries) {
  const items = Array.isArray(summaries) ? summaries.filter(Boolean) : [];
  if (!items.length) return '';

  const merged = consolidateSummaries(items);
  const lines = merged.map(describeSummary).filter(Boolean);

  const seen = new Set();
  const unique = [];
  lines.forEach((line) => {
    if (seen.has(line)) return;
    seen.add(line);
    unique.push(line);
  });

  if (!unique.length) return finishSentence(describeSummary(items[0]));
  if (unique.length === 1) return finishSentence(unique[0]);
  return finishSentence(joinList(unique));
}

export function editSummaryKey(summary) {
  if (!summary) return '';
  if (typeof summary === 'string') return summary;
  if (summary.kind === 'text') return summary.text;
  return JSON.stringify(summary);
}

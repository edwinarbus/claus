import {
  consolidateItemMoves,
  bundleSlotChanges,
  describePlanChange,
} from './planChangeLanguage.js';

const SLOT_KEYS = ['morning', 'afternoon', 'evening', 'breakfast', 'lunch', 'dinner', 'lodging'];
const PLACEHOLDER_MEAL_RE = /^destination dining\b/i;

function slotItems(day, key) {
  const v = day?.slots?.[key];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function itemSig(it) {
  if (!it) return '';
  return [it.name, it.type, it.venue, it.depTime, it.arrTime, it.notes, it.bookingRef].join('\0');
}

function isPlaceholderMeal(it) {
  return it?.type === 'eat' && PLACEHOLDER_MEAL_RE.test(String(it.name || '').trim());
}

function collectDayEvents(beforeStop, afterStop, stopId, stopName, events) {
  const beforeDays = new Map((beforeStop.days || []).map((d) => [d.date, d]));
  const afterDays = new Map((afterStop.days || []).map((d) => [d.date, d]));
  const dates = new Set([...beforeDays.keys(), ...afterDays.keys()]);

  dates.forEach((date) => {
    const bd = beforeDays.get(date);
    const ad = afterDays.get(date);
    const t = Date.parse(date) || 0;

    SLOT_KEYS.forEach((key) => {
      const beforeItems = slotItems(bd, key);
      const afterItems = slotItems(ad, key);
      const beforeById = new Map(beforeItems.filter((i) => i.id).map((i) => [i.id, i]));

      afterItems.forEach((it) => {
        if (!it.id) return;
        if (!beforeById.has(it.id)) {
          events.push({
            kind: 'add',
            id: it.id,
            name: it.name || 'an item',
            date,
            slot: key,
            stopId,
            stopName,
            sig: itemSig(it),
            t,
          });
        } else if (itemSig(beforeById.get(it.id)) !== itemSig(it)) {
          events.push({
            kind: 'update',
            name: it.name || 'an item',
            date,
            slot: key,
            stopId,
            stopName,
            t,
          });
        }
      });

      const afterIds = new Set(afterItems.map((i) => i.id).filter(Boolean));
      beforeItems.forEach((it) => {
        if (!it.id || afterIds.has(it.id)) return;
        if (isPlaceholderMeal(it)) return;
        events.push({
          kind: 'remove',
          id: it.id,
          name: it.name || 'an item',
          date,
          slot: key,
          stopId,
          stopName,
          sig: itemSig(it),
          t,
        });
      });
    });
  });
}

function consolidateMoves(events) {
  return consolidateItemMoves(events, {
    matchKey: (rem, add) => (
      rem.stopId === add.stopId
      && rem.sig === add.sig
      && rem.id === add.id
    ),
  });
}

function transportSig(leg) {
  if (!leg) return '';
  return [leg.mode, leg.booked, leg.depTime, leg.arrTime, leg.depStation, leg.arrStation, leg.bookingRef].join('\0');
}

export function diffPlanChanges(before, after) {
  const events = [];
  if (!before || !after) return [];

  if (before.startDate !== after.startDate || before.endDate !== after.endDate) {
    events.push({ kind: 'meta', text: 'changed the trip dates', t: 0 });
  }

  const beforeStops = before.stops || [];
  const afterStops = after.stops || [];
  const beforeIds = new Set(beforeStops.map((s) => s.id));
  const afterIds = new Set(afterStops.map((s) => s.id));

  afterStops.forEach((s) => {
    if (!beforeIds.has(s.id)) {
      events.push({ kind: 'meta', text: `added ${s.name} to the route`, t: 0 });
    }
  });
  beforeStops.forEach((s) => {
    if (!afterIds.has(s.id)) {
      events.push({ kind: 'meta', text: `removed ${s.name} from the route`, t: 0 });
    }
  });

  const orderBefore = beforeStops.map((s) => s.id).join('\0');
  const orderAfter = afterStops.map((s) => s.id).join('\0');
  if (orderBefore !== orderAfter && beforeIds.size === afterIds.size && beforeIds.size > 0) {
    events.push({ kind: 'meta', text: 'reordered the stops', t: 0 });
  }

  beforeStops.forEach((bs) => {
    const as = afterStops.find((s) => s.id === bs.id);
    if (!as) return;
    if (bs.name !== as.name) {
      events.push({ kind: 'meta', text: `renamed ${bs.name} to ${as.name}`, t: 0 });
    }
    if (bs.startDate !== as.startDate || bs.endDate !== as.endDate) {
      events.push({ kind: 'meta', text: `changed dates for ${as.name}`, t: Date.parse(as.startDate || '') || 0 });
    }
    if (transportSig(bs.transportToNext) !== transportSig(as.transportToNext)) {
      events.push({ kind: 'meta', text: `updated transport after ${as.name}`, t: 0 });
    }
    collectDayEvents(bs, as, as.id, as.name, events);
  });

  const consolidated = bundleSlotChanges(consolidateMoves(events));
  consolidated.sort((a, b) => (a.t || 0) - (b.t || 0));

  const seen = new Set();
  const lines = [];
  for (const ev of consolidated) {
    const text = describePlanChange(ev);
    if (seen.has(text)) continue;
    seen.add(text);
    lines.push(text);
  }
  return lines;
}

import { formatLong } from './dates.js';

export const SLOT_PHRASE = {
  morning: 'the morning',
  afternoon: 'the afternoon',
  evening: 'the evening',
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  lodging: 'lodging',
};

export function slotPhrase(slot) {
  return SLOT_PHRASE[slot] || slot;
}

export function joinList(parts) {
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export function describeItemMove({ name, stopName, fromDate, toDate, toSlot }) {
  if (fromDate && toDate && fromDate !== toDate) {
    return `moved ${name} in ${stopName} from ${formatLong(fromDate)} to ${formatLong(toDate)}`;
  }
  if (toDate && toSlot) {
    return `moved ${name} to ${slotPhrase(toSlot)} on ${formatLong(toDate)}`;
  }
  return `moved ${name} in ${stopName}`;
}

export function describeItemAdd({ name, names, stopName, date }) {
  const list = names?.length ? names : [name];
  return `added ${joinList(list)} to ${stopName} on ${formatLong(date)}`;
}

export function describeItemRemove({ name, names, stopName, date }) {
  const list = names?.length ? names : [name];
  return `removed ${joinList(list)} from ${stopName} on ${formatLong(date)}`;
}

export function describeItemUpdate({ name, names, stopName, date }) {
  const list = names?.length ? names : [name];
  return `updated ${joinList(list)} in ${stopName} on ${formatLong(date)}`;
}

export function describeDayBundle({ stopName, date, adds = [], removes = [], updates = [] }) {
  const parts = [];
  if (adds.length) parts.push(`added ${joinList(adds)}`);
  if (removes.length) parts.push(`removed ${joinList(removes)}`);
  if (updates.length) parts.push(`updated ${joinList(updates)}`);
  return `updated ${stopName} on ${formatLong(date)}: ${parts.join('; ')}`;
}

// Pair remove/add events that share an item id (recap diff) or name+stop (live edits).
export function consolidateItemMoves(events, { matchKey }) {
  const used = new Set();
  const moves = [];

  const removeIdx = events.map((e, i) => (e.kind === 'remove' ? i : -1)).filter((i) => i >= 0);
  const addIdx = events.map((e, i) => (e.kind === 'add' ? i : -1)).filter((i) => i >= 0);

  removeIdx.forEach((ri) => {
    if (used.has(ri)) return;
    const rem = events[ri];
    const ai = addIdx.find((idx) => {
      if (used.has(idx)) return false;
      const add = events[idx];
      if (!matchKey(rem, add)) return false;
      return add.date !== rem.date || (add.slot || add.toSlot) !== (rem.slot || rem.fromSlot);
    });
    if (ai == null) return;

    const add = events[ai];
    used.add(ri);
    used.add(ai);
    moves.push({
      kind: 'move',
      name: rem.name,
      stopName: rem.stopName,
      fromDate: rem.date,
      toDate: add.date,
      fromSlot: rem.slot || rem.fromSlot,
      toSlot: add.slot || add.toSlot,
    });
  });

  const rest = events.filter((_, i) => !used.has(i));
  return [...moves, ...rest];
}

export function describePlanChange(ev) {
  switch (ev.kind) {
    case 'move':
      return describeItemMove({
        name: ev.name,
        stopName: ev.stopName,
        fromDate: ev.fromDate,
        toDate: ev.toDate,
        toSlot: ev.toSlot,
      });
    case 'add':
      return describeItemAdd(ev);
    case 'remove':
      return describeItemRemove(ev);
    case 'update':
      return describeItemUpdate(ev);
    case 'day':
      return describeDayBundle(ev);
    default:
      return ev.text || 'updated the trip';
  }
}

// Group slot adds/removes/updates that share a stop and day into one line.
export function bundleSlotChanges(events) {
  const bundles = new Map();
  const other = [];

  events.forEach((ev) => {
    if (ev.kind !== 'add' && ev.kind !== 'remove' && ev.kind !== 'update') {
      other.push(ev);
      return;
    }
    const key = `${ev.stopName}\0${ev.date}`;
    if (!bundles.has(key)) {
      bundles.set(key, {
        stopName: ev.stopName,
        date: ev.date,
        add: [],
        remove: [],
        update: [],
        t: ev.t || 0,
      });
    }
    const row = bundles.get(key);
    if (!row[ev.kind].includes(ev.name)) row[ev.kind].push(ev.name);
    row.t = Math.max(row.t, ev.t || 0);
  });

  const bundled = [...bundles.values()].map((row) => {
    const kinds = ['add', 'remove', 'update'].filter((kind) => row[kind].length);
    if (kinds.length === 1) {
      const kind = kinds[0];
      if (row[kind].length === 1) {
        return {
          kind,
          name: row[kind][0],
          stopName: row.stopName,
          date: row.date,
          t: row.t,
        };
      }
      return {
        kind,
        names: row[kind],
        stopName: row.stopName,
        date: row.date,
        t: row.t,
      };
    }
    return {
      kind: 'day',
      stopName: row.stopName,
      date: row.date,
      adds: row.add,
      removes: row.remove,
      updates: row.update,
      t: row.t,
    };
  });

  return [...other, ...bundled];
}

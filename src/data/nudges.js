// Gentle, dismissible nudges toward local specialties + cooler scheduling.
// Eat nudges are CONTEXT-AWARE: they rotate across the days of a stop so you
// don't get told to eat the same dish every day, and they skip anything you've
// already planned that day.

function dayHasItem(day, predicate) {
  const s = day.slots;
  const multi = ['morning', 'afternoon', 'evening'].some((k) => (s[k] || []).some(predicate));
  const single = ['breakfast', 'lunch', 'dinner', 'lodging'].some((k) => s[k] && predicate(s[k]));
  return multi || single;
}

function firstEmptyMeal(day) {
  return ['dinner', 'lunch', 'breakfast'].find((k) => !day.slots[k]) || null;
}

function eatsByTier(stop) {
  return [...(stop.recs.eat || [])].sort((a, b) => (a.tier || 3) - (b.tier || 3));
}

const OPENERS = [
  (s) => `Day in ${s.name}`,
  (s) => `Still in ${s.name}`,
  (s) => `Make it count in ${s.name}`,
  (s) => `${s.name} flavors`,
];

// Returns an array of nudge descriptors for one day (already filtered by dismissals).
export function dayNudges(stop, day, dismissed) {
  const out = [];
  const eats = eatsByTier(stop);
  if (!eats.length) return out;

  const emptyMeal = firstEmptyMeal(day);
  if (!emptyMeal) return out;

  // Rotate the starting point by the day's index so each day leans toward a
  // different specialty; skip anything already on the plate that day.
  const n = eats.length;
  const idx = day.index || 0;
  let candidate = null;
  for (let k = 0; k < n; k++) {
    const c = eats[(idx + k) % n];
    const present = dayHasItem(day, (it) => (it.sourceId && it.sourceId === c.sourceId) || it.name === c.name);
    if (!present) { candidate = c; break; }
  }
  if (!candidate) return out;

  const id = `${stop.id}:${day.date}:eat:${candidate.sourceId || candidate.name}`;
  if (dismissed[id]) return out;

  const opener = OPENERS[idx % OPENERS.length](stop);
  const place = candidate.places && candidate.places[0];
  const tail = place ? ` — ${place.name} is a great pick.` : '.';
  out.push({
    id,
    kind: 'eat',
    text: `${opener}: make room for ${candidate.name}${tail}`,
    item: candidate,
    slotKey: emptyMeal,
  });
  return out;
}

// Heat nudges depend on filter prefs, computed separately so we can pass prefs.
export function heatNudges(stop, day, dismissed, avoidHeatPM) {
  if (!avoidHeatPM) return [];
  const out = [];
  for (const slotKey of ['afternoon', 'evening']) {
    for (const it of day.slots[slotKey] || []) {
      if (it.heatSensitive) {
        const id = `${stop.id}:${day.date}:heat:${it.id}`;
        if (!dismissed[id]) {
          out.push({ id, kind: 'heat', text: `Warm part of the day — ${it.name} is nicer in the cool morning.`, item: it, fromSlot: slotKey });
        }
        break; // one heat nudge per day keeps it gentle
      }
    }
    if (out.length) break;
  }
  return out;
}

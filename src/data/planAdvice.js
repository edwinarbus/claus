// Advisory feedback when you reorder stops or shuffle day-plan items.
import { haversineKm } from './logistics.js';
import { dayFullness, hasFullDayTravel } from './pacing.js';
import { SLOT_BY_KEY } from './slots.js';

function pathKm(stops) {
  let t = 0;
  for (let i = 0; i < stops.length - 1; i++) t += haversineKm(stops[i], stops[i + 1]);
  return t;
}

export function stopMoveAdvice(trip, fromIdx, toIdx) {
  const stops = trip.stops;
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return null;
  const reordered = [...stops];
  const [moved] = reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, moved);
  const before = pathKm(stops);
  const after = pathKm(reordered);
  const delta = Math.round(after - before);
  if (delta <= -80) {
    return { level: 'good', text: `Nice — that order trims ~${Math.abs(delta)} km of backtracking.` };
  }
  if (delta >= 150) {
    return { level: 'warn', text: `That shuffle adds ~${delta} km — might be worth it for flights/events, but check the map.` };
  }
  return null;
}

export function slotAssignmentAdvice(stop, day, slotKey, item) {
  if (!item || !slotKey) return null;
  const def = SLOT_BY_KEY[slotKey];
  if (!def) return null;

  if (slotKey === 'lodging' && item.type !== 'lodging') {
    return { level: 'bad', text: 'Lodging is for neighborhoods & hotels only — pick from the stay guide below.' };
  }

  const mealSlots = ['breakfast', 'lunch', 'dinner'];
  const daySlots = ['morning', 'afternoon', 'evening'];

  if (item.type === 'eat' && daySlots.includes(slotKey)) {
    return { level: 'warn', text: `${item.name} fits better in Breakfast / Lunch / Dinner — keeps meals separate from sightseeing.` };
  }

  if (item.heatSensitive && (slotKey === 'afternoon' || slotKey === 'evening')) {
    const why = item.heatReason || 'less sun and fewer crowds';
    return { level: 'warn', text: `${item.name} is rough in the warm afternoon — morning is better (${why}).` };
  }

  if (item.heatSensitive && slotKey === 'morning') {
    return { level: 'good', text: `Smart — ${item.name} is much nicer in the cool morning.` };
  }

  if (daySlots.includes(slotKey)) {
    const fullness = dayFullness(day);
    if (fullness.level === 'overstuffed' && !hasFullDayTravel(day)) {
      return { level: 'warn', text: `This day is already overstuffed (~${Math.round(fullness.hours)}h) — consider a lighter day instead.` };
    }
  }

  if (mealSlots.includes(slotKey) && item.type !== 'eat') {
    return { level: 'warn', text: `${item.name} isn't a meal — use Morning / Afternoon / Evening for activities.` };
  }

  return null;
}

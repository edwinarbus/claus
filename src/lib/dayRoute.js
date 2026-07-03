// Analyze and optimize a single day's geographic route from resolved coordinates.
import { haversineKm } from '../data/logistics.js';

export const ACTIVITY_SLOTS = ['morning', 'afternoon', 'evening'];

export function collectActivityItems(day) {
  const out = [];
  ACTIVITY_SLOTS.forEach((slotKey) => {
    (day.slots?.[slotKey] || []).forEach((it) => {
      if (it && it.type !== 'travel') out.push({ item: it, slotKey });
    });
  });
  return out;
}

function preciseCoords(coords, item) {
  const c = coords[item.id];
  return c && !c.approx && typeof c.lat === 'number' && typeof c.lng === 'number' ? c : null;
}

export function routeDistanceKm(items, coords) {
  let total = 0;
  for (let i = 0; i < items.length - 1; i++) {
    const a = preciseCoords(coords, items[i]);
    const b = preciseCoords(coords, items[i + 1]);
    if (a && b) total += haversineKm(a, b);
  }
  return total;
}

// Nearest-neighbor TSP over items that have precise coordinates.
// `rows` are { item, slotKey } from collectActivityItems.
export function optimizeVisitOrder(rows, coords) {
  const precise = rows.filter((r) => preciseCoords(coords, r.item));
  if (precise.length < 2) return rows.map((r) => r.item);

  const remaining = [...precise];
  const ordered = [remaining.shift()];
  let cur = preciseCoords(coords, ordered[0].item);

  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(cur, preciseCoords(coords, remaining[i].item));
      if (d < bestD) { bestD = d; best = i; }
    }
    ordered.push(remaining.splice(best, 1)[0]);
    cur = preciseCoords(coords, ordered[ordered.length - 1].item);
  }

  const imprecise = rows.filter((r) => !preciseCoords(coords, r.item));
  return [...ordered.map((r) => r.item), ...imprecise.map((r) => r.item)];
}

const CLUSTER_KM = 0.75;

function clusterItems(items, coords) {
  const clusters = [];
  items.forEach((it) => {
    const c = preciseCoords(coords, it);
    if (!c) return;
    let cl = clusters.find((g) => haversineKm(g.center, c) <= CLUSTER_KM);
    if (!cl) {
      cl = { center: c, items: [] };
      clusters.push(cl);
    }
    cl.items.push(it);
  });
  return clusters;
}

function detectNeighborhoodBacktracks(items, coords) {
  const precise = items.filter((it) => preciseCoords(coords, it.item));
  if (precise.length < 3) return [];

  const clusters = clusterItems(precise.map((x) => x.item), coords);
  const itemCluster = new Map();
  clusters.forEach((cl, idx) => cl.items.forEach((it) => itemCluster.set(it.id, idx)));

  const backtracks = [];
  clusters.forEach((cl, cIdx) => {
    const visits = precise
      .map((row, i) => (itemCluster.get(row.item.id) === cIdx ? i : -1))
      .filter((i) => i >= 0);
    if (visits.length < 2) return;
    for (let v = 1; v < visits.length; v++) {
      const gap = visits[v] - visits[v - 1];
      if (gap <= 1) continue;
      const between = precise.slice(visits[v - 1] + 1, visits[v]).map((x) => x.item.name);
      const area = cl.items[0].name;
      backtracks.push({ area, between, extraStops: between.length });
    }
  });
  return backtracks;
}

export function buildOptimizedSlots(day, optimizedItems) {
  const counts = ACTIVITY_SLOTS.reduce((acc, k) => {
    acc[k] = (day.slots[k] || []).filter((it) => it.type !== 'travel').length;
    return acc;
  }, {});
  const travel = ACTIVITY_SLOTS.reduce((acc, k) => {
    acc[k] = (day.slots[k] || []).filter((it) => it.type === 'travel');
    return acc;
  }, {});

  const buckets = { morning: [], afternoon: [], evening: [] };
  let i = 0;
  optimizedItems.forEach((it) => {
    if (i < counts.morning) buckets.morning.push(it);
    else if (i < counts.morning + counts.afternoon) buckets.afternoon.push(it);
    else buckets.evening.push(it);
    i++;
  });

  return ACTIVITY_SLOTS.reduce((acc, k) => {
    acc[k] = [...buckets[k], ...travel[k]];
    return acc;
  }, {});
}

export function analyzeDayRoute(day, coords) {
  const rows = collectActivityItems(day);
  const precise = rows.filter((r) => preciseCoords(coords, r.item));
  if (precise.length < 3) return null;

  const current = precise.map((r) => r.item);
  const optimal = optimizeVisitOrder(rows, coords);
  const currentKm = routeDistanceKm(current, coords);
  const optimalKm = routeDistanceKm(optimal, coords);
  const wastedKm = Math.max(0, currentKm - optimalKm);
  const wastedMin = Math.max(0, Math.round((wastedKm / 4.8) * 60));
  const backtracks = detectNeighborhoodBacktracks(rows, coords);

  const complicated = wastedKm >= 0.8 || wastedMin >= 12 || backtracks.length > 0;
  if (!complicated) return null;

  return {
    currentKm,
    optimalKm,
    wastedKm,
    wastedMin,
    optimalOrder: optimal.map((it) => it.name),
    optimizedSlots: buildOptimizedSlots(day, optimal),
    backtracks,
  };
}

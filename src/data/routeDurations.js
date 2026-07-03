// Route-aware guide durations used when a leg has no explicit timed booking.
// These keep the compact timeline/map/day chips aligned with the travel-option
// cards instead of falling back to straight-line distance estimates.

export function normalizeDurationMode(mode = '') {
  const m = mode.toLowerCase();
  if (m.includes('overnight')) return 'overnight boat';
  if (m.includes('express boat')) return 'express boat';
  if (m.includes('ferry') || m.includes('boat') || m.includes('cruise') || m.includes('sail')) return 'ferry';
  if (m.includes('flight') || m.includes('fly') || m.includes('air') || m.includes('plane')) return 'flight';
  if (m.includes('train') || m.includes('rail')) return 'train';
  if (m.includes('bus') || m.includes('coach')) return 'bus';
  if (m.includes('car') || m.includes('drive')) return 'car';
  return m;
}

function pairKey(a, b) {
  return [a, b].filter(Boolean).sort().join('|');
}

function directionalKey(a, b) {
  return a && b ? `${a}>${b}` : '';
}

const DIRECTIONAL_DURATIONS = {
  // Bergen → Flåm is the full Norway-in-a-Nutshell day (rail + bus + Nærøyfjord
  // cruise); the reverse, and the direct rail up, are quicker.
  'bergen>flam': { train: 360, 'express boat': 325, ferry: 325 },
  'flam>bergen': { train: 180, 'express boat': 325, ferry: 325 },
};

const PAIR_DURATIONS = {
  'aarhus|aero': { train: 300, car: 240 },
  'aarhus|copenhagen': { train: 180, bus: 270, car: 210, flight: 200 },
  'aero|copenhagen': { train: 250, car: 210 },
  'aero|kalmar': { train: 480, car: 420 },
  'bergen|flam': { train: 180, 'express boat': 325, bus: 240, car: 180 },
  'bergen|helsinki': { flight: 150 },
  'bergen|oslo': { train: 420, flight: 170, car: 480 },
  'bergen|stavanger': { ferry: 390, bus: 330, flight: 150 },
  'copenhagen|gothenburg': { train: 210, flight: 160, car: 220 },
  'copenhagen|kalmar': { train: 260, car: 300, flight: 210 },
  'copenhagen|malmo': { train: 40, bus: 60, car: 50 },
  'copenhagen|oslo': { 'overnight boat': 1050, flight: 170, train: 510 },
  'copenhagen|stockholm': { train: 330, flight: 170, car: 420 },
  'flam|oslo': { train: 370, car: 330, bus: 390 },
  'gothenburg|kalmar': { train: 240, car: 300, bus: 360 },
  'gothenburg|malmo': { train: 180, car: 180, flight: 160 },
  'gothenburg|oslo': { train: 240, bus: 220, car: 220 },
  'gothenburg|stockholm': { train: 190, flight: 150, car: 300 },
  'helsinki|oslo': { flight: 150, train: 1800 },
  'helsinki|stockholm': { 'overnight boat': 1020, flight: 150 },
  'helsinki|tallinn': { ferry: 150 },
  'kalmar|malmo': { train: 210, car: 260, bus: 330 },
  'kalmar|stockholm': { train: 270, flight: 165, car: 240, bus: 360 },
  'malmo|oslo': { train: 420, flight: 170, bus: 480 },
  'malmo|stockholm': { train: 270, flight: 155, car: 390 },
  'munich|tallinn': { flight: 150 },
  'oslo|stavanger': { train: 480, flight: 150, car: 450 },
  'oslo|stockholm': { train: 330, flight: 160, bus: 450 },
  'stockholm|tallinn': { 'overnight boat': 1020, flight: 150 },
};

export function guideDurationMin(fromStop, toStop, mode) {
  const from = fromStop?.cityId;
  const to = toStop?.cityId;
  const key = normalizeDurationMode(mode);
  if (!from || !to || !key) return null;
  const direct = DIRECTIONAL_DURATIONS[directionalKey(from, to)]?.[key];
  if (direct != null) return direct;
  return PAIR_DURATIONS[pairKey(from, to)]?.[key] ?? null;
}

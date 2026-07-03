// Dev-only helpers — never affect production (hostname must be local).

export function isLocalDev() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

// Pick the trip day with the most planned items so the splash preview is rich.
export function pickShowcaseDate(trip) {
  let best = null;
  let bestScore = -1;
  for (const stop of trip.stops || []) {
    for (const day of stop.days || []) {
      let score = 0;
      for (const key of ['morning', 'afternoon', 'evening', 'breakfast', 'lunch', 'dinner']) {
        const v = day.slots?.[key];
        if (Array.isArray(v)) score += v.length;
        else if (v) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = day.date;
      }
    }
  }
  return best;
}

// On localhost, pretend "today" is a trip day. Override with ?simulateDay=YYYY-MM-DD.
export function devSimulatedDateISO(trip) {
  const params = new URLSearchParams(location.search);
  const override = params.get('simulateDay');
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  return pickShowcaseDate(trip) || trip.startDate;
}

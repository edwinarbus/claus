// Recommended length-of-stay ranges per city, keyed by cityId.
//
// These are *advisory* travel-guide ranges (Rick-Steves-style), read at compute
// time — nothing is stored on a stop and no schema bump is needed. The `ideal`
// values are anchored to the suggested nights in DEFAULT_ROUTE (catalog.js)
// where a city appears there; `min`/`max` widen that with common sense:
//   • big capitals (Copenhagen / Stockholm / Oslo): min 3
//   • mid cities (Aarhus / Bergen / Gothenburg / Tromsø): min 2
//   • small / fjord / day-trippable stops (Kalmar / Geiranger / Malmö …):
//     min 1, tight max so an over-long stay gets flagged.
// Cities without an entry simply get no advice (helper returns null).
export const CITY_NIGHTS = {
  // Capitals — worth settling into.
  copenhagen: { name: 'Copenhagen', min: 3, ideal: 3, max: 5 },
  stockholm: { name: 'Stockholm', min: 3, ideal: 3, max: 5 },
  oslo: { name: 'Oslo', min: 3, ideal: 3, max: 5 },
  helsinki: { name: 'Helsinki', min: 2, ideal: 2, max: 4 },
  munich: { name: 'Munich', min: 2, ideal: 3, max: 4 },

  // Mid-size cities.
  aarhus: { name: 'Aarhus', min: 2, ideal: 2, max: 3 },
  bergen: { name: 'Bergen', min: 2, ideal: 2, max: 4 },
  gothenburg: { name: 'Gothenburg', min: 2, ideal: 2, max: 3 },
  tromso: { name: 'Tromsø', min: 2, ideal: 2, max: 4 },
  // The archipelago is a region, not a town — under 2 nights you only see the
  // road; 3 lets you reach Reine at the far end and still hike.
  lofoten: { name: 'Lofoten', min: 2, ideal: 3, max: 5 },

  // Smaller cities / popular day-trips — 1 night is fine, don't linger too long.
  tallinn: { name: 'Tallinn', min: 1, ideal: 2, max: 3 },
  malmo: { name: 'Malmö', min: 1, ideal: 1, max: 2 },

  // Fjords, islands & scenic stops — short and sweet.
  aero: { name: 'Ærø', min: 1, ideal: 2, max: 3 },
  kalmar: { name: 'Kalmar', min: 1, ideal: 2, max: 3 },
  stavanger: { name: 'Stavanger', min: 1, ideal: 2, max: 3 },
  geiranger: { name: 'Geiranger', min: 1, ideal: 1, max: 2 },
};

// Advice for spending `nights` in the city `cityId`.
// Returns null when there's nothing to flag (unknown city, no/zero nights, or
// the stay sits within [min, max]). Otherwise:
//   { level: 'short' | 'long', min, max, ideal, nights, message }
export function nightsAdviceFor(cityId, nights) {
  const rec = CITY_NIGHTS[cityId];
  if (!rec) return null;
  if (typeof nights !== 'number' || !Number.isFinite(nights) || nights <= 0) return null;
  const { name, min, ideal, max } = rec;

  if (nights < min) {
    return {
      level: 'short',
      min, max, ideal, nights,
      message: `${name} really wants ${min}+ nights — you have ${nights}.`,
    };
  }
  if (nights > max) {
    return {
      level: 'long',
      min, max, ideal, nights,
      message: `${nights} nights in ${name} is a lot — ${min}–${max} is plenty.`,
    };
  }
  return null;
}

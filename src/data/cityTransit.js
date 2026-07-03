// How you actually get around inside each catalog city, plus a distance-based
// hop suggestion. Used by the per-day map's "getting around" advice.
// Transit names are the real local systems (verified): e.g. Stockholm's
// Tunnelbana, Bergen's Bybanen light rail, Aarhus's Letbane.

// `fare` is a concise payment note. In the UI the only contactless method we
// name is "Apple Pay". `tap` true = tap Apple Pay at the onboard/station reader
// to ride (💳); false = no tap-to-ride at readers/gates (🎫) — say where Apple
// Pay *does* work instead (ticket machines vs app). Distinguish readers from
// machines: many Nordic systems sell at station machines but won't let you tap
// through the turnstile. Verified against operator sites (2025–2026).
// `glyph` is a transport-mode key (not emoji) rendered by TransportGlyph at the
// call site — see the day map's "getting around" list.
export const CITY_TRANSIT = {
  copenhagen: { primary: 'Metro', glyph: 'metro', tip: 'the driverless Metro runs 24/7, but locals bike everywhere — grab a rental for short hops',
    tap: false, fare: 'No Apple Pay at gates — Apple Pay OK at station ticket machines.' },
  aarhus: { primary: 'Letbane (light rail)', glyph: 'tram', tip: 'the compact center is walkable; the Letbane light rail covers longer hops',
    tap: false, fare: 'No Apple Pay at readers — chip card at Letbane machines, or Apple Pay in the Midttrafik app.' },
  aero: { primary: 'bike', glyph: 'bike', tip: 'it’s a tiny island — walk or rent a bike (the local bus is also free)',
    tap: false, fare: 'Island bus (line 716) is free — no ticket needed.' },
  kalmar: { primary: 'on foot', glyph: 'walk', tip: 'the old town and castle are an easy walk apart',
    tap: false, fare: 'No Apple Pay at door readers — credit card at station machines or KLT app.' },
  stockholm: { primary: 'Tunnelbana (metro)', glyph: 'metro', tip: 'the T-bana is fast and scenic; ferries link the islands',
    tap: true, fare: 'Apple Pay accepted at the green SL readers.' },
  helsinki: { primary: 'tram', glyph: 'tram', tip: 'the tram network blankets the center and is the easy way around',
    tap: true, fare: 'Apple Pay accepted at HSL readers (pick your zone first).' },
  oslo: { primary: 'tram / T-bane', glyph: 'tram', tip: 'trams and the T-bane cover the center; much of it is walkable too',
    tap: false, fare: 'No Apple Pay at readers — buy in the Ruter app (Apple Pay OK; no station machines).' },
  flam: { primary: 'on foot', glyph: 'walk', tip: 'it’s a small fjord-side village — everything is within a short walk',
    tap: false, fare: 'Walkable village — no local transit (book the railway/cruise ahead).' },
  bergen: { primary: 'Bybanen (light rail)', glyph: 'tram', tip: 'the historic core is walkable; the Bybanen light rail and buses reach farther out',
    tap: false, fare: 'No Apple Pay on board — Apple Pay OK at Bybanen ticket machines.' },
  gothenburg: { primary: 'tram', glyph: 'tram', tip: 'it has one of Europe’s largest tram networks',
    tap: true, fare: 'Apple Pay accepted on zone-A trams and buses (tap on board).' },
  malmo: { primary: 'bike / bus', glyph: 'bike', tip: 'flat and bike-friendly; buses fill in the gaps',
    tap: true, fare: 'Apple Pay accepted on green city buses (tap on board).' },
  tromso: { primary: 'bus', glyph: 'bus', tip: 'the island center is compact; local buses reach the cable car and museums',
    tap: false, fare: 'No Apple Pay at readers — buy in the Svipper app (Apple Pay OK).' },
  tallinn: { primary: 'tram', glyph: 'tram', tip: 'the walled Old Town is walkable; trams and buses reach the rest',
    tap: true, fare: 'Apple Pay accepted at the orange front-door validators.' },
  lofoten: { primary: 'car', glyph: 'car', tip: 'distances between villages are long and buses are infrequent — most visitors rent a car',
    tap: false, fare: 'Local buses: pay by card on board or in the Reis Nordland app.' },
  munich: { primary: 'U-Bahn / S-Bahn', glyph: 'metro', tip: 'the U-Bahn and S-Bahn cover the whole city fast; the old town itself is walkable',
    tap: true, fare: 'Apple Pay accepted at MVV ticket machines and validators.' },
};

// Ride-hailing per city — which apps actually have cars on the ground
// (verified mid-2026: Uber RETURNED to Denmark in Jan 2025 via Drivr/Dantaxi,
// Bolt entered via Viggo; Uber Norway now covers Oslo/Bergen/Tromsø but its
// rural listings like Aurland/Flåm are nominal with no real supply; Yango has
// exited both Finland and Norway). `app` is what a tourist should reach for on
// a too-far-to-walk hop; `note` is the day map's getting-around line and must
// say explicitly when Uber does NOT work somewhere.
export const CITY_RIDE_HAIL = {
  copenhagen: { uber: true, bolt: true, app: 'Uber or Bolt', note: 'Uber and Bolt both work here (Uber returned to Denmark in 2025); TAXA 4x35 is the local backup.' },
  aarhus: { uber: true, bolt: false, app: 'Uber', note: 'Uber works here (via the Dantaxi fleet); Bolt doesn’t cover Aarhus yet.' },
  aero: { uber: false, bolt: false, app: null, note: 'No Uber or Bolt on Ærø — the island has a handful of phone-dispatch taxis; pre-book.' },
  kalmar: { uber: false, bolt: false, app: null, note: 'No Uber or Bolt in Kalmar — use a local taxi (phone or station rank).' },
  stockholm: { uber: true, bolt: true, app: 'Uber or Bolt', note: 'Uber and Bolt both work here (Bolt is usually cheaper), including Arlanda.' },
  helsinki: { uber: true, bolt: true, app: 'Bolt', note: 'Bolt (usually cheapest) and Uber both work here, airport included.' },
  oslo: { uber: true, bolt: true, app: 'Uber or Bolt', note: 'Uber and Bolt both work here; the Oslo Taxi app is the local backup.' },
  flam: { uber: false, bolt: false, app: null, note: 'No Uber or Bolt in Flåm — pre-book Aurland Taxi by phone (+47 57 63 34 00); only a few cars exist.' },
  bergen: { uber: true, bolt: true, app: 'Bolt', note: 'Bolt is the reliable pick here; Uber works but cars are thin. Bergen Taxi (Taxifix app) as backup.' },
  gothenburg: { uber: true, bolt: true, app: 'Uber or Bolt', note: 'Uber and Bolt both work here.' },
  malmo: { uber: true, bolt: true, app: 'Bolt', note: 'Bolt (usually cheaper) and Uber both work here.' },
  tromso: { uber: true, bolt: true, app: 'Bolt', note: 'Bolt and Uber both work in town; for airport pickups use Tromsø Taxi (Taxifix app).' },
  lofoten: { uber: false, bolt: false, app: null, note: 'No Uber or Bolt in Lofoten — use the Lofoten Taxi app or call 07550, and always pre-book.' },
  tallinn: { uber: true, bolt: true, app: 'Bolt', note: 'Bolt is the hometown app with the best coverage and prices; Uber works too.' },
  munich: { uber: true, bolt: true, app: 'FREE NOW', note: 'FREE NOW is the dominant local app; Uber and Bolt both work too — German rules mean all three mostly hail licensed taxis/private-hire cars, not casual private drivers.' },
};

// The day map's ride-hailing line for a city ('' when we know nothing).
export function rideHailNote(cityId) {
  const rh = CITY_RIDE_HAIL[cityId];
  return rh ? rh.note : '';
}

// Concise payment label for the day-map "getting around" grid, derived from the
// verified `tap`/`fare` data (e.g. "Apple Pay at ticket machines").
export function transitPayShort(cityId) {
  const t = CITY_TRANSIT[cityId];
  if (!t) return '';
  const f = t.fare || '';
  if (/free/i.test(f)) return 'Free local bus';
  if (t.tap) return 'Apple Pay at readers';
  if (/ticket machines/i.test(f)) return 'Apple Pay at ticket machines';
  if (/app/i.test(f)) {
    // Name the operator's app (e.g. "Ruter", "Midttrafik", "Reis Nordland")
    // instead of a vague "the app" — capitalised words right before "app".
    const m = f.match(/([A-ZÆØÅ][\wÆØÅæøå’]*(?:\s+[A-ZÆØÅ][\wÆØÅæøå’]*)*)\s+app\b/);
    return m ? `Apple Pay in the ${m[1]} app` : 'Apple Pay in the app';
  }
  return 'Card at machines';
}

// Concise ride-hailing label for the grid: the recommended app + a cheap hint,
// or a taxi fallback where no app operates.
export function rideHailShort(cityId) {
  const rh = CITY_RIDE_HAIL[cityId];
  if (!rh) return '';
  if (!rh.app) return 'Local taxi only';
  const cheaper = /cheap/i.test(rh.note || '') ? ' · usually cheaper' : '';
  return `${rh.app}${cheaper}`;
}

// A city's `primary` describes how you get around, which may itself be walking
// or biking (Kalmar, Flåm, Ærø). Those aren't a "ride" you can take for a long
// hop, so resolve a grammatical vehicle suggestion (or fall back to a taxi).
function rideFor(t) {
  const p = ((t && t.primary) || '').trim();
  if (!p || /foot|walk/i.test(p)) return null;          // walkable town → taxi for far hops
  if (/^bike$/i.test(p)) return null;                   // bike-only island → taxi for far hops
  if (/bike\s*\/\s*bus/i.test(p)) return { glyph: 'bus', label: 'the bus' };
  return { glyph: (t && t.glyph) || 'bus', label: `the ${p}` };
}

// Walking speed ~4.8 km/h. Suggest a mode honestly from straight-line distance
// (real walking/transit is a bit longer, so we keep the tone advisory).
function formatDistKm(km) {
  const mi = km * 0.621371;
  if (mi < 0.2) return `${Math.round(km * 3280.84)} ft`;
  return `${mi.toFixed(1)} mi`;
}

export function intraCityHop(cityId, km) {
  const t = CITY_TRANSIT[cityId];
  const ride = rideFor(t);
  const walkMin = Math.max(1, Math.round((km / 4.8) * 60));
  const dist = formatDistKm(km);
  if (km <= 1.3) {
    return { glyph: 'walk', mode: 'Walk', detail: `${walkMin} min on foot (${dist})` };
  }
  if (km <= 3) {
    const alt = ride ? ` or hop ${ride.label}` : '';
    return { glyph: 'walk', mode: 'Walkable', detail: `${walkMin} min walk${alt} (${dist})` };
  }
  if (ride) {
    return { glyph: ride.glyph, mode: `Take ${ride.label}`, detail: `${dist} — a bit far to walk; take ${ride.label}` };
  }
  // No transit ride for this hop: reach for the city's ride-hailing app, never
  // a bare "taxi" — and where no app operates, say to pre-book a local cab.
  const rh = CITY_RIDE_HAIL[cityId];
  if (rh && rh.app) {
    const art = /^[aeiou]/i.test(rh.app) ? 'an' : 'a';
    return { glyph: 'rideshare', mode: `Order ${art} ${rh.app}`, detail: `${dist} — too far to walk; order ${art} ${rh.app}` };
  }
  return { glyph: 'taxi', mode: 'Pre-book a taxi', detail: `${dist} — too far to walk; no Uber/Bolt here, so pre-book a local taxi` };
}

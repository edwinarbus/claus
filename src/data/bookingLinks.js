// Booking links for a trip leg. Philosophy: only link URLs that verifiably
// work. Most Nordic operator sites (SJ, Vy, VR, DSB, Tallink, Viking…) are
// SPAs with no stable, documented query-parameter API — guessed "deep links"
// either 404 or silently ignore the parameters, which reads as broken. For
// those operators we return null and the caller falls back to the operator's
// official page from booking.js. The only prefilled links we keep are the
// documented Google query formats; everything else is a stable, parameter-free
// booking landing page.

// Per-city defaults: main train station (for search-query text) + IATA airport.
const CITY = {
  copenhagen: { train: 'København H', airport: 'CPH' },
  aarhus: { train: 'Aarhus H' },
  aero: { train: 'Ærøskøbing' },
  kalmar: { train: 'Kalmar C' },
  stockholm: { train: 'Stockholm Central', airport: 'ARN' },
  helsinki: { train: 'Helsinki', airport: 'HEL' },
  oslo: { train: 'Oslo S', airport: 'OSL' },
  flam: { train: 'Flåm' },
  bergen: { train: 'Bergen', airport: 'BGO' },
  malmo: { train: 'Malmö C', airport: 'MMX' },
  gothenburg: { train: 'Göteborg C', airport: 'GOT' },
  tromso: { train: 'Tromsø', airport: 'TOS' },
  tallinn: { train: 'Tallinn', airport: 'TLL' },
  stavanger: { train: 'Stavanger', airport: 'SVG' },
  geiranger: { train: 'Geiranger' },
  munich: { train: 'München Hbf', airport: 'MUC' },
};

const OP_HOST = [
  ['dsb.dk', 'dsb'],
  ['sj.se', 'sj'],
  ['vy.no', 'vy'],
  ['vr.fi', 'vr'],
  ['elron.ee', 'elron'],
  ['norwaysbest.com', 'flamsbana'],
  ['norled.no', 'norled'],
  ['fjordline.com', 'fjordline'],
  ['gonordiccruiseline.com', 'gonordic'],
  ['tallink.com', 'tallink'],
  ['vikingline.com', 'viking'],
  ['eckeroline.com', 'eckero'],
  ['oresundstag.se', 'oresund'],
  ['aeroe-ferry.dk', 'aeroe'],
  ['flysas.com', 'sas'],
  ['norwegian.com', 'norwegian'],
  ['finnair.com', 'finnair'],
  ['wideroe.no', 'wideroe'],
  ['flixbus.com', 'flixbus'],
];

export function operatorKey(op) {
  const url = (op?.url || '').toLowerCase();
  if (!url) return '';
  const hit = OP_HOST.find(([host]) => url.includes(host));
  return hit ? hit[1] : '';
}

function cityMeta(stop) {
  return CITY[stop?.cityId] || {};
}

// Departure day for this leg — always from the itinerary stop so URLs stay in
// sync when dates are edited.
export function legTravelDate(fromStop) {
  return fromStop?.endDate || fromStop?.startDate || '';
}

function depStation(fromStop, transport) {
  return (transport?.depStation || '').trim() || cityMeta(fromStop).train || fromStop?.name || '';
}

function arrStation(toStop, transport) {
  return (transport?.arrStation || '').trim() || cityMeta(toStop).train || toStop?.name || '';
}

function depAirport(fromStop, transport) {
  const station = (transport?.depStation || '').trim();
  if (/^[A-Z]{3}$/.test(station)) return station;
  return cityMeta(fromStop).airport || '';
}

function arrAirport(toStop, transport) {
  const station = (transport?.arrStation || '').trim();
  if (/^[A-Z]{3}$/.test(station)) return station;
  return cityMeta(toStop).airport || '';
}

function withQuery(base, params) {
  const q = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return q ? `${base}?${q}` : base;
}

// Ærøfærgerne keeps stable, parameter-free booking pages per direction.
function aeroeUrl(fromStop, toStop) {
  const toAero = toStop?.cityId === 'aero';
  const fromAero = fromStop?.cityId === 'aero';
  if (!toAero && !fromAero) return null;
  return toAero
    ? 'https://www.aeroe-ferry.dk/en/book-ticket/to-aero/'
    : 'https://www.aeroe-ferry.dk/en/book-ticket/from-aero/';
}

// Norway's Best's booking landing page is a stable path (covers Flåm Railway).
function flamsbanaUrl(fromStop, toStop) {
  const ids = [fromStop?.cityId, toStop?.cityId];
  if (ids.includes('flam')) return 'https://www.norwaysbest.com/en/booking/';
  return null;
}

// Google Travel's `q=` deep link is documented and stable.
function googleFlightsUrl(fromStop, toStop, transport) {
  const from = depAirport(fromStop, transport) || depStation(fromStop, transport);
  const to = arrAirport(toStop, transport) || arrStation(toStop, transport);
  if (!from || !to) return null;
  const date = legTravelDate(fromStop);
  const q = date
    ? `Flights from ${from} to ${to} on ${date}`
    : `Flights from ${from} to ${to}`;
  return withQuery('https://www.google.com/travel/flights', {
    q,
    hl: 'en',
    curr: 'EUR',
    gl: 'dk',
  });
}

export function liveSearchUrl(fromStop, toStop, mode, transport) {
  const from = depStation(fromStop, transport) || fromStop?.name || '';
  const to = arrStation(toStop, transport) || toStop?.name || '';
  const date = legTravelDate(fromStop);
  const time = transport?.depTime ? ` ${transport.depTime}` : '';
  const q = [from, 'to', to, mode, date, time, 'tickets'].filter(Boolean).join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// Best link for one operator on this leg. Returns null when no verified deep
// link exists — caller falls back to op.url (the official site), which always
// works even if it means picking the route there.
export function operatorBookingUrl(op, { fromStop, toStop, transport } = {}) {
  if (!op) return null;

  switch (operatorKey(op)) {
    case 'aeroe':
      return aeroeUrl(fromStop, toStop);
    case 'flamsbana':
      return flamsbanaUrl(fromStop, toStop);
    case 'sas':
    case 'norwegian':
    case 'finnair':
    case 'wideroe':
      return googleFlightsUrl(fromStop, toStop, transport);
    // Rail/ferry SPAs (SJ, Vy, VR, DSB, Tallink, Viking, …) have no stable
    // prefill API — their official pages from booking.js are the real links.
    default:
      return null;
  }
}

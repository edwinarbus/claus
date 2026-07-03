// Transport booking guidance.
//
// HIGH-STAKES ACCURACY NOTE:
// This module deliberately does NOT assert live prices, times, or seat
// availability — those change constantly and inventing them would mislead
// travelers. Instead it provides:
//   1. Verified operator names + official booking URLs (the authoritative
//      source travelers should buy from).
//   2. Stable, researched guidance on whether advance booking matters.
//   3. A live route+date search link so the traveler sees CURRENT info.
//
// Facts below were verified against official operators (vy.no, sj.se, dsb.dk,
// norled.no, tallink.com, vikingline.com, eckeroline.com, oresundstag.se,
// aeroe-ferry.dk) in June 2026. Always defer to the operator site for specifics.

const OP = {
  dsb: { name: 'DSB', url: 'https://www.dsb.dk/en/' },
  sj: { name: 'SJ', url: 'https://www.sj.se/en' },
  vy: { name: 'Vy', url: 'https://www.vy.no/en' },
  vr: { name: 'VR', url: 'https://www.vr.fi/en' },
  elron: { name: 'Elron', url: 'https://elron.ee/en/' },
  flamsbana: { name: 'Flåm Railway (Norway’s Best)', url: 'https://www.norwaysbest.com/' },
  norled: { name: 'Norled', url: 'https://www.norled.no/en/' },
  fjordline: { name: 'Fjord Line', url: 'https://fjordline.com/en' },
  gonordic: { name: 'Go Nordic Cruiseline', url: 'https://www.gonordiccruiseline.com/' },
  tallink: { name: 'Tallink Silja', url: 'https://www.tallink.com/' },
  viking: { name: 'Viking Line', url: 'https://www.vikingline.com/' },
  eckero: { name: 'Eckerö Line', url: 'https://www.eckeroline.com/' },
  oresund: { name: 'Øresundståg', url: 'https://www.oresundstag.se/en/' },
  aeroe: { name: 'Ærøfærgerne', url: 'https://www.aeroe-ferry.dk/en/' },
  sas: { name: 'SAS', url: 'https://www.flysas.com/' },
  norwegian: { name: 'Norwegian', url: 'https://www.norwegian.com/' },
  finnair: { name: 'Finnair', url: 'https://www.finnair.com/' },
  wideroe: { name: 'Widerøe', url: 'https://www.wideroe.no/' },
  flixbus: { name: 'FlixBus', url: 'https://www.flixbus.com/' },
};

// National rail operator by country (for generic train guidance).
const RAIL_BY_COUNTRY = {
  Denmark: OP.dsb, Sweden: OP.sj, Norway: OP.vy, Finland: OP.vr, Estonia: OP.elron,
};

// Urgency levels — kept honest and consistent.
//   required    → you really should hold a booking before you go
//   recommended → booking ahead saves money and/or a sold-out risk in summer
//   optional    → turn up and go; pre-booking is a convenience at most
export const URGENCY = {
  required: { label: 'Book ahead', tone: 'rose' },
  recommended: { label: 'Worth booking ahead', tone: 'amber' },
  optional: { label: 'No need to pre-book', tone: 'emerald' },
};

export function modeKey(mode = '') {
  const m = mode.toLowerCase();
  if (m.includes('overnight')) return 'overnight';
  if (m.includes('express boat')) return 'expressboat';
  if (m.includes('ferry') || m.includes('boat') || m.includes('cruise') || m.includes('sail')) return 'ferry';
  if (m.includes('flight') || m.includes('fly') || m.includes('air') || m.includes('plane')) return 'flight';
  if (m.includes('train') || m.includes('rail')) return 'train';
  if (m.includes('bus') || m.includes('coach')) return 'bus';
  if (m.includes('car') || m.includes('drive')) return 'car';
  return 'other';
}

function pairKey(a, b) {
  return [a, b].filter(Boolean).sort().join('|');
}

function osloFlamRailGuidance(fromStop) {
  const fromOslo = fromStop?.cityId === 'oslo';
  return {
    urgency: 'recommended',
    headline: 'The Bergen Line + Flåm Railway fill up in summer — book early',
    detail: fromOslo
      ? 'The scenic Oslo→Myrdal Bergen Line connects to the Flåm Railway (Flåmsbana) down to Flåm. Cheap “Minipris” fares are limited and the trains genuinely sell out in peak summer, so book as soon as your date opens.'
      : 'The scenic Flåm Railway (Flåmsbana) climbs from Flåm to Myrdal, where you connect to the Bergen Line east to Oslo. Cheap “Minipris” fares are limited and the trains genuinely sell out in peak summer, so book as soon as your date opens.',
    window: 'Vy opens sales ~115 days out (Flåm Railway ~120 days).',
    operators: [OP.vy, OP.flamsbana],
    operatorsNote: fromOslo
      ? 'These are two legs, not competitors: book Vy for the Oslo→Myrdal Bergen Line, then the Flåm Railway (Flåmsbana) for Myrdal→Flåm.'
      : 'These are two legs, not competitors: book the Flåm Railway (Flåmsbana) for Flåm→Myrdal, then Vy for the Myrdal→Oslo Bergen Line.',
  };
}

// ---- Route-specific guidance (verified) ----------------------------------
// Keyed by sorted cityId pair, then normalized mode. Only the modes that make
// real sense for that leg are listed; anything else falls back to generic.
const ROUTE = {
  'aarhus|copenhagen': {
    train: {
      urgency: 'recommended',
      headline: 'Standard tickets never sell out; “Orange” fares are far cheaper if booked early',
      detail: 'DSB runs 30+ trains a day, so you can always travel on a flexible Standard ticket. Discounted Orange tickets (tied to one departure) go on sale ~2 months ahead and save a lot. A seat reservation is optional but smart on busy Friday/Sunday departures.',
      window: 'Orange fares open ~2 months before travel.',
      operators: [OP.dsb],
    },
  },
  'aarhus|aero': { ferry: 'AERO_FERRY' },
  'aero|kalmar': { ferry: 'AERO_FERRY' },
  'aero|copenhagen': { ferry: 'AERO_FERRY' },
  'kalmar|stockholm': {
    train: {
      urgency: 'recommended',
      headline: 'SJ uses airline-style pricing — book early, summer trains can sell out',
      detail: 'SJ high-speed/InterCity trains are fully seat-reserved, so a sold-out train means no more tickets. Fares are released about 90 days out and climb with demand; book as soon as your date opens.',
      window: 'Tickets released ~90 days before departure.',
      operators: [OP.sj],
    },
  },
  'helsinki|stockholm': {
    overnight: {
      urgency: 'recommended',
      headline: 'Book your cabin well ahead — they sell out in peak summer',
      detail: 'Two competing lines (Tallink Silja and Viking Line) sail nightly between Stockholm and Helsinki. The overnight cabin doubles as your hotel, so cabins — especially cheaper classes — sell out on summer weekends. You can book up to the day of, but don’t count on it in July.',
      window: 'Book weeks ahead for July; cheapest cabins go first.',
      operators: [OP.tallink, OP.viking],
    },
  },
  'helsinki|oslo': {
    flight: {
      urgency: 'recommended',
      headline: 'Short hop — book early for the best fare',
      detail: 'SAS and Norwegian (and Finnair on some days) fly Helsinki–Oslo in ~1h20. There’s no need to “reserve a seat,” but fares are lowest booked well ahead.',
      window: 'Fares usually cheapest several weeks+ out.',
      operators: [OP.sas, OP.norwegian, OP.finnair],
    },
  },
  'bergen|helsinki': {
    flight: {
      urgency: 'recommended',
      headline: 'Finnair flies the only nonstop (seasonal) — book early',
      detail: 'Finnair is the sole nonstop Helsinki→Bergen — about 2h30, roughly 9 times a week in summer — but it’s seasonal (about April–October). For a July trip you’re fine; off-season or if it’s sold out, connect via Oslo, Stockholm or Copenhagen on SAS or Norwegian (3–5h+). Either way this flight kicks off the Norway-in-a-Nutshell run toward Oslo.',
      window: 'Summer nonstop on Finnair — verify your date has it; fares cheapest weeks+ out.',
      operators: [OP.finnair, OP.sas, OP.norwegian],
    },
  },
  'flam|oslo': {
    train: osloFlamRailGuidance,
  },
  'bergen|flam': {
    train: {
      urgency: 'recommended',
      headline: 'Norway in a Nutshell — buy the combined ticket and book the cruise early',
      detail: 'The Bergen→Flåm direction is the classic Norway-in-a-Nutshell sequence: Bergen Railway to Voss, bus to Gudvangen, the Nærøyfjord cruise to Flåm. Book it as one combined ticket (Norway’s Best / Vy); the timed cruise + bus connections and cheap rail fares sell out in peak summer.',
      window: 'Vy opens ~115 days out; reserve the Nærøyfjord cruise early for July.',
      operators: [OP.vy, OP.flamsbana, OP.norled],
      operatorsNote: 'One combined Norway-in-a-Nutshell ticket covers the train, bus and cruise — you don’t book each leg separately.',
    },
    expressboat: {
      urgency: 'recommended',
      headline: 'Prefer the direct boat? Daily fjord express (Apr–Oct) — book ahead',
      detail: 'To skip the connections, Norled runs the passenger-only Sognefjord express boat straight between Bergen and Flåm once daily each way (Apr 1–Oct 31). It’s passenger-only (no cars) and popular with travelers, so reserve ahead in summer.',
      window: 'Runs Apr 1–Oct 31; book ahead for July sailings.',
      operators: [OP.norled],
    },
    ferry: {
      urgency: 'recommended',
      headline: 'Daily fjord express (Apr–Oct) — book ahead in summer',
      detail: 'Norled runs the passenger-only Sognefjord express boat between Bergen and Flåm once daily each way (Apr 1–Oct 31). Reserve ahead in summer.',
      window: 'Runs Apr 1–Oct 31; book ahead for July sailings.',
      operators: [OP.norled],
    },
  },
  'bergen|stavanger': {
    ferry: {
      urgency: 'recommended',
      headline: 'Coastal ferry is scenic but schedule-dependent — book ahead',
      detail: 'Fjord Line operates the domestic coastal ferry between Bergen and Stavanger. It is a real transfer, not just a tour, but sailings are limited enough that you should lock it in before building the rest of the day.',
      window: 'Book once your travel date is fixed.',
      operators: [OP.fjordline],
    },
  },
  'copenhagen|oslo': {
    overnight: {
      urgency: 'recommended',
      headline: 'Daily overnight ferry — book a cabin ahead in summer',
      detail: 'Go Nordic Cruiseline now operates the overnight route between Copenhagen and Oslo. The cabin replaces a hotel night, and summer cabin categories can sell out.',
      window: 'Book weeks ahead for July cabins.',
      operators: [OP.gonordic],
    },
  },
  'copenhagen|malmo': {
    train: {
      urgency: 'optional',
      headline: 'Turn up and go — fixed price, unlimited seats, every 15–20 min',
      detail: 'The Øresundståg regional train crosses the bridge in ~35–45 min with no advance-purchase advantage and no risk of selling out. Just buy a ticket (Øresundståg site, ticket machine, or the Skånetrafiken app) and hop on the next one. Tickets are not sold on board.',
      window: 'No advance booking needed.',
      operators: [OP.oresund],
    },
  },
  'helsinki|tallinn': {
    ferry: {
      urgency: 'recommended',
      headline: 'Frequent 2-hour crossings, but summer weekend sailings sell out',
      detail: 'Three lines (Tallink Silja, Viking Line, Eckerö) cross the Gulf of Finland many times a day. Walk-on tickets are often available same-day, but popular summer departures (especially Saturday mornings on Tallink’s fast ships) sell out — book a few days to weeks ahead for July.',
      window: 'Book several days–weeks ahead in summer.',
      operators: [OP.tallink, OP.viking, OP.eckero],
      recommend: { name: 'Tallink Silja', url: OP.tallink.url, why: 'it runs the most frequent fast (~2h) crossings, so it’s the easiest to fit around your day — Eckerö is often a little cheaper but slower and less frequent' },
    },
  },
  'stockholm|tallinn': {
    overnight: {
      urgency: 'recommended',
      headline: 'Book your Baltic cabin ahead',
      detail: 'Tallink Silja operates the Stockholm–Tallinn overnight crossing. Treat the cabin like lodging and reserve ahead in summer.',
      window: 'Book weeks ahead for July cabins.',
      operators: [OP.tallink],
    },
  },
};

// ---- Generic per-mode guidance (fallback) --------------------------------
function uniqueOps(ops) {
  const seen = new Set();
  return ops.filter((o) => {
    const k = o?.url || o?.name;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function genericTrain(fromStop, toStop) {
  const a = RAIL_BY_COUNTRY[fromStop?.country];
  const b = RAIL_BY_COUNTRY[toStop?.country];
  const ops = uniqueOps([a, b].filter(Boolean));
  return {
    urgency: 'recommended',
    headline: 'Cheaper booked early; busy long-distance trains can sell out in summer',
    detail: 'Long-distance trains in Scandinavia use dynamic pricing — advance fares are much cheaper, and fully-reserved high-speed trains can sell out on popular summer days. Short regional hops you can usually just buy and board.',
    window: 'Advance fares typically open 1–3 months ahead.',
    operators: ops,
    operatorsNote: ops.length > 1
      ? 'This leg crosses a border — book through either national railway; cross-border trips are sometimes ticketed separately per country.'
      : undefined,
  };
}

const GENERIC = {
  flight: () => ({
    urgency: 'recommended',
    headline: 'Book early for the best fare',
    detail: 'Fares rise closer to departure. Compare the main Nordic carriers for your dates; there’s nothing that “sells out” the way a cabin does, but prices climb.',
    window: 'Prices usually lowest several weeks+ out.',
    operators: [OP.sas, OP.norwegian, OP.finnair, OP.wideroe],
  }),
  overnight: () => ({
    urgency: 'recommended',
    headline: 'Book your cabin ahead — they sell out in summer',
    detail: 'Overnight cabins on the Baltic cruise-ferries sell out in peak summer. Book ahead to lock in your cabin class.',
    window: 'Book weeks ahead for summer; cheapest cabins go first.',
    operators: [OP.tallink, OP.viking],
  }),
  ferry: () => ({
    urgency: 'recommended',
    headline: 'Popular in summer — book ahead to be safe',
    detail: 'Summer sailings (especially weekends) fill up. Booking ahead secures your spot and usually the best price; verify the exact operator and terminal for your route.',
    window: 'Book days–weeks ahead in summer.',
    operators: [],
  }),
  expressboat: () => ({
    urgency: 'recommended',
    headline: 'Scenic boats run limited summer departures — book ahead',
    detail: 'Fjord/express boats often run just once or twice daily in summer and are popular with travelers, so reserve ahead. Confirm the operator and season for your specific route.',
    window: 'Limited daily departures; book ahead.',
    operators: [OP.norled],
  }),
  bus: () => ({
    urgency: 'optional',
    headline: 'Cheapest booked early, but usually fine same-day',
    detail: 'Coach fares are lowest in advance, yet seats are normally available day-of outside peak times. Book ahead for overnight coaches or holiday weekends.',
    window: 'Advance fares cheapest; same-day usually possible.',
    operators: [OP.flixbus],
  }),
  car: () => ({
    urgency: 'optional',
    headline: 'Nothing to pre-book for the drive itself',
    detail: 'There’s no ticket for driving. If renting, reserve the car ahead in summer and budget for one-way drop-off fees, tolls, and any car-ferry crossings (book those separately).',
    window: 'Reserve rentals early in summer.',
    operators: [],
  }),
  other: () => ({
    urgency: 'optional',
    headline: 'Check the operator for booking rules',
    detail: 'Confirm how this leg is operated and whether advance booking is needed.',
    window: '',
    operators: [],
  }),
};

// The shared Ærø ferry guidance (used by several legs touching the island).
const AERO_FERRY = {
  urgency: 'recommended',
  headline: 'Reserve ahead — foot passengers and cars both book in advance',
  detail: 'The Svendborg–Ærøskøbing crossing (Ærøfærgerne) advises booking ahead; on some sailings advance booking is required for foot passengers and vehicles. Summer departures are busy, so reserve your spot and arrive 10+ minutes early.',
  window: 'Book ahead, especially summer; arrive 10 min early.',
  operators: [OP.aeroe],
};

function resolveRouteEntry(entry, fromStop, toStop) {
  if (entry === 'AERO_FERRY') return AERO_FERRY;
  return typeof entry === 'function' ? entry(fromStop, toStop) : entry;
}

// Public: guidance for traveling `mode` from one stop to the next.
export function bookingGuidance(fromStop, toStop, mode) {
  const mk = modeKey(mode);
  const key = pairKey(fromStop?.cityId, toStop?.cityId);
  const routeEntry = ROUTE[key] && ROUTE[key][mk];
  if (routeEntry) {
    return { ...resolveRouteEntry(routeEntry, fromStop, toStop), mode, modeKey: mk };
  }
  const make = mk === 'train' ? () => genericTrain(fromStop, toStop) : (GENERIC[mk] || GENERIC.other);
  return { ...make(), mode, modeKey: mk };
}

// Public: a live, route+date-specific search link so travelers see CURRENT
// times/prices from the source (we never fabricate those).
export { liveSearchUrl, operatorBookingUrl, legTravelDate } from './bookingLinks.js';

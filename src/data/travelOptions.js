// Per-leg travel-options advisor: the best way to travel a leg, plus honest
// pros/cons for each realistic option.
//
// ACCURACY: route-specific entries below reflect the real geography of this
// Scandinavia itinerary (bridges, fjords, Baltic crossings, the Arctic) and
// were sanity-checked against operators. For custom/unknown legs we fall back
// to a conservative distance-based model with generic mode trade-offs and a
// "verify locally" flag. We never invent exact prices or schedules.

import { haversineKm, estimateDurationMin, suggestTransport } from './logistics.js';

export function normalizeMode(mode = '') {
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

// Generic, mode-level trade-offs for the distance-based fallback.
const MODE_TRAITS = {
  train: {
    pros: ['City-center to city-center — no airport security', 'Comfortable; you can move around and see the scenery'],
    cons: ['Slower than flying over long distances', 'Cheapest fares need booking in advance'],
  },
  flight: {
    pros: ['Fastest once the distance is large'],
    cons: ['Airport transfers + security add ~2–3h end-to-end', 'Less scenic; fares rise close to departure'],
  },
  bus: {
    pros: ['Usually the cheapest fare'],
    cons: ['Slowest option', 'Less comfortable for long hauls'],
  },
  car: {
    pros: ['Door-to-door freedom; reach rural spots'],
    cons: ['Parking, tolls, and fuel add up', 'One-way rental drop-off fees', 'A car is a liability inside cities'],
  },
  ferry: {
    pros: ['Scenic sea crossing', 'Often the only direct way across the water'],
    cons: ['Limited daily departures', 'Weather-dependent'],
  },
  'express boat': {
    pros: ['Sightseeing built into the journey'],
    cons: ['Only a couple departures a day; often seasonal'],
  },
  'overnight boat': {
    pros: ['The cabin doubles as a hotel night', 'Fun onboard dining/sauna; wake up in the next city'],
    cons: ['Long (overnight) and arrives next morning', 'Cabins sell out in summer'],
  },
};

function routeEntry(entry, fromStop, toStop) {
  return typeof entry === 'function' ? entry(fromStop, toStop) : entry;
}

function cityName(stop) {
  return stop?.name || '';
}

function osloFlamOptions(fromStop) {
  const fromOslo = fromStop?.cityId === 'oslo';
  const trainPros = fromOslo
    ? ['Oslo S → Myrdal on the Bergen Line, then Myrdal → Flåm on the Flåm Railway', 'Plan on 6-8h total; the fastest clean connections are just over 6h']
    : ['Flåm → Myrdal on the Flåm Railway, then Myrdal → Oslo S on the Bergen Line', 'Plan on 6-8h total; the fastest clean connections are just over 6h'];
  return {
    best: 'train',
    reason: fromOslo
      ? 'the Bergen Line + Flåm Railway is the classic scenic route from Oslo down to the fjord'
      : 'the Flåm Railway + Bergen Line is the classic scenic route from the fjord back to Oslo',
    options: [
      { mode: 'train', duration: 370, pros: trainPros, cons: ['One change at Myrdal', 'Cheap fares and seats sell out in summer — book ahead'] },
      { mode: 'car', duration: 330, pros: ['Stop at viewpoints and stave churches'], cons: ['Long mountain drive', fromOslo ? 'You would skip arriving by the famous Flåm Railway descent' : 'You would skip the famous Flåm Railway climb out of Flåm', 'Parking once you arrive'] },
      { mode: 'bus', duration: 390, pros: ['Sometimes cheaper than rail'], cons: ['Slower and less scenic than the train', 'Connections can be awkward'] },
    ],
  };
}

function bergenFlamOptions(fromStop) {
  const fromBergen = fromStop?.cityId === 'bergen';
  // Bergen → Flåm is the headline Norway-in-a-Nutshell leg: rail to Voss, bus to
  // Gudvangen, the Nærøyfjord cruise, then into Flåm. Lead with it that way; the
  // direct express boat and direct rail are the faster alternatives.
  if (fromBergen) {
    return {
      best: 'train',
      reason: 'Norway in a Nutshell — Bergen Railway to Voss, bus to Gudvangen, the Nærøyfjord cruise, then into Flåm',
      options: [
        {
          mode: 'train',
          duration: 360,
          pros: [
            'The classic sequence: Bergen Railway → Voss → bus to Gudvangen → Nærøyfjord cruise → Flåm',
            'Sails the UNESCO Nærøyfjord by boat on the way in — the scenery is the point',
          ],
          cons: ['Several timed connections — buy the combined Norway-in-a-Nutshell ticket', 'A full travel day; book ahead in summer'],
        },
        {
          mode: 'express boat',
          duration: 325,
          pros: ['Direct passenger boat from central Bergen up the Sognefjord to Flåm (~5h25)', 'All on the water, no connections'],
          cons: ['One departure a day', 'Seasonal (Apr–Oct) and weather-dependent', 'Skips the railways'],
        },
        { mode: 'car', duration: 180, pros: ['Most flexible for Stegastein and stave-church detours'], cons: ['Mountain roads + tunnels', 'You miss the rail-and-cruise experience'] },
      ],
    };
  }
  // Flåm → Bergen: the fjord express boat is the headline sightseeing transfer.
  return {
    best: 'express boat',
    reason: 'the Flåm-to-Bergen fjord express makes the transfer part of the sightseeing',
    options: [
      {
        mode: 'express boat',
        duration: 325,
        pros: ['Afternoon boat from Flåm reaches central Bergen in about 5h25', 'Cruises Sognefjord scenery with no driving'],
        cons: ['One departure a day', 'Seasonal (Apr-Oct) and weather-dependent', 'Book ahead in summer'],
      },
      {
        mode: 'train',
        duration: 180,
        pros: ['Flåm Railway up to Myrdal, then the Bergen Line to Bergen', 'Scenic, fast, and year-round'],
        cons: ['Change at Myrdal', 'Misses the fjord-from-the-water view'],
      },
      { mode: 'bus', duration: 240, pros: ['By road via Gudvangen and Voss; often cheapest'], cons: ['Least scenic of the main options'] },
      { mode: 'car', duration: 180, pros: ['Flexibility for fjord detours'], cons: ['Tunnels + possible ferries', 'Then you have a car in a city where you may not need one'] },
    ],
  };
}

function copenhagenOsloOptions(fromStop, toStop) {
  return {
    best: 'overnight boat',
    reason: `the overnight ferry turns ${cityName(fromStop)} to ${cityName(toStop)} into a hotel night`,
    options: [
      { mode: 'overnight boat', duration: 1050, pros: ['Overnight sailing with next-morning arrival', 'Cabin doubles as lodging; scenic harbor approach'], cons: ['Overnight, not fast', 'Cabins should be booked ahead in summer'] },
      { mode: 'flight', duration: 170, pros: ['Fastest if you want more city time'], cons: ['Airport transfers and an extra hotel night'] },
      { mode: 'train', duration: 510, pros: ['Rail all the way via Sweden'], cons: ['Longer and less direct than the ferry or flight'] },
    ],
  };
}

function aeroRailRoute(fromStop, toStop, mainlandText) {
  const toAero = toStop?.cityId === 'aero';
  return toAero
    ? `${mainlandText}, then ferry from Svendborg to Ærøskøbing`
    : `Ferry from Ærøskøbing to Svendborg, then ${mainlandText.toLowerCase()}`;
}

function aarhusAeroOptions(fromStop, toStop) {
  return {
    best: 'train',
    reason: `train plus the Ærø ferry is the clean car-free way from ${cityName(fromStop)} to ${cityName(toStop)}`,
    options: [
      { mode: 'train', duration: 300, pros: [aeroRailRoute(fromStop, toStop, 'Train via Odense to Svendborg'), 'No car needed on Ærø'], cons: ['Several connections — leave buffer time', 'Book the ferry ahead in summer'] },
      { mode: 'car', duration: 240, pros: ['Easier with luggage; handy if island-hopping'], cons: ['Reserve the car ferry well ahead in summer', 'A car is overkill on Ærø'] },
    ],
    note: 'The leg includes the Svendborg-Ærøskøbing ferry (Ærøfærgerne).',
  };
}

function copenhagenAeroOptions(fromStop, toStop) {
  return {
    best: 'train',
    reason: `train plus the Ærø ferry is the simplest car-free route from ${cityName(fromStop)} to ${cityName(toStop)}`,
    options: [
      { mode: 'train', duration: 250, pros: [aeroRailRoute(fromStop, toStop, 'Rail to Svendborg'), 'No car needed on Ærø'], cons: ['Coordinate the train/ferry connection', 'Book the ferry ahead in summer'] },
      { mode: 'car', duration: 210, pros: ['Convenient with luggage'], cons: ['Reserve the car ferry', 'A car is not very useful once on Ærø'] },
    ],
    note: 'All Ærø routes include a ferry; Svendborg-Ærøskøbing is the natural public-transport link.',
  };
}

function kalmarAeroOptions(fromStop, toStop) {
  const toAero = toStop?.cityId === 'aero';
  return {
    best: 'train',
    reason: toAero
      ? 'trains across Sweden/Denmark plus the ferry get you onto Ærø without a car'
      : 'the ferry gets you off Ærø, then trains carry you across Denmark and Sweden',
    options: [
      { mode: 'train', duration: 480, pros: [toAero ? 'Rail across Sweden/Denmark, then ferry to Ærø' : 'Ferry to the mainland, then rail across to Sweden'], cons: ['Long day with several changes — start early', 'Pre-book the Ærø ferry'] },
      { mode: 'car', duration: 420, pros: ['One vehicle for the mainland portions, ferry included'], cons: ['Long day; Great Belt/Øresund tolls', 'Reserve ferries ahead'] },
    ],
  };
}

function kalmarStockholmOptions(fromStop, toStop) {
  const fromKalmar = fromStop?.cityId === 'kalmar';
  return {
    best: 'train',
    reason: `rail is the comfortable city-center choice from ${cityName(fromStop)} to ${cityName(toStop)}`,
    options: [
      { mode: 'train', duration: 270, pros: ['~4-5h, city-center to city-center'], cons: ['Usually one change', 'Book SJ early — fully-reserved trains can sell out'] },
      { mode: 'flight', duration: 165, pros: [fromKalmar ? 'Kalmar (KLR) → Stockholm is about 1h if schedules line up' : 'Stockholm → Kalmar (KLR) is about 1h if schedules line up'], cons: ['Small airport with limited daily flights', 'Airport transfers offset the speed'] },
      { mode: 'car', duration: 240, pros: ['Freedom along the Baltic coast'], cons: ['~4h drive', 'City parking'] },
      { mode: 'bus', duration: 360, pros: ['Cheapest fares'], cons: ['Long (5-6h)'] },
    ],
  };
}

// ---- Route-specific options (best-first) ---------------------------------
const ROUTE = {
  'bergen|oslo': {
    best: 'train', reason: 'the Bergen Railway is slower than flying but is one of Norway’s great scenic rides',
    options: [
      { mode: 'train', duration: 420, pros: ['~7h across Hardangervidda, city-center to city-center', 'A signature Norway rail journey'], cons: ['Much slower than flying', 'Daylight matters for the scenery'] },
      { mode: 'flight', duration: 170, pros: ['Fastest end-to-end if the day is tight'], cons: ['Airport transfers and security', 'Misses the mountain plateau'] },
      { mode: 'car', duration: 480, pros: ['Freedom for fjord viewpoints and detours'], cons: ['Long mountain drive', 'Weather and road closures can bite'] },
    ],
  },
  'bergen|stavanger': {
    best: 'ferry', reason: 'the coastal ferry is the most scenic direct link between the west-coast cities',
    options: [
      { mode: 'ferry', duration: 390, pros: ['~6.5h along the coast, with cabins/restaurants onboard', 'Direct coastal sailing between the two cities'], cons: ['Limited departure pattern; check the sailing date'] },
      { mode: 'bus', duration: 330, pros: ['Often the most frequent practical public-transport option'], cons: ['Less special than the coastal sailing', 'Includes road ferry crossings'] },
      { mode: 'flight', duration: 150, pros: ['Fastest if schedules line up'], cons: ['Airport time erases some of the gain'] },
    ],
  },
  'copenhagen|gothenburg': {
    best: 'train', reason: 'the Øresund/SJ rail corridor links Copenhagen and Gothenburg cleanly through Malmö',
    options: [
      { mode: 'train', duration: 210, pros: ['Direct or one-change rail around ~3.5h', 'City-center to city-center'], cons: ['Track work can mean a change in Malmö'] },
      { mode: 'flight', duration: 160, pros: ['Quick in the air'], cons: ['Airport overhead makes it rarely worth it'] },
      { mode: 'car', duration: 220, pros: ['Flexible coastal detours'], cons: ['Øresund tolls and city parking'] },
    ],
  },
  'copenhagen|kalmar': {
    best: 'train', reason: 'the rail corridor through Malmö/Alvesta works cleanly between Copenhagen and Kalmar',
    options: [
      { mode: 'train', duration: 260, pros: ['Practical rail via Malmö/Alvesta or direct regional services', 'No airport hop for a midsize city'], cons: ['Usually not as fast as Stockholm/Gothenburg high-speed routes'] },
      { mode: 'car', duration: 300, pros: ['Useful if you want countryside stops'], cons: ['Bridge/toll costs and city parking'] },
      { mode: 'flight', duration: 210, pros: ['Can be fast if schedules fit'], cons: ['Small-airport logistics; often indirect'] },
    ],
  },
  'copenhagen|oslo': copenhagenOsloOptions,
  'copenhagen|stockholm': {
    best: 'train', reason: 'SJ runs the direct Scandinavian capital rail corridor without airport overhead',
    options: [
      { mode: 'train', duration: 330, pros: ['About 5–6h city-center to city-center', 'Comfortable and straightforward'], cons: ['Book ahead for the best fares'] },
      { mode: 'flight', duration: 170, pros: ['Fastest point-to-point'], cons: ['Transfers/security shrink the time saving'] },
      { mode: 'car', duration: 420, pros: ['Freedom for stops in southern Sweden'], cons: ['Long drive plus bridge/toll/parking costs'] },
    ],
  },
  'aarhus|copenhagen': {
    best: 'train', reason: 'fast, frequent, and city-center to city-center',
    options: [
      { mode: 'train', duration: 180, pros: ['Under 3h, 30+ departures a day', 'Cheap “Orange” fares if booked early'], cons: ['Cheapest fares sell out — grab them ~2 months ahead'] },
      { mode: 'bus', duration: 270, pros: ['Cheapest fares'], cons: ['~1–1.5h slower than the train'] },
      { mode: 'car', duration: 210, pros: ['Can break the trip in Odense/Funen'], cons: ['Great Belt Bridge toll (~€33)', 'Parking hassle — you won’t want a car downtown'] },
      { mode: 'flight', duration: 200, pros: ['Quick once airborne'], cons: ['Transfers + security wipe out any time saving for ~150 km', 'Not worth it'] },
    ],
  },
  'copenhagen|malmo': {
    best: 'train', reason: 'the Øresund Bridge train is faster and simpler than anything else',
    options: [
      { mode: 'train', duration: 40, pros: ['~35–45 min over the Øresund Bridge', 'Every 15–20 min, fixed price, never sells out'], cons: ['Occasional ID checks add a few minutes'] },
      { mode: 'bus', duration: 60, pros: ['Sometimes marginally cheaper'], cons: ['Slower and less frequent than the train'] },
      { mode: 'car', duration: 50, pros: ['Only useful mid road-trip'], cons: ['Steep bridge toll (~€60 each way)', 'No reason to drive between two walkable cities'] },
    ],
  },
  'helsinki|stockholm': {
    best: 'overnight boat', reason: 'the overnight cruise replaces a hotel night and is an experience in itself',
    options: [
      { mode: 'overnight boat', duration: 1020, pros: ['Cabin = your hotel for the night', 'Gorgeous archipelago sailing + buffet/entertainment', 'Wake up in the city center'], cons: ['~16–17h total', 'Cabins sell out in summer — book ahead'] },
      { mode: 'flight', duration: 150, pros: ['~50 min in the air — fastest by far', 'Best if you’d rather not lose an evening to sailing'], cons: ['Airport transfers both ends, plus you’ll pay for a hotel night', 'Misses the iconic Baltic cruise'] },
    ],
    note: 'There’s no land route — it’s open water between Sweden and Finland.',
  },
  'helsinki|oslo': {
    best: 'flight', reason: 'a ~1h20 nonstop is the only sensible way across',
    options: [
      { mode: 'flight', duration: 150, pros: ['~1h20 nonstop', 'SAS, Norwegian and Finnair compete on price'], cons: ['Book early for the best fare'] },
      { mode: 'train', duration: 1800, pros: ['Avoids flying'], cons: ['Overland loops down through Sweden — 24h+ with changes', 'Not realistic for this trip'] },
    ],
    note: 'Finland and Norway aren’t directly rail-linked; flying is standard.',
  },
  'bergen|helsinki': {
    best: 'flight', reason: 'the seasonal Finnair nonstop is the only sensible way across — it kicks off the Norway leg',
    options: [
      { mode: 'flight', duration: 150, pros: ['Finnair flies the nonstop in ~2h30, straight into fjord country at Bergen', 'Roughly 9 departures a week in summer'], cons: ['Finnair is the ONLY nonstop, and it’s seasonal (about Apr–Oct)', 'Off-season or sold out: connect via Oslo, Stockholm or Copenhagen on SAS/Norwegian (3–5h+)', 'Book early — limited frequency'] },
    ],
    note: 'No realistic rail/road link. In summer Finnair flies Helsinki→Bergen nonstop; otherwise connect through a hub. This flight starts the Norway-in-a-Nutshell run toward Oslo.',
  },
  'flam|oslo': osloFlamOptions,
  'bergen|flam': bergenFlamOptions,
  'aarhus|aero': aarhusAeroOptions,
  'aero|copenhagen': copenhagenAeroOptions,
  'aero|kalmar': kalmarAeroOptions,
  'kalmar|stockholm': kalmarStockholmOptions,
  'gothenburg|kalmar': {
    best: 'train', reason: 'southern Sweden is best handled by rail rather than airports',
    options: [
      { mode: 'train', duration: 240, pros: ['Comfortable regional/intercity rail', 'Avoids small-airport logistics'], cons: ['Often requires a change'] },
      { mode: 'car', duration: 300, pros: ['Flexible if you want countryside stops'], cons: ['Long drive for a simple city transfer'] },
      { mode: 'bus', duration: 360, pros: ['Usually cheapest'], cons: ['Slowest'] },
    ],
  },
  'gothenburg|malmo': {
    best: 'train', reason: 'the west-coast rail corridor is direct and simpler than flying',
    options: [
      { mode: 'train', duration: 180, pros: ['Direct city-center rail in roughly 3h', 'Frequent departures'], cons: ['Book ahead for the cheapest fare classes'] },
      { mode: 'car', duration: 180, pros: ['Useful for coastal detours'], cons: ['Parking at both ends'] },
      { mode: 'flight', duration: 160, pros: ['Fast in the air'], cons: ['Airport overhead usually cancels the gain'] },
    ],
  },
  'gothenburg|stockholm': {
    best: 'train', reason: 'this is one of Sweden’s core high-speed rail routes',
    options: [
      { mode: 'train', duration: 190, pros: ['Fast, frequent, city-center to city-center'], cons: ['Advance fares are cheaper'] },
      { mode: 'flight', duration: 150, pros: ['Fastest if you are already near an airport'], cons: ['Airport overhead makes rail easier for most travelers'] },
      { mode: 'car', duration: 300, pros: ['Flexible stops'], cons: ['Long motorway day'] },
    ],
  },
  'helsinki|tallinn': {
    best: 'ferry', reason: 'a ~2h crossing with departures all day',
    options: [
      { mode: 'ferry', duration: 150, pros: ['~2h across the Gulf of Finland', 'Many daily departures (Tallink/Viking/Eckerö)', 'Lands near both Old Towns'], cons: ['Summer weekend sailings sell out — book a few days ahead'] },
    ],
    note: 'It’s a short sea crossing; flying isn’t practical for this hop.',
  },
  'lofoten|tromso': {
    best: 'car', reason: 'the drive between the two Arctic stops is itself a top-tier scenic route',
    options: [
      { mode: 'car', duration: 420, pros: ['~6.5–7h along fjords and the E10 — one of Norway’s most scenic drives', 'Break it in Vesterålen or at Polar Park'], cons: ['Long Arctic distances with few services — fuel up', 'One-way rental drop-off fees between cities'] },
      { mode: 'flight', duration: 200, pros: ['Widerøe hops Svolvær–Tromsø (often via Bodø) in a few hours door-to-door'], cons: ['Small props, few seats — book early in July', 'Misses the drive, which is half the point up here'] },
      { mode: 'bus', duration: 540, pros: ['Cheapest; long-distance coaches link Svolvær–Narvik–Tromsø'], cons: ['All day with a change — 9h+', 'Sparse departures'] },
    ],
    note: 'No rail this far north — it’s the scenic drive or a prop flight.',
  },
  'kalmar|malmo': {
    best: 'train', reason: 'Kalmar and Malmö sit on the southern Sweden rail network',
    options: [
      { mode: 'train', duration: 210, pros: ['Straightforward regional/intercity rail', 'No airport hassle'], cons: ['May require a change'] },
      { mode: 'car', duration: 260, pros: ['Useful for countryside stops'], cons: ['Longer than the train for most travelers'] },
      { mode: 'bus', duration: 330, pros: ['Cheap'], cons: ['Slow'] },
    ],
  },
  'malmo|stockholm': {
    best: 'train', reason: 'this is a core Swedish rail route',
    options: [
      { mode: 'train', duration: 270, pros: ['High-speed rail, city-center to city-center'], cons: ['Book ahead for best pricing'] },
      { mode: 'flight', duration: 155, pros: ['Fastest if the timing is perfect'], cons: ['Airport transfers cut into the saving'] },
      { mode: 'car', duration: 390, pros: ['Flexible stops'], cons: ['Long drive and city parking'] },
    ],
  },
  'gothenburg|oslo': {
    best: 'train', reason: 'this is a practical cross-border rail/bus corridor',
    options: [
      { mode: 'train', duration: 240, pros: ['Comfortable city-center link', 'Avoids airport overhead'], cons: ['Not as fast as Sweden’s high-speed core'] },
      { mode: 'bus', duration: 220, pros: ['Often frequent and cheap'], cons: ['Less comfortable than rail'] },
      { mode: 'car', duration: 220, pros: ['Flexible coastal detours'], cons: ['Parking in both cities'] },
    ],
  },
  'malmo|oslo': {
    best: 'train', reason: 'rail via Gothenburg keeps this city-center and avoids flying',
    options: [
      { mode: 'train', duration: 420, pros: ['All-rail route via Gothenburg', 'No airport overhead'], cons: ['Long transfer day with a change'] },
      { mode: 'flight', duration: 170, pros: ['Fastest if schedules fit'], cons: ['Airport transfer at both ends'] },
      { mode: 'bus', duration: 480, pros: ['Usually cheap'], cons: ['Very long day'] },
    ],
  },
  'oslo|stockholm': {
    best: 'train', reason: 'this cross-border rail route is simpler than flying for city-center travel',
    options: [
      { mode: 'train', duration: 330, pros: ['City-center to city-center with no airport process', 'Comfortable cross-border ride'], cons: ['Not as fast as flying'] },
      { mode: 'flight', duration: 160, pros: ['Fastest in the air'], cons: ['Transfers and security narrow the gap'] },
      { mode: 'bus', duration: 450, pros: ['Cheap'], cons: ['Long and less comfortable'] },
    ],
  },
  'oslo|stavanger': {
    best: 'train', reason: 'the Sørlandet Line is long but direct, scenic, and avoids airport overhead',
    options: [
      { mode: 'train', duration: 480, pros: ['Direct rail across southern Norway', 'Scenic and city-center'], cons: ['Around 8h, so it consumes most of a day'] },
      { mode: 'flight', duration: 150, pros: ['Fastest by far'], cons: ['Airport overhead; less scenic'] },
      { mode: 'car', duration: 450, pros: ['Road-trip flexibility'], cons: ['Long drive'] },
    ],
  },
  'stockholm|tallinn': {
    best: 'overnight boat', reason: 'Tallink runs this Baltic overnight route',
    options: [
      { mode: 'overnight boat', duration: 1020, pros: ['Cabin replaces a hotel night', 'Classic Baltic crossing'], cons: ['Overnight and schedule-dependent', 'Book cabins ahead in summer'] },
      { mode: 'flight', duration: 150, pros: ['Fastest if you do not want an overnight sailing'], cons: ['Misses the Baltic approach'] },
    ],
    note: 'This is a sea crossing; overland rail is not practical.',
  },
  'munich|tallinn': {
    best: 'flight', reason: 'no practical overland option covers this distance',
    options: [
      { mode: 'flight', duration: 150, pros: ['~2h30 nonstop — airBaltic and Lufthansa both fly it, most days of the week'], cons: ['Not a scenic hop — book the earliest arrival to keep a full first day'] },
    ],
    note: 'This is the trip’s one long-haul jump — a clean flight closes the loop back to Central Europe.',
  },
};

function tromsoOptions(a, b) {
  return {
    best: 'flight', reason: `flying is the sensible way from ${a.name} to ${b.name}`,
    generic: false,
    options: [
      { mode: 'flight', duration: 150, pros: ['By far the fastest way to/from the Arctic', 'SAS, Norwegian and Widerøe all serve Tromsø'], cons: ['Book ahead; fares climb close to departure'] },
      { mode: 'car', duration: 1800, pros: ['An epic road trip in its own right'], cons: ['20h+ of driving each way', 'Only worth it if the drive IS the plan'] },
    ],
    note: `${a.name} → ${b.name} is a long-haul leg; air travel is standard.`,
  };
}

function aeroOptions(a, b) {
  const other = a.cityId === 'aero' ? b : a;
  const fromAero = a.cityId === 'aero';
  const d = Math.round(haversineKm(a, b));
  const mainlandRail = ['copenhagen', 'aarhus', 'kalmar', 'malmo', 'gothenburg', 'stockholm'];
  const best = other.country === 'Denmark' || mainlandRail.includes(other.cityId) ? 'train' : 'flight';
  const trainDuration = estimateDurationMin(d, 'train') + 75;
  const flightDuration = estimateDurationMin(d, 'flight') + 75;
  return {
    best,
    reason: best === 'train'
      ? (fromAero ? 'take the Ærø ferry to the mainland, then continue by rail' : 'travel by rail to Svendborg, then take the ferry onto Ærø')
      : (fromAero ? 'take the Ærø ferry to the mainland, then fly the long international leg' : 'fly the long international leg, then connect to the Ærø ferry'),
    generic: false,
    options: [
      { mode: best, duration: best === 'train' ? trainDuration : flightDuration, pros: [best === 'train' ? 'Keeps the journey car-free around the Ærø ferry' : 'Fastest for the long mainland/international portion'], cons: ['Requires coordinating the Ærø ferry'] },
      { mode: best === 'train' ? 'car' : 'train', duration: best === 'train' ? estimateDurationMin(d, 'car') + 75 : trainDuration, pros: [best === 'train' ? 'Convenient with luggage' : 'Avoids flying'], cons: [best === 'train' ? 'Reserve the car ferry and handle parking' : 'Very long around the ferry'] },
    ],
    note: 'All Ærø legs include a ferry to or from the island.',
  };
}

function geirangerOptions(a, b) {
  const other = a.cityId === 'geiranger' ? b : a;
  const toGeiranger = b.cityId === 'geiranger';
  if (other.cityId === 'bergen' || other.cityId === 'flam') {
    return {
      best: 'bus', reason: toGeiranger
        ? 'Geiranger is best reached overland via fjord buses plus the Hellesylt/Geiranger ferry'
        : 'leaving Geiranger works best overland via fjord buses plus the Hellesylt/Geiranger ferry',
      generic: false,
      options: [
        { mode: 'bus', duration: other.cityId === 'bergen' ? 570 : 360, pros: ['Public-transport route through fjord country', 'Includes scenic ferry/bus segments'], cons: ['Seasonal schedules and connections need checking'] },
        { mode: 'car', duration: other.cityId === 'bergen' ? 420 : 300, pros: ['Most flexible for viewpoints'], cons: ['Mountain roads and ferry timing'] },
        { mode: 'ferry', duration: 600, pros: ['Summer coastal/fjord sailings can be memorable'], cons: ['Seasonal and not always the fastest transfer'] },
      ],
    };
  }
  if (other.cityId === 'oslo') {
    return {
      best: 'train', reason: toGeiranger
        ? 'train toward Åndalsnes plus bus/ferry is the classic scenic public-transport approach into Geiranger'
        : 'bus/ferry toward Åndalsnes plus train is the classic scenic public-transport route out of Geiranger',
      generic: false,
      options: [
        { mode: 'train', duration: 480, pros: ['Scenic rail plus mountain/fjord bus connection'], cons: ['Seasonal bus legs; verify the exact day'] },
        { mode: 'flight', duration: 210, pros: ['Fastest via Ålesund when timing matters'], cons: [`Still needs ground transfer ${toGeiranger ? 'to' : 'from'} Geiranger`] },
        { mode: 'car', duration: 420, pros: ['Flexible mountain-route timing'], cons: ['Long drive with seasonal roads'] },
      ],
    };
  }
  return {
    best: 'flight', reason: toGeiranger
      ? 'Geiranger is remote; for non-nearby cities, fly via Ålesund/Oslo and connect by ground transport'
      : 'Geiranger is remote; for non-nearby cities, connect by ground transport and then fly via Ålesund/Oslo',
    generic: false,
    options: [
      { mode: 'flight', duration: 240, pros: ['Fastest for distant Nordic cities'], cons: [`Still requires a ground leg ${toGeiranger ? 'to' : 'from'} Geiranger`] },
      { mode: 'car', duration: estimateDurationMin(Math.round(haversineKm(a, b)), 'car'), pros: ['Full route flexibility'], cons: ['Very long from most cities'] },
      { mode: 'bus', duration: estimateDurationMin(Math.round(haversineKm(a, b)), 'bus'), pros: ['Avoids flying'], cons: ['Multiple transfers and a long day'] },
    ],
  };
}

function tallinnOptions(a, b) {
  return {
    best: 'flight', reason: `${a.name} to ${b.name} is too awkward overland; fly unless pairing Tallinn with Helsinki or Stockholm`,
    generic: false,
    options: [
      { mode: 'flight', duration: estimateDurationMin(Math.round(haversineKm(a, b)), 'flight'), pros: ['Fastest and simplest for this Baltic detour'], cons: ['Airport transfers at both ends'] },
      { mode: 'ferry', duration: estimateDurationMin(Math.round(haversineKm(a, b)), 'ferry'), pros: ['Possible as part of a longer Baltic ferry chain'], cons: ['Usually indirect and much slower'] },
    ],
  };
}

// Lofoten has no rail and no big airport: you fly to Svolvær/Leknes via Bodø
// (Widerøe props), fly to Harstad/Narvik Evenes and drive in along the E10,
// or take the Bodø–Moskenes car ferry. Anything from the south is a flight.
function lofotenOptions(a, b) {
  return {
    best: 'flight', reason: 'the archipelago is reached via Bodø — a prop flight to Svolvær/Leknes, or Evenes + the scenic E10 drive in',
    generic: false,
    options: [
      { mode: 'flight', duration: 300, pros: ['Via Bodø to Svolvær (SVJ)/Leknes (LKN) — Widerøe props with great views', 'Alternatively a jet to Harstad/Narvik Evenes (EVE), then a stunning ~2.5–3h drive in'], cons: ['Small planes sell out in July — book early', 'You’ll still want a car once you land'] },
      { mode: 'ferry', duration: 270, pros: ['The Bodø–Moskenes car ferry (~3.5h) sails straight into the dramatic west end', 'Brings your rental car across'], cons: ['Summer queues are real — reserve the ferry ahead', 'Only worth it if you’re already in Bodø with a car'] },
      { mode: 'car', duration: 480, pros: ['The E10 through Vesterålen/Lofoten is one of Norway’s great drives', 'A car is the way to explore the islands anyway'], cons: ['Long Arctic distances — only sensible from Tromsø/Narvik, not from the south'] },
    ],
    note: `${a.name}–${b.name}: there’s no rail link to Lofoten; plan around Bodø or Evenes.`,
  };
}

// ---- Distance-based fallback for custom/unknown legs ----------------------
function genericOptions(a, b) {
  const d = Math.round(haversineKm(a, b));
  const suggested = suggestTransport(a, b);
  let best = normalizeMode(suggested.mode);
  let reason = suggested.reason;

  // After the explicitly-known rail corridors above, long cross-country fjord /
  // Baltic combinations are usually flights rather than multi-transfer trains.
  if (a.country !== b.country && d > 450) {
    best = 'flight';
    reason = `it's ~${d} km across borders without a simple direct rail/boat route`;
  }

  // Pick a small, sensible set of modes to compare based on distance.
  let modes;
  if (best === 'overnight boat' || best === 'ferry' || best === 'express boat') {
    modes = [best, 'flight'];
  } else if (d > 600) {
    modes = ['flight', 'train'];
  } else if (d > 250) {
    modes = ['train', 'flight', 'bus', 'car'];
  } else {
    modes = ['train', 'bus', 'car'];
  }
  if (!modes.includes(best)) modes.unshift(best);

  const options = modes.map((mode) => ({
    mode,
    duration: estimateDurationMin(d, mode),
    pros: (MODE_TRAITS[mode] || {}).pros || [],
    cons: (MODE_TRAITS[mode] || {}).cons || [],
  }));

  return { best, reason, options, generic: true, distanceKm: d };
}

// Public: best option + ranked pros/cons for traveling from one stop to the
// next. Route-specific entries win over the Arctic special-cases so curated
// pairs (e.g. Lofoten–Tromsø) keep their tailored advice.
export function travelOptions(fromStop, toStop) {
  if (!fromStop || !toStop) return null;
  // Curated pair entries always win over the per-city special-cases, so
  // tailored combinations (Lofoten–Tromsø, the Ærø legs, …) keep their
  // specific advice; the city fallbacks catch every remaining combination.
  const key = pairKey(fromStop.cityId, toStop.cityId);
  if (ROUTE[key]) return { ...routeEntry(ROUTE[key], fromStop, toStop), generic: false };
  if (fromStop.cityId === 'tromso' || toStop.cityId === 'tromso') return tromsoOptions(fromStop, toStop);
  if (fromStop.cityId === 'lofoten' || toStop.cityId === 'lofoten') return lofotenOptions(fromStop, toStop);
  if (fromStop.cityId === 'aero' || toStop.cityId === 'aero') return aeroOptions(fromStop, toStop);
  if (fromStop.cityId === 'geiranger' || toStop.cityId === 'geiranger') return geirangerOptions(fromStop, toStop);
  if (fromStop.cityId === 'tallinn' || toStop.cityId === 'tallinn') return tallinnOptions(fromStop, toStop);
  return genericOptions(fromStop, toStop);
}

// Compact stored default for a leg. The compare/options panel keeps the full
// pros/cons list; this is just the selected connector value after route edits.
export function defaultTransportForLeg(fromStop, toStop) {
  const data = travelOptions(fromStop, toStop);
  if (!data) return null;
  const best = data.best || data.options?.[0]?.mode || '';
  if (!best) return null;
  const bestKey = normalizeMode(best);
  const option = (data.options || []).find((o) => normalizeMode(o.mode) === bestKey)
    || data.options?.[0] || null;
  return {
    mode: best,
    note: data.reason || data.note || '',
    durationMin: option?.duration ?? null,
  };
}

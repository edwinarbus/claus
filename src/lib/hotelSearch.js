// Hotel / stay lookup — a lodging-ranked view of the shared place search, so a
// picked stay carries a tidy address + coordinates for pinning on the day map.

import { searchPlaces } from './placeSearch.js';
import { matchKnownLodging } from '../data/knownPlaces.js';
import { haversineKm } from '../data/logistics.js';

// True for results that read as lodging — used to rank, not to hard-filter, so a
// boutique hotel / Airbnb / guesthouse that OSM tags oddly still shows up.
function isLodging(r) {
  const typ = (r.type || '').toLowerCase();
  const cls = (r.class || r.category || '').toLowerCase();
  if (cls === 'tourism' && ['hotel', 'hostel', 'motel', 'guest_house', 'apartment', 'chalet'].includes(typ)) return true;
  const n = (r.display_name || r.name || '').toLowerCase();
  return /\bhotel\b|\bhotell\b|\bhostel\b|\bvandrarhem\b|\blodge\b|\binn\b|\bresort\b/.test(n);
}

export async function searchHotels(query, city) {
  const known = matchKnownLodging(query, city);
  const hits = await searchPlaces(query, city, { rank: isLodging });
  if (!known) return hits;
  const rest = hits.filter((h) => haversineKm(h, known) > 0.08);
  return [known, ...rest].slice(0, 6);
}

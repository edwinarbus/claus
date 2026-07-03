// Curated coordinates for hotels and stays that Nominatim often ranks wrong
// (misspellings, suburban namesakes, etc.). Used by hotel search and one-time
// trip migrations so saved lodging pins land on the right door.

import { CITIES } from './catalog.js';

/** @typedef {{ cityId: string, match: RegExp, name: string, label: string, address: string, lat: number, lng: number }} KnownLodging */

/** @type {KnownLodging[]} */
export const KNOWN_LODGING = [
  {
    cityId: 'oslo',
    // Common typo "Sommero" + the real Sommerro name.
    match: /\bsommerro\b|\bsommero\b/i,
    name: 'Sommerro',
    label: 'Sommerrogata 1, Frogner',
    address: 'Sommerrogata 1, 0255 Oslo, Norway',
    lat: 59.9153612,
    lng: 10.7197725,
  },
];

function cityMatches(entry, city) {
  if (!city) return false;
  if (city.cityId && city.cityId === entry.cityId) return true;
  const catalogName = CITIES[entry.cityId]?.name;
  return !!(catalogName && city.name === catalogName);
}

export function matchKnownLodging(query, city) {
  const q = (query || '').trim();
  if (q.length < 2 || !city) return null;
  for (const entry of KNOWN_LODGING) {
    if (!cityMatches(entry, city)) continue;
    if (!entry.match.test(q)) continue;
    return {
      name: entry.name,
      label: entry.label,
      lat: entry.lat,
      lng: entry.lng,
      ranked: true,
      address: entry.address,
    };
  }
  return null;
}

// Fix a saved lodging item when we know the canonical pin for its name/city.
export function patchKnownLodgingItem(item, cityId) {
  if (!item || item.type !== 'lodging' || !item.name) return item;
  const city = { cityId, name: CITIES[cityId]?.name };
  const known = matchKnownLodging(item.name, city);
  if (!known) return item;
  return {
    ...item,
    name: known.name,
    lat: known.lat,
    lng: known.lng,
    address: known.address,
  };
}

// Generic place lookup via Nominatim (free, no API key). Returns named places
// with a tidy address + coordinates so a picked spot can be pinned exactly on
// the day map. Used for both lodging (hotels) and dining (restaurants).

import { haversineKm } from '../data/logistics.js';

const CC = { Denmark: 'dk', Sweden: 'se', Norway: 'no', Finland: 'fi', Estonia: 'ee' };

// Beyond this straight-line distance from the city center, a hit drops below the
// central matches. Nominatim sometimes ranks a far suburban same-name hotel
// (e.g. a "…Oslo Alna" conference center 7 km out) above the downtown one; this
// keeps the in-town options on top without ever hiding the farther result.
const FAR_FROM_CENTER_KM = 4;

// A short, human address from Nominatim's structured fields (falls back to the
// full display_name). Nordic order: street then number — "Vesterbrogade 12".
export function prettyAddress(r) {
  const a = r.address || {};
  const street = [a.road, a.house_number].filter(Boolean).join(' ');
  const area = a.suburb || a.neighbourhood || a.city_district || a.city || a.town || a.village || a.municipality || '';
  const parts = [street, area].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return (r.display_name || '').split(',').slice(0, 2).join(',').trim();
}

// Search "<query>, <city>". `rank` (optional) marks preferred results (e.g.
// lodging or restaurants); preferred ones are surfaced first, but if none match
// we still return the best name matches so nothing is silently dropped.
export async function searchPlaces(query, city, { rank, limit = 10 } = {}) {
  const q = (query || '').trim();
  if (q.length < 2 || !city?.name) return [];
  const cc = CC[city.country] ? `&countrycodes=${CC[city.country]}` : '';
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=${limit}&addressdetails=1${cc}`
    + `&q=${encodeURIComponent(`${q}, ${city.name}`)}`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return [];
    const arr = await res.json();
    if (!Array.isArray(arr)) return [];
    const mapped = arr
      .map((r) => ({
        name: r.name || (r.display_name || '').split(',')[0],
        label: prettyAddress(r),
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        ranked: rank ? !!rank(r) : true,
      }))
      .filter((h) => h.name && Number.isFinite(h.lat) && Number.isFinite(h.lng));
    const top = mapped.filter((h) => h.ranked);
    const chosen = top.length ? top : mapped;
    // Keep central hits on top when we know the city center, preserving the
    // upstream relevance order within the near/far groups (stable sort).
    const center = city && typeof city.lat === 'number' && typeof city.lng === 'number' ? city : null;
    const ordered = center
      ? chosen
        .map((h, i) => ({ h, i, far: haversineKm(h, center) > FAR_FROM_CENTER_KM ? 1 : 0 }))
        .sort((a, b) => (a.far - b.far) || (a.i - b.i))
        .map((x) => x.h)
      : chosen;
    return ordered.slice(0, 6);
  } catch {
    return [];
  }
}

// True for results that read as somewhere you'd eat or drink — used to rank.
export function isRestaurant(r) {
  const typ = (r.type || '').toLowerCase();
  const cls = (r.class || r.category || '').toLowerCase();
  if (cls === 'amenity' && ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'bakery', 'ice_cream', 'food_court', 'biergarten'].includes(typ)) return true;
  if (cls === 'shop' && ['bakery', 'pastry', 'deli', 'confectionery', 'coffee', 'chocolate'].includes(typ)) return true;
  const n = (r.display_name || r.name || '').toLowerCase();
  return /\brestaurant\b|\brestaurang\b|\bcaf[eé]\b|\bbar\b|\bbistro\b|\bbrasserie\b|\bpub\b|\bkitchen\b|\beatery\b|\bbakery\b|\bbageri\b|\bkonditori\b/.test(n);
}

export async function searchRestaurants(query, city) {
  return searchPlaces(query, city, { rank: isRestaurant });
}

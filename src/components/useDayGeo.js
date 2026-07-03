// Resolve approximate coordinates for planned items so we can map a single day.
// Items carry no coordinates, so we resolve them from, in order:
//   1. an explicit lat/lng on the item (if ever added),
//   2. the Wikipedia article's own coordinates (accurate for real places),
//   3. an OpenStreetMap (Nominatim) lookup of "<name>, <city>", accepted only
//      if it lands within 25 km of the city center (guards against bad matches).
// Food items skip name geocoding (a dish name geocodes to nonsense). Anything
// that still can't be located precisely gets a best-guess pin at the city
// center, flagged { approx: true } so the map can show it honestly rather than
// dropping it. Everything is cached.

import { useState, useEffect } from '../html.js';
import { haversineKm } from '../data/logistics.js';

const GEO_KEY = 'claus-demo:geo:v3';
const CC = { Denmark: 'dk', Sweden: 'se', Norway: 'no', Finland: 'fi', Estonia: 'ee' };

let mem = null;
// De-dupe concurrent lookups: many day maps can request the same item at once.
const inflight = {};
function cache() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(GEO_KEY) || '{}'); } catch { mem = {}; }
  return mem;
}
function persist() {
  try { localStorage.setItem(GEO_KEY, JSON.stringify(mem || {})); } catch { /* ignore */ }
}

async function wikiCoords(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  // 404 = no such article (deterministic). Let the caller fall back to a name
  // lookup instead of treating it as a transient error.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  const j = await res.json();
  if (j && j.coordinates && typeof j.coordinates.lat === 'number') {
    return { lat: j.coordinates.lat, lng: j.coordinates.lon };
  }
  return null;
}

async function nominatimCoords(name, city) {
  const cc = CC[city.country] ? `&countrycodes=${CC[city.country]}` : '';
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1${cc}`
    + `&q=${encodeURIComponent(`${name}, ${city.name}`)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const arr = await res.json();
  if (Array.isArray(arr) && arr.length) {
    const lat = parseFloat(arr[0].lat);
    const lng = parseFloat(arr[0].lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)
      && haversineKm({ lat, lng }, { lat: city.lat, lng: city.lng }) <= 25) {
      return { lat, lng };
    }
  }
  return null;
}

export async function resolveItemCoords(item, city) {
  if (item && typeof item.lat === 'number' && typeof item.lng === 'number') {
    return { lat: item.lat, lng: item.lng };
  }
  const c = cache();
  // A delicacy can name the restaurant where to get it (item.venue) — geocode
  // THAT real place, not the dish. pinByName items are themselves a chosen
  // restaurant, so resolve by name. Either overrides any leftover dish wiki.
  const venue = item.type === 'eat' ? (item.venue || '').trim() : '';
  const geoName = venue || item.name;
  const useWiki = !!item.wiki && !item.pinByName && !venue;
  const key = useWiki
    ? `w:${item.wiki}`
    : `n:${city.id}:${(geoName || '').toLowerCase()}`;
  // Cached value is either a real {lat,lng} or a *deterministic* null (the place
  // genuinely has no findable location). Transient failures are never cached,
  // so they retry on the next view instead of being stuck null forever.
  if (key in c) return c[key];
  if (inflight[key]) return inflight[key];

  inflight[key] = (async () => {
    let coords = null;
    let transient = false; // network error / rate-limit — don't poison the cache
    try {
      if (useWiki) coords = await wikiCoords(item.wiki);
      // Name geocoding for non-food items (dish names geocode badly), and for
      // dining items pinned to a specific restaurant — either the item itself
      // (pinByName) or the venue where to get a delicacy (geoName = venue).
      if (!coords && geoName && (item.type !== 'eat' || item.pinByName || venue)) {
        coords = await nominatimCoords(geoName, city);
      }
    } catch {
      transient = true;
      coords = null;
    }
    // Deterministic miss → drop a best-guess pin at the city center, flagged
    // approximate. Transient errors stay null so they retry on the next view.
    if (!coords && !transient && city && typeof city.lat === 'number' && typeof city.lng === 'number') {
      coords = { lat: city.lat, lng: city.lng, approx: true };
    }
    if (coords || !transient) { c[key] = coords; persist(); }
    delete inflight[key];
    return coords;
  })();
  return inflight[key];
}

// Resolve a list of planned points to { [id]: {lat,lng}|null }. Sequential, so
// we stay polite to the geocoders; results stream in as they resolve.
export function useDayGeo(points, city) {
  const [coords, setCoords] = useState({});
  // Re-resolve when a point's geocode-affecting fields change (e.g. a dining
  // item renamed to a specific restaurant), not just when the id set changes.
  const key = `${city ? city.id : ''}|${points
    .map((p) => `${p.id}:${p.pinByName ? 'p' : ''}:${p.lat ?? ''},${p.lng ?? ''}:${(p.venue || '')}:${(p.address || '')}:${p.wiki || ''}:${(p.name || '').toLowerCase()}`)
    .join(',')}`;

  useEffect(() => {
    if (!city || !points.length) { setCoords({}); return undefined; }
    let alive = true;
    (async () => {
      for (const p of points) {
        const c = await resolveItemCoords(p, city);
        if (!alive) return;
        setCoords((prev) => ({ ...prev, [p.id]: c }));
      }
    })();
    return () => { alive = false; };
  }, [key]);

  return coords;
}

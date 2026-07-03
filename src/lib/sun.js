// Local sunrise/sunset math — no network, so it recomputes instantly whenever a
// day's date changes. Times are returned in the *destination's* timezone (what
// a traveler actually wants), via the standard sunrise equation + Intl.

const TZ_BY_COUNTRY = {
  Denmark: 'Europe/Copenhagen',
  Sweden: 'Europe/Stockholm',
  Norway: 'Europe/Oslo',
  Finland: 'Europe/Helsinki',
  Estonia: 'Europe/Tallinn',
};

// 12-hour clock without the AM/PM suffix (sunrise is always morning, sunset
// always evening, so the meridiem is implied).
function fmtInTz(date, tz) {
  const opts = { hour: 'numeric', minute: '2-digit', hour12: true };
  let s;
  try {
    s = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }).format(date);
  } catch {
    s = new Intl.DateTimeFormat('en-US', opts).format(date);
  }
  return s.replace(/\s*[AP]M$/i, '').trim();
}

// Standard sunrise equation. Returns UTC Date instants for sunrise/sunset, or a
// { polar } flag at high latitudes (midnight sun / polar night).
function sunInstantsUTC(dateStr, lat, lng) {
  const rad = Math.PI / 180;
  const dayMs = 86400000;
  const base = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;

  const jdate = base.getTime() / dayMs + 2440587.5;
  const n = Math.round(jdate - 2451545.0 + 0.0008);
  const Jstar = n - lng / 360;
  const M = (357.5291 + 0.98560028 * Jstar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 282.9372) % 360;
  const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const sinDelta = Math.sin(lambda * rad) * Math.sin(23.44 * rad);
  const cosDelta = Math.cos(Math.asin(sinDelta));
  const cosOmega = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDelta) / (Math.cos(lat * rad) * cosDelta);
  if (cosOmega >= 1) return { polar: 'night' }; // sun never rises
  if (cosOmega <= -1) return { polar: 'day' }; // sun never sets (midnight sun)

  const omega = Math.acos(cosOmega) / rad;
  const Jrise = Jtransit - omega / 360;
  const Jset = Jtransit + omega / 360;
  return {
    sunrise: new Date((Jrise - 2440587.5) * dayMs),
    sunset: new Date((Jset - 2440587.5) * dayMs),
  };
}

const cache = new Map();

export function sunTimesForDay(dateStr, lat, lng, country) {
  if (!dateStr || typeof lat !== 'number' || typeof lng !== 'number') return null;
  const key = `${dateStr}|${lat.toFixed(3)}|${lng.toFixed(3)}|${country || ''}`;
  if (cache.has(key)) return cache.get(key);

  const inst = sunInstantsUTC(dateStr, lat, lng);
  let result;
  if (!inst) result = null;
  else if (inst.polar) result = { polar: inst.polar };
  else {
    const tz = TZ_BY_COUNTRY[country];
    result = { sunrise: fmtInTz(inst.sunrise, tz), sunset: fmtInTz(inst.sunset, tz), polar: null };
  }
  cache.set(key, result);
  return result;
}

// The little right-aligned chip for the Morning (sunrise) and Evening (sunset)
// slot headers. Returns null for every other slot.
export function sunChipForSlot(slotKey, stop, dateStr) {
  if (slotKey !== 'morning' && slotKey !== 'evening') return null;
  if (!stop || typeof stop.lat !== 'number' || typeof stop.lng !== 'number') return null;
  const sun = sunTimesForDay(dateStr, stop.lat, stop.lng, stop.country);
  if (!sun) return null;

  if (slotKey === 'morning') {
    if (sun.polar === 'day') return { dir: 'up', text: 'midnight sun', title: 'Midnight sun — the sun stays up all night' };
    if (sun.polar === 'night') return { dir: 'up', text: 'polar night', title: 'Polar night — the sun barely rises' };
    return { dir: 'up', text: sun.sunrise, title: `Sunrise at ${sun.sunrise} (local)` };
  }
  if (sun.polar === 'day') return { dir: 'down', text: 'no sunset', title: 'Midnight sun — the sun never sets' };
  if (sun.polar === 'night') return { dir: 'down', text: 'no sunset', title: 'Polar night — the sun barely rises' };
  return { dir: 'down', text: sun.sunset, title: `Sunset at ${sun.sunset} (local)` };
}

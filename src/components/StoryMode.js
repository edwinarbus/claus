import { html, useState, useRef, useEffect } from '../html.js';
import { flagDiscSvg, hasFlag } from './FlagGlyph.js';
import { stopColor } from '../data/palette.js';
import { resolveTransport, formatDuration } from '../data/logistics.js';
import { transportGlyphSvg } from './TransportGlyph.js';
import { nightsBetween, formatRange } from '../lib/dates.js';
import { IconX } from './icons.js';

// ── Cinematic trip flyover (satellite + 3D terrain) ─────────────────────────
// A full-screen 3D replay of the itinerary, tuned for trip *planning*:
//  · flights arc up through the sky; trains/buses/cars hug the ground and follow
//    real roads; ferries/boats run straight across the water.
//  · the camera eases over each city, then turns toward the next leg while paused.
//  · everything (satellite, terrain, road tiles) is pre-warmed before playback,
//    so the fly-through runs from cache with no streaming hitch.
//  · pause to drag / zoom / rotate; play snaps back to the track.

const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js';
const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css';

const ESRI_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_REF = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const TERRAIN_DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const ESRI_ATTRIB = 'Imagery © Esri, Maxar, Earthstar Geographics · Elevation: AWS Terrain Tiles / Tilezen';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

const ROUTE = '#5fa86a';
const ROUTE_TRANSPARENT = 'rgba(95, 168, 106, 0)';
const ROUTE_CASING = '#2a1000';
const ROUTE_CASING_TRANSPARENT = 'rgba(42, 16, 0, 0)';
const KM_PER_MI = 1.609344;

const FLYOVER_LOADING_TERMS = [
  'Buttering the smørrebrød',
  'Warming up the sauna',
  'Pouring the day’s first coffee',
  'Waking the fjords',
  'Untangling the ferry lanes',
  'Counting archipelago islands',
  'Chasing the midnight sun',
  'Proofing the cinnamon buns',
  'Charting the rail north',
  'Coaxing out the northern lights',
];

function loadingTerm(progress) {
  const idx = clamp(Math.floor(clamp(progress, 0, 0.999) * FLYOVER_LOADING_TERMS.length), 0, FLYOVER_LOADING_TERMS.length - 1);
  return FLYOVER_LOADING_TERMS[idx];
}

// Scenic via-waypoints for land legs that need specific routing. Keyed as
// "fromCityId|toCityId"; coords are [lng, lat].
const LEG_VIA_WAYPOINTS = {};

// Smooth sea-route control points. Keyed as "fromCityId|toCityId"; coords are
// [lng, lat]. These are control handles, not hard corners.
const SEA_ROUTE_CONTROLS = {
  // Fast ferries leave Helsinki through the western harbor channels, then run
  // into open Gulf water before bending back toward Tallinn.
  'helsinki|tallinn': [[24.58, 60.02], [24.46, 59.66]],
  'tallinn|helsinki': [[24.46, 59.66], [24.58, 60.02]],
};

let maplibrePromise = null;
function loadMaplibre() {
  if (typeof window !== 'undefined' && window.maplibregl) return Promise.resolve(window.maplibregl);
  if (maplibrePromise) return maplibrePromise;
  maplibrePromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = MAPLIBRE_CSS;
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = MAPLIBRE_JS; s.async = true;
    s.onload = () => (window.maplibregl ? resolve(window.maplibregl) : reject(new Error('maplibre_missing')));
    s.onerror = () => { maplibrePromise = null; reject(new Error('maplibre_load_failed')); };
    document.head.appendChild(s);
  });
  return maplibrePromise;
}

// ── Geometry helpers ─────────────────────────────────────────────────────────
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const easeOutQuart = (t) => 1 - ((1 - clamp(t, 0, 1)) ** 4);
const easeOutCubic = (t) => 1 - ((1 - clamp(t, 0, 1)) ** 3);
const travelEase = (t) => {
  const x = clamp(t, 0, 1);
  const p = 3.7;
  return x < 0.5
    ? 0.5 * ((2 * x) ** p)
    : 1 - (0.5 * ((2 * (1 - x)) ** p));
};
const isFlightMode = (m) => /flight|fly|plane|air/.test(String(m || '').toLowerCase());
const titleCase = (s) => String(s || 'Travel').replace(/\b\w/g, (c) => c.toUpperCase());

function legKind(mode) {
  const m = String(mode || '').toLowerCase();
  if (isFlightMode(m)) return 'air';
  if (/ferry|boat|cruise|sail|overnight|hydro|express/.test(m)) return 'sea';
  return 'land';
}

function haversineKm(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function slerp(a, b, t) {
  const f1 = toRad(a[1]); const l1 = toRad(a[0]);
  const f2 = toRad(b[1]); const l2 = toRad(b[0]);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin((l2 - l1) / 2) ** 2,
  ));
  if (!d) return [a[0], a[1]];
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
  const y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
  const z = A * Math.sin(f1) + B * Math.sin(f2);
  return [toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.hypot(x, y)))];
}

function bearing(a, b) {
  const f1 = toRad(a[1]); const f2 = toRad(b[1]); const dl = toRad(b[0] - a[0]);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function destPoint([lng, lat], brDeg, distKm) {
  const R = 6371; const d = distKm / R; const br = toRad(brDeg);
  const la1 = toRad(lat); const lo1 = toRad(lng);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [toDeg(lo2), toDeg(la2)];
}

function lerpAngle(a, b, t) {
  const diff = ((b - a + 540) % 360) - 180;
  return (a + diff * t + 360) % 360;
}

function densify(a, b, n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(slerp(a, b, i / n));
  return out;
}

function bowedArc(a, b, n, bowKm) {
  const perp = (bearing(a, b) - 90 + 360) % 360;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const base = slerp(a, b, t);
    const off = bowKm * Math.sin(Math.PI * t);
    out.push(off > 0.01 ? destPoint(base, perp, off) : base);
  }
  return out;
}

function cubicBezierPath(a, c1, c2, b, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      (u ** 3) * a[0] + 3 * (u ** 2) * t * c1[0] + 3 * u * (t ** 2) * c2[0] + (t ** 3) * b[0],
      (u ** 3) * a[1] + 3 * (u ** 2) * t * c1[1] + 3 * u * (t ** 2) * c2[1] + (t ** 3) * b[1],
    ]);
  }
  return out;
}

function resample(coords, n) {
  if (!coords || coords.length < 2) return coords || [];
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineKm(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1];
  if (!total) return [coords[0], coords[coords.length - 1]];
  const out = []; let j = 0;
  for (let k = 0; k <= n; k++) {
    const d = (k / n) * total;
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = clamp((d - cum[j]) / seg, 0, 1);
    out.push([lerp(coords[j][0], coords[j + 1][0], f), lerp(coords[j][1], coords[j + 1][1], f)]);
  }
  return out;
}

function pathThrough(points, n) {
  if (!points || points.length < 2) return points || [];
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const km = haversineKm(points[i], points[i + 1]);
    const totalKm = points.reduce((sum, p, idx) => (idx ? sum + haversineKm(points[idx - 1], p) : sum), 0) || km;
    const segN = Math.max(3, Math.round(n * (km / totalKm)));
    const seg = densify(points[i], points[i + 1], segN);
    out.push(...(i ? seg.slice(1) : seg));
  }
  return out;
}

function smoothPath(coords, passes = 2) {
  if (!coords || coords.length < 4) return coords || [];
  let cur = coords;
  for (let p = 0; p < passes; p++) {
    const next = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      next.push([
        cur[i - 1][0] * 0.22 + cur[i][0] * 0.56 + cur[i + 1][0] * 0.22,
        cur[i - 1][1] * 0.22 + cur[i][1] * 0.56 + cur[i + 1][1] * 0.22,
      ]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

const pathMetricsCache = new WeakMap();
function pathMetrics(path) {
  if (!path || path.length < 2) return { cum: [0], total: 0 };
  const cached = pathMetricsCache.get(path);
  if (cached) return cached;
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + haversineKm(path[i - 1], path[i]));
  }
  const metrics = { cum, total: cum[cum.length - 1] || 0 };
  pathMetricsCache.set(path, metrics);
  return metrics;
}

function pathAt(path, frac) {
  if (!path || path.length < 2) return path?.[0] || [0, 0];
  const { cum, total } = pathMetrics(path);
  if (!total) return path[0];
  const d = clamp(frac, 0, 1) * total;
  let lo = 0;
  while (lo < cum.length - 2 && cum[lo + 1] < d) lo++;
  const hi = Math.min(path.length - 1, lo + 1);
  const seg = cum[hi] - cum[lo] || 1;
  const f = clamp((d - cum[lo]) / seg, 0, 1);
  return [lerp(path[lo][0], path[hi][0], f), lerp(path[lo][1], path[hi][1], f)];
}

function headingSpan(kind) {
  return kind === 'land' ? 0.075 : 0.04;
}

function pathBearingAt(path, frac, span = 0.04) {
  return bearing(pathAt(path, frac - span), pathAt(path, frac + span));
}

function mapRelativeBearing(map, path, frac, span) {
  if (!path || path.length < 2) return null;
  try {
    const routeBearing = pathBearingAt(path, frac, span);
    const mapBearing = map && typeof map.getBearing === 'function' ? map.getBearing() : 0;
    return (routeBearing - mapBearing + 360) % 360;
  } catch { return null; }
}

const lineFeature = (coordinates) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates } });

function progressGradient(color, transparentColor, progress, active) {
  if (!active) {
    return ['interpolate', ['linear'], ['line-progress'], 0, transparentColor, 1, transparentColor];
  }
  const cut = clamp(progress, 0.0001, 0.9999);
  const fadeEnd = Math.min(0.99995, cut + 0.00005);
  return [
    'interpolate', ['linear'], ['line-progress'],
    0, color,
    cut, color,
    fadeEnd, transparentColor,
    1, transparentColor,
  ];
}

function progressUnderDot(map, path, progress, px) {
  if (!map || !path || path.length < 2 || !px || progress >= 1) return progress;
  try {
    const from = map.project(pathAt(path, progress));
    let lo = clamp(progress, 0, 1);
    let hi = Math.min(1, lo + 0.08);
    while (hi < 1) {
      const p = map.project(pathAt(path, hi));
      if (Math.hypot(p.x - from.x, p.y - from.y) >= px) break;
      hi = Math.min(1, hi + 0.08);
    }
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const p = map.project(pathAt(path, mid));
      if (Math.hypot(p.x - from.x, p.y - from.y) < px) lo = mid;
      else hi = mid;
    }
    return hi;
  } catch {
    return progress;
  }
}

// ── Camera / timing tuning ───────────────────────────────────────────────────
const INTRO_MS = 4200;
const DWELL_MS = 3000;
const OUTRO_MS = 5600;
const DWELL_ZOOM = 12.5; // city-in-context overview; zoom in while paused for street/3D detail
const DWELL_PITCH = 48;
const LIFT_PX = 54;
const ROUTE_HEAD_UNDER_DOT_PX = 8;
const TRAVEL_DOT_FADE_FRAC = 0.075;
const PREWARM_IDLE_MS = 180;
const FINAL_SETTLE_IDLE_MS = 900;
const PLAYBACK_RATE = 0.85;

function legDurationMs(km) { return clamp(4600 + km * 3.2, 5000, 14000); }
function travelDotOpacity(t) {
  const fadeIn = easeOutCubic(clamp(t / TRAVEL_DOT_FADE_FRAC, 0, 1));
  const fadeOut = easeOutCubic(clamp((1 - t) / TRAVEL_DOT_FADE_FRAC, 0, 1));
  return Math.min(fadeIn, fadeOut);
}
function cruiseZoom(km, air) {
  return air
    ? clamp(12.4 - Math.log2(km + 10) * 1.15, 4.8, 10.2)
    : clamp(13.6 - Math.log2(km + 10) * 0.72, 9.2, 12.8);
}
// Ground legs look DOWN more (lower pitch) so steep terrain (fjords) can't get
// between the camera and the route; flights stay low-pitched for the horizon.
function travelPitch(zoom, air) {
  return air
    ? clamp(44 + (zoom - 5) * 3.2, 44, 64)
    : clamp(48 + (zoom - 9) * 4, 50, 64);
}

function buildTimeline(stops, legs) {
  const segs = [];
  let t = 0;
  const push = (s) => { segs.push({ ...s, start: t, end: t + s.dur }); t += s.dur; };
  push({ kind: 'intro', dur: INTRO_MS });
  for (let i = 0; i < stops.length; i++) {
    push({ kind: 'dwell', stop: i, dur: DWELL_MS });
    if (i < stops.length - 1) push({ kind: 'travel', leg: i, dur: legs[i].dur });
  }
  push({ kind: 'outro', dur: OUTRO_MS });
  return { segs, total: t };
}

function segmentAt(segs, t) {
  for (let i = 0; i < segs.length; i++) {
    if (t < segs[i].end || i === segs.length - 1) {
      const s = segs[i];
      return { seg: s, lf: clamp((t - s.start) / s.dur, 0, 1) };
    }
  }
  return { seg: segs[0], lf: 0 };
}

export function StoryMode({ stops = [], onClose }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const moverRef = useRef(null);
  const moverLiftRef = useRef(null);
  const moverDiscRef = useRef(null);
  const moverShadowRef = useRef(null);
  const moverMarkerRef = useRef(null);
  const markersRef = useRef([]);
  const stopMarkerObjsRef = useRef([]);
  const rafRef = useRef(0);
  const roRef = useRef(null);

  const eyebrowRef = useRef(null);
  const titleRef = useRef(null);
  const subRef = useRef(null);
  const fillRef = useRef(null);
  const thumbRef = useRef(null);
  const trackRef = useRef(null);

  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState(() => loadingTerm(0));
  const [playing, setPlaying] = useState(true);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeed] = useState(1);

  const tRef = useRef(0);
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const scrubRef = useRef(false);
  const seekRef = useRef(true);
  const camRef = useRef({ zoom: 3, pitch: 12, bearing: 0 });
  const lastLegDrawnRef = useRef(-1);
  const lastHeadLegRef = useRef(-1);
  const lastHeadProgressRef = useRef('');
  const overviewRef = useRef(null);
  const lastStopRef = useRef(-1);
  const replayFromRef = useRef(null);

  const legsRef = useRef([]);
  const cumKmRef = useRef([0]);
  const prefixCoordsRef = useRef([[]]);
  const timelineRef = useRef({ segs: [], total: 1 });

  const pts = stops.map((s) => [s.lng, s.lat]);
  const enoughStops = stops.length >= 2 && pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const totalNights = enoughStops ? nightsBetween(stops[0].startDate, stops[stops.length - 1].endDate) : 0;
  const sig = stops.map((s) => `${s.lng},${s.lat},${s.startDate},${s.endDate},${s.name}`).join('|');

  function legBearings(p, kind) {
    const span = headingSpan(kind);
    return { startBearing: pathBearingAt(p, 0, span), endBearing: pathBearingAt(p, 1, span) };
  }

  useEffect(() => {
    if (!enoughStops) return;
    const legs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const km = haversineKm(pts[i], pts[i + 1]);
      const n = clamp(Math.round(km / 12), 28, 220);
      const t = resolveTransport(stops[i], stops[i + 1]) || {};
      const kind = legKind(t.mode);
      const legKey = stops[i].cityId && stops[i + 1]?.cityId ? `${stops[i].cityId}|${stops[i + 1].cityId}` : '';
      const viaPoints = LEG_VIA_WAYPOINTS[legKey] || stops[i].transportToNext?.viaPoints || [];
      const seaControls = SEA_ROUTE_CONTROLS[legKey];
      let path;
      if (kind === 'air') {
        path = bowedArc(pts[i], pts[i + 1], n, clamp(km * 0.13, 8, 150));
      } else if (kind === 'sea' && seaControls?.length === 2) {
        path = cubicBezierPath(pts[i], seaControls[0], seaControls[1], pts[i + 1], n);
      } else if (kind === 'sea' && viaPoints.length) {
        path = smoothPath(pathThrough([pts[i], ...viaPoints, pts[i + 1]], n), 4);
      } else {
        path = densify(pts[i], pts[i + 1], n);
      }
      legs.push({ km, miles: km / KM_PER_MI, mode: t.mode || 'travel', kind, durationMin: t.durationMin, path, dur: legDurationMs(km), viaPoints, ...legBearings(path, kind) });
    }
    legsRef.current = legs;
    rebuildDerived(legs);
  }, [sig]);

  function rebuildDerived(legs) {
    const cum = [0]; const prefix = [[]];
    for (let i = 0; i < legs.length; i++) { cum.push(cum[i] + legs[i].km); prefix.push(prefix[i].concat(legs[i].path)); }
    cumKmRef.current = cum;
    prefixCoordsRef.current = prefix;
    timelineRef.current = buildTimeline(stops, legs);
  }

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // The bright route is split so we don't re-upload a huge polyline each frame:
  //  · trail = all completed legs (set only when the leg index changes)
  //  · head  = the current leg up to `frac` (small, set per frame)
  function trailData(leg) {
    const legs = legsRef.current;
    const pc = prefixCoordsRef.current[Math.min(leg, legs.length)] || [];
    return pc.length ? pc : [pts[0]];
  }
  function headData(leg) {
    const legs = legsRef.current;
    if (leg >= legs.length) { const c = pts[Math.min(leg, legs.length)]; return [c, c]; }
    const path = legs[leg].path;
    return path.length >= 2 ? path : [pts[leg], pts[leg]];
  }

  function setHeadProgress(map, progress, active) {
    const key = `${active ? 1 : 0}:${clamp(progress, 0, 1).toFixed(4)}`;
    if (key === lastHeadProgressRef.current) return;
    lastHeadProgressRef.current = key;
    map.setPaintProperty('route-head-glow', 'line-gradient', progressGradient(ROUTE, ROUTE_TRANSPARENT, progress, active));
    map.setPaintProperty('route-head-casing', 'line-gradient', progressGradient(ROUTE_CASING, ROUTE_CASING_TRANSPARENT, progress, active));
    map.setPaintProperty('route-head-line', 'line-gradient', progressGradient(ROUTE, ROUTE_TRANSPARENT, progress, active));
  }

  function highlightMarker(i) {
    if (i === lastStopRef.current) return;
    lastStopRef.current = i;
    markersRef.current.forEach((m, idx) => { if (m) m.classList.toggle('is-active', idx === i); });
  }

  function setText(el, val) { if (el && el.__v !== val) { el.textContent = val; el.__v = val; } }

  function setInteractive(on) {
    const m = mapRef.current; if (!m) return;
    ['scrollZoom', 'boxZoom', 'dragRotate', 'dragPan', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'touchPitch']
      .forEach((h) => { try { if (m[h]) (on ? m[h].enable() : m[h].disable()); } catch { /* noop */ } });
  }

  useEffect(() => {
    if (!enoughStops) { setStatus('error'); return undefined; }
    let map = null;
    let disposed = false;
    let started = false;
    const updateLoading = (progress) => {
      const p = clamp(progress, 0, 1);
      setLoadingProgress(p);
      setLoadingMessage(loadingTerm(p));
    };

    setStatus('loading');
    updateLoading(0);

    const loadTimer = setTimeout(() => loadMaplibre().then((maplibregl) => {
      if (disposed || !containerRef.current) return;
      updateLoading(0.04);
      map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            sat: { type: 'raster', tiles: [ESRI_SAT], tileSize: 256, maxzoom: 19, attribution: ESRI_ATTRIB },
            ref: { type: 'raster', tiles: [ESRI_REF], tileSize: 256, maxzoom: 19 },
            dem: { type: 'raster-dem', tiles: [TERRAIN_DEM], tileSize: 256, encoding: 'terrarium', maxzoom: 15 },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': '#0b1722' } },
            { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 0 } },
            { id: 'ref', type: 'raster', source: 'ref', paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 1, 12.5, 0.5, 13.5, 0.16], 'raster-fade-duration': 0 } },
          ],
        },
        center: pts[0], zoom: 5, pitch: 12, bearing: 0,
        maxPitch: 85,
        maxTileCacheSize: 6000, // keep pre-warmed tiles resident through playback
        maxTileCacheZoomLevels: 8,
        attributionControl: false,
        interactive: true,
        antialias: true,
      });
      mapRef.current = map;
      setInteractive(false);
      updateLoading(0.08);

      try {
        const ro = new ResizeObserver(() => {
          if (!mapRef.current) return;
          try { map.resize(); } catch { /* noop */ }
          recomputeOverview();
        });
        ro.observe(containerRef.current);
        roRef.current = ro;
      } catch { /* no ResizeObserver */ }

      let terrainOn = false;
      map.on('error', (e) => {
        if (e && e.sourceId === 'dem' && terrainOn) { try { map.setTerrain(null); } catch { /* noop */ } terrainOn = false; }
      });

      // Manual Web-Mercator fit for all stops (cameraForBounds is unreliable
      // with terrain on).
      function recomputeOverview() {
        const cont = map.getContainer();
        const w = Math.max(80, cont.clientWidth - 96);
        const h = Math.max(80, cont.clientHeight - 300);
        let minLng = 180; let maxLng = -180; let minLat = 90; let maxLat = -90;
        pts.forEach(([lng, lat]) => {
          if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        });
        const mercY = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
        const lngFrac = Math.max(1e-6, (maxLng - minLng) / 360);
        const latFrac = Math.max(1e-6, Math.abs(mercY(maxLat) - mercY(minLat)));
        const zoom = clamp(Math.min(Math.log2(w / (512 * lngFrac)), Math.log2(h / (512 * latFrac))) - 0.6, 2.4, 9);
        overviewRef.current = { center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2], zoom };
      }

      async function fetchLand(i) {
        const a = pts[i]; const b = pts[i + 1];
        const via = (legsRef.current[i].viaPoints || []).map(([lng, lat]) => `${lng},${lat}`);
        const coords = [a[0] + ',' + a[1], ...via, b[0] + ',' + b[1]].join(';');
        const url = `${OSRM}/${coords}?overview=full&geometries=geojson`;
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), via.length ? 7000 : 4500);
        try {
          const r = await fetch(url, { signal: ctrl.signal });
          clearTimeout(to);
          if (!r.ok) return;
          const j = await r.json();
          const c = j.routes && j.routes[0] && j.routes[0].geometry && j.routes[0].geometry.coordinates;
          if (!c || c.length < 2 || j.code !== 'Ok') return;
          const km = j.routes[0].distance ? j.routes[0].distance / 1000 : legsRef.current[i].km;
          // Land routes keep the OSRM shape, but with softer samples so the
          // flyover does not twitch through every road or rail bend.
          const n = clamp(Math.round(km / 3.8), 36, 360);
          const path = smoothPath(resample(c, n), km > 80 ? 3 : 2);
          const L = legsRef.current[i];
          L.path = path; L.km = km; L.miles = km / KM_PER_MI; L.dur = legDurationMs(km);
          Object.assign(L, legBearings(path, L.kind));
        } catch { clearTimeout(to); /* keep straight fallback */ }
      }

      // Resolve once the map has no more tiles to load (or a hard cap elapses).
      function waitIdle(cap) {
        return new Promise((res) => {
          let done = false;
          const fin = () => { if (!done) { done = true; try { map.off('idle', fin); } catch { /* noop */ } res(); } };
          map.once('idle', fin);
          setTimeout(fin, cap);
        });
      }

      // Step the hidden camera through stops + legs so satellite + terrain
      // tiles are fetched and cached before the show starts.
      async function prewarm(uptoFrac = 1, progressStart = 0.55, progressEnd = 0.94) {
        const total = timelineRef.current.total;
        const segs = timelineRef.current.segs;
        const samples = [0];
        segs.forEach((s) => {
          if (s.kind === 'intro') {
            samples.push(s.start + s.dur * 0.65);
          } else if (s.kind === 'dwell') {
            samples.push(s.start + s.dur * 0.25, s.start + s.dur * 0.82);
          } else if (s.kind === 'travel') {
            samples.push(
              s.start + s.dur * 0.16,
              s.start + s.dur * 0.38,
              s.start + s.dur * 0.62,
              s.start + s.dur * 0.86,
            );
          } else if (s.kind === 'outro') {
            samples.push(s.start + s.dur * 0.35, s.start + s.dur * 0.88);
          }
        });
        samples.sort((a, b) => a - b);
        const limit = total * uptoFrac;
        const warmSamples = samples.filter((sample) => sample <= limit);
        for (let i = 0; i < warmSamples.length; i++) {
          if (disposed) return;
          updateLoading(lerp(progressStart, progressEnd, i / Math.max(1, warmSamples.length)));
          const f = frameAt(warmSamples[i]);
          try { map.jumpTo({ center: f.center, zoom: f.zoom, pitch: f.pitch, bearing: f.bearing }); } catch { /* noop */ }
          await waitIdle(PREWARM_IDLE_MS);
        }
        updateLoading(progressEnd);
      }

      map.on('load', async () => {
        if (disposed) return;
        updateLoading(0.12);
        try { map.setProjection({ type: 'mercator' }); } catch { /* default mercator */ }
        // Offset the focal point upward so the moving dot sits centered in the
        // map area ABOVE the bottom dock (the only chrome now).
        try { map.setPadding({ top: 12, bottom: 132, left: 0, right: 0 }); } catch { /* noop */ }
        try {
          map.setSky({
            'sky-color': '#4c84c4', 'sky-horizon-blend': 0.6,
            'horizon-color': '#cfe2f5', 'horizon-fog-blend': 0.7,
            'fog-color': '#dcebfb', 'fog-ground-blend': 0.55,
            'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 4, 0.9, 11, 0.35, 14, 0.12],
          });
        } catch { /* optional */ }
        // Terrain exaggeration is 0 (flat) on purpose: DOM markers (city pins +
        // the moving dot) get clamped to the terrain surface, but the route line
        // rides flat — so over the one inland/elevated stop (Munich, ~520 m; every
        // other stop is coastal/sea-level) the pin and plane floated visibly above
        // the line at the camera tilt. Keeping the plane flat puts pins, plane, and
        // route on one level so they stay attached. The tilt, satellite imagery,
        // flight arcs, and 3D building extrusions still carry the depth.
        try { map.setTerrain({ source: 'dem', exaggeration: 0 }); terrainOn = true; } catch { /* noop */ }
        updateLoading(0.16);

        // 3D building extrusions over the satellite (keyless OpenFreeMap vector
        // tiles), faded in only at city zoom — adds real depth at each stop.
        try {
          map.addSource('ofm', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
          map.addLayer({
            id: 'buildings-3d', type: 'fill-extrusion', source: 'ofm', 'source-layer': 'building', minzoom: 13,
            paint: {
              'fill-extrusion-color': '#cfc7b6',
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 6],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
              'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.4, 0.82],
              'fill-extrusion-vertical-gradient': true,
            },
          });
        } catch { /* buildings optional */ }
        updateLoading(0.2);

        map.addSource('route-full', { type: 'geojson', data: lineFeature(legsRef.current.flatMap((l) => l.path)) });
        map.addSource('route-trail', { type: 'geojson', data: lineFeature([pts[0]]) });
        map.addSource('route-head', { type: 'geojson', lineMetrics: true, data: lineFeature([pts[0], pts[0]]) });
        // The full route sits under the bright trail/head. Ahead of the moving
        // dot it's the ONLY thing joining it to the next city, so it needs a dark
        // casing to stay legible over satellite — otherwise a faint white dash
        // vanishes and the dot looks detached from the pin it's flying toward.
        map.addLayer({ id: 'route-full-casing', type: 'line', source: 'route-full', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ROUTE_CASING, 'line-width': 4.5, 'line-opacity': 0.5, 'line-blur': 0.6 } });
        map.addLayer({ id: 'route-full', type: 'line', source: 'route-full', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 2.2, 'line-opacity': 0.72, 'line-dasharray': [1.6, 2.0] } });
        for (const src of ['route-trail', 'route-head']) {
          const isHead = src === 'route-head';
          map.addLayer({ id: `${src}-glow`, type: 'line', source: src, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { ...(isHead ? { 'line-gradient': progressGradient(ROUTE, ROUTE_TRANSPARENT, 0, false) } : { 'line-color': ROUTE }), 'line-width': 11, 'line-opacity': 0.4, 'line-blur': 6 } });
          map.addLayer({ id: `${src}-casing`, type: 'line', source: src, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { ...(isHead ? { 'line-gradient': progressGradient(ROUTE_CASING, ROUTE_CASING_TRANSPARENT, 0, false) } : { 'line-color': ROUTE_CASING }), 'line-width': 8, 'line-opacity': 0.55 } });
          map.addLayer({ id: `${src}-line`, type: 'line', source: src, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { ...(isHead ? { 'line-gradient': progressGradient(ROUTE, ROUTE_TRANSPARENT, 0, false) } : { 'line-color': ROUTE }), 'line-width': 4.5 } });
        }

        stops.forEach((s, i) => {
          const el = document.createElement('div');
          el.className = 'story-marker';
          const pin = hasFlag(s.country)
            ? `<span class="story-marker-disc">${flagDiscSvg(s.country, `fgd${i}`)}</span>`
            : `<span class="story-marker-disc story-marker-disc--plain" style="background:${stopColor(i).hex}"></span>`;
          el.innerHTML = pin + `<span class="story-marker-label">${s.name}</span>`;
          markersRef.current[i] = el;
          stopMarkerObjsRef.current[i] = new maplibregl.Marker({ element: el, anchor: 'center', subpixelPositioning: true }).setLngLat(pts[i]).addTo(map);
        });

        const mover = document.createElement('div');
        mover.className = 'flyover-mover-root';
        mover.style.opacity = '0';
        mover.innerHTML = '<span class="flyover-mover-shadow"></span>'
          + '<span class="flyover-mover-lift"><span class="flyover-mover"><span class="flyover-mover-glyph"></span></span></span>';
        moverRef.current = mover;
        moverShadowRef.current = mover.querySelector('.flyover-mover-shadow');
        moverLiftRef.current = mover.querySelector('.flyover-mover-lift');
        moverDiscRef.current = mover.querySelector('.flyover-mover-glyph');
        moverMarkerRef.current = new maplibregl.Marker({ element: mover, anchor: 'center', subpixelPositioning: true }).setLngLat(pts[0]).addTo(map);
        updateLoading(0.24);

        recomputeOverview();
        const ov = overviewRef.current || { center: pts[0], zoom: 4 };
        const introZoom = clamp(ov.zoom + 3.2, 6.5, 9);
        camRef.current = { zoom: introZoom, pitch: 12, bearing: 0 };

        // Preload buffer: real roads → refresh geometry → pre-warm every tile.
        const landJobs = legsRef.current.map((L, i) => (L.kind === 'land' ? fetchLand(i) : null)).filter(Boolean);
        if (landJobs.length) await Promise.race([Promise.allSettled(landJobs), new Promise((r) => setTimeout(r, 5000))]);
        if (disposed) return;
        updateLoading(0.3);
        rebuildDerived(legsRef.current);
        const full = map.getSource('route-full'); if (full) full.setData(lineFeature(legsRef.current.flatMap((l) => l.path)));

        // Warm the whole camera path before playback. It delays start a touch,
        // but avoids visible satellite/terrain tile loading during the trip.
        await prewarm(1, 0.3, 0.94);
        if (disposed) return;
        updateLoading(0.97);
        // Settle on the opening frame, fully loaded, then begin.
        try { map.jumpTo({ center: pts[0], zoom: introZoom, pitch: 12, bearing: 0 }); } catch { /* noop */ }
        await waitIdle(FINAL_SETTLE_IDLE_MS);
        if (disposed || started) return;
        started = true;
        lastLegDrawnRef.current = -1; lastHeadLegRef.current = -1; lastHeadProgressRef.current = '';
        updateLoading(1);
        setStatus('ready');
        setInteractive(false);
        startLoop();
      });
    }).catch(() => { if (!disposed) setStatus('error'); }), 320);

    function frameAt(t) {
      const { segs } = timelineRef.current;
      const { seg, lf } = segmentAt(segs, t);
      const ov = overviewRef.current || { center: pts[0], zoom: 4 };
      const legs = legsRef.current;
      const cum = cumKmRef.current;
      const last = pts.length - 1;
      const out = {
        center: pts[0], zoom: DWELL_ZOOM, pitch: DWELL_PITCH, bearing: 0,
        leg: 0, frac: 0, moverPos: null, moverMode: null, moverLift: 0, moverOpacity: 0, activeStop: 0,
        bearingFollow: 0.08, eyebrow: '', title: '', sub: '',
      };
      const tripTitle = `${stops[0].name} → ${stops[last].name}`;
      const tripSub = `${stops.length} stops · ${totalNights} ${totalNights === 1 ? 'night' : 'nights'}`;

      if (seg.kind === 'intro') {
        const e = easeInOut(lf);
        const introZoom = clamp(ov.zoom + 3.2, 6.5, 9);
        const replayFrom = replayFromRef.current;
        const centerE = replayFrom ? easeOutQuart(lf) : e;
        out.center = replayFrom
          ? [lerp(replayFrom.center[0], pts[0][0], centerE), lerp(replayFrom.center[1], pts[0][1], centerE)]
          : pts[0];
        out.zoom = replayFrom ? lerp(replayFrom.zoom, DWELL_ZOOM, e) : lerp(introZoom, DWELL_ZOOM, e);
        out.pitch = replayFrom ? lerp(replayFrom.pitch, DWELL_PITCH, e) : lerp(12, DWELL_PITCH, e);
        out.bearing = replayFrom ? lerpAngle(replayFrom.bearing, 0, e) : 0;
        out.activeStop = 0;
        out.eyebrow = 'Överflygning'; out.title = tripTitle; out.sub = tripSub;
      } else if (seg.kind === 'dwell') {
        const i = seg.stop;
        out.center = pts[i];
        out.zoom = DWELL_ZOOM;   // hold steady — no secondary zoom-in after arrival
        out.pitch = DWELL_PITCH;
        const nextBearing = i < legs.length ? legs[i].startBearing : 0;
        // Linear (constant angular velocity) for the whole dwell: any eased
        // curve finishes the turn early and then holds a dead-static frame
        // until the dwell timer runs out — a visible "pause" before travel
        // resumes. A straight lerp keeps the camera rotating at a steady
        // rate right up to the last frame, so there is no static moment at
        // either end — it flows straight into travel's own ease-in start.
        out.bearing = i < legs.length ? lerpAngle(0, nextBearing, lf) : 0;
        out.bearingFollow = 1;
        out.leg = i; out.activeStop = i;
        out.eyebrow = `Stop ${i + 1} of ${stops.length}`;
        out.title = stops[i].name;
        out.sub = `${formatRange(stops[i].startDate, stops[i].endDate)} · ${nightsBetween(stops[i].startDate, stops[i].endDate)} nights`;
      } else if (seg.kind === 'travel') {
        const i = seg.leg;
        const L = legs[i]; const air = L.kind === 'air';
        const e = travelEase(lf);
        const here = pathAt(L.path, e);
        // Heading along the path. The city pause has already turned toward the
        // first bearing of this leg, so travel can begin without a separate pivot.
        // Arrival still eases back to north before the next stop takes over.
        const h = pathBearingAt(L.path, e, headingSpan(L.kind));
        const inW = 0.28; const outW = 0.32;
        const w = lf < inW ? easeInOut(lf / inW) : (lf > 1 - outW ? easeInOut((1 - lf) / outW) : 1);
        const zoom = lerp(DWELL_ZOOM, cruiseZoom(L.km, air), w);
        let br = h;
        if (lf < inW) br = lerpAngle(L.startBearing, h, easeInOut(lf / inW));
        else if (lf > 1 - outW) br = lerpAngle(h, 0, easeInOut((lf - (1 - outW)) / outW));
        const lookKm = clamp((40075 / 2 ** zoom) * (air ? 0.16 : 0.1), 0.05, 90) * w;
        out.center = w > 0.001 ? destPoint(here, br, lookKm) : here;
        out.zoom = zoom;
        out.pitch = lerp(DWELL_PITCH, travelPitch(zoom, air), w);
        out.bearing = br;
        out.leg = i; out.frac = e; out.activeStop = lf < 0.5 ? i : i + 1;
        out.moverPos = here;
        out.moverMode = L.mode;
        out.moverLift = 0; // keep the dot ON the line (attached); flight reads via the arc + sky camera
        out.moverOpacity = travelDotOpacity(lf);
        const miles = Math.round((cum[i] + L.km * e) / KM_PER_MI);
        out.eyebrow = `${titleCase(L.mode)} · ${miles} mi`;
        out.title = `${stops[i].name} → ${stops[i + 1].name}`;
        out.sub = `${Math.round(L.miles)} mi${L.durationMin ? ` · ${formatDuration(L.durationMin)}` : ''}`;
      } else { // outro — zoom leads, pan still finishes with it, so we don't drift over blank sea.
        const zoomE = easeOutQuart(lf);
        const panE = easeInOut(lf);
        out.zoom = lerp(DWELL_ZOOM, ov.zoom, zoomE);
        out.center = [lerp(pts[last][0], ov.center[0], panE), lerp(pts[last][1], ov.center[1], panE)];
        out.pitch = lerp(DWELL_PITCH, 12, zoomE);
        out.bearing = 0;
        out.leg = pts.length; out.frac = 1; out.activeStop = -1;
        out.eyebrow = 'Trip complete'; out.title = tripTitle; out.sub = tripSub;
      }
      return out;
    }

    function applyFrame(f) {
      if (!map) return;
      const cam = camRef.current;
      if (seekRef.current) {
        cam.zoom = f.zoom; cam.pitch = f.pitch; cam.bearing = f.bearing;
        seekRef.current = false;
      } else {
        const nz = lerp(cam.zoom, f.zoom, 0.16); // track zoom tightly so it's settled on arrival
        const np = lerp(cam.pitch, f.pitch, 0.08);
        const nb = lerpAngle(cam.bearing, f.bearing, f.bearingFollow || 0.08);
        cam.zoom = nz; cam.pitch = np; cam.bearing = nb;
      }
      // Keep geometry uploads out of the animation frame: the active leg stays
      // in the map source and only its paint cutoff moves with the dot.
      if (f.leg !== lastLegDrawnRef.current) {
        const tr = map.getSource('route-trail'); if (tr) tr.setData(lineFeature(trailData(f.leg)));
        lastLegDrawnRef.current = f.leg;
      }
      if (f.leg !== lastHeadLegRef.current) {
        const hd = map.getSource('route-head'); if (hd) hd.setData(lineFeature(headData(f.leg)));
        lastHeadLegRef.current = f.leg;
        lastHeadProgressRef.current = '';
      }
      const headActive = Boolean(f.moverPos && legsRef.current[f.leg]);
      const headProgress = headActive
        ? progressUnderDot(map, legsRef.current[f.leg].path, f.frac, ROUTE_HEAD_UNDER_DOT_PX)
        : 0;
      setHeadProgress(map, headProgress, headActive);

      if (f.moverPos) {
        if (moverRef.current) moverRef.current.style.opacity = String(clamp(f.moverOpacity ?? 1, 0, 1));
        moverMarkerRef.current?.setLngLat(f.moverPos);
      } else if (moverRef.current) {
        moverRef.current.style.opacity = '0';
      }

      // Always re-set the camera, even once it's converged: MapLibre only
      // re-syncs terrain-elevated DOM markers on a "move" event, and skipping
      // jumpTo once nothing changes leaves them one frame stale (e.g. a stop
      // marker rendered noticeably off from where its route line ends).
      map.jumpTo({ center: f.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing });

      // Re-sync every marker to its coordinate each frame, AFTER the camera move.
      // Terrain-elevated DOM markers only re-project on a map "move", so on frames
      // where jumpTo doesn't meaningfully move the camera the pins (worst at
      // high-elevation Munich) drift off the terrain-draped route line. Forcing
      // setLngLat re-queries the terrain and glues the flag pins and the plane
      // back onto the line.
      for (let i = 0; i < stopMarkerObjsRef.current.length; i++) {
        stopMarkerObjsRef.current[i]?.setLngLat(pts[i]);
      }
      if (f.moverPos) moverMarkerRef.current?.setLngLat(f.moverPos);

      if (f.moverPos) {
        const disc = moverDiscRef.current;
        if (disc && disc.__mode !== f.moverMode) { disc.innerHTML = transportGlyphSvg(f.moverMode); disc.__mode = f.moverMode; }
        if (disc) {
          const L = legsRef.current[f.leg];
          const dir = isFlightMode(f.moverMode) && L
            ? mapRelativeBearing(map, L.path, f.frac, headingSpan(L.kind))
            : null;
          const transform = Number.isFinite(dir) ? `rotate(${dir - 45}deg)` : '';
          if (disc.__tf !== transform) { disc.style.transform = transform; disc.__tf = transform; }
        }
        const lift = f.moverLift * LIFT_PX;
        if (moverLiftRef.current) moverLiftRef.current.style.transform = `translateY(${-lift}px)`;
        if (moverShadowRef.current) {
          moverShadowRef.current.style.opacity = f.moverLift > 0.02 ? String(0.45 * f.moverLift) : '0';
          moverShadowRef.current.style.transform = `translate(-50%, -50%) scale(${1 - 0.35 * f.moverLift})`;
        }
      }

      highlightMarker(f.activeStop);

      setText(eyebrowRef.current, f.eyebrow);
      setText(titleRef.current, f.title);
      setText(subRef.current, f.sub);
      const prog = clamp(tRef.current / timelineRef.current.total, 0, 1);
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${prog})`;
      if (thumbRef.current) thumbRef.current.style.left = `${prog * 100}%`;
      if (trackRef.current) {
        const pct = String(Math.round(prog * 100));
        if (trackRef.current.__p !== pct) { trackRef.current.setAttribute('aria-valuenow', pct); trackRef.current.__p = pct; }
      }
    }

    let lastNow = 0;
    function frame(now) {
      if (disposed) return;
      const dt = lastNow ? Math.min(now - lastNow, 60) : 16;
      lastNow = now;
      const total = timelineRef.current.total;
      if (playingRef.current && !scrubRef.current) {
        tRef.current += dt * speedRef.current * PLAYBACK_RATE;
        if (tRef.current >= total) {
          tRef.current = total;
          playingRef.current = false;
          setPlaying(false); setEnded(true);
          setInteractive(true);
        }
      }
      applyFrame(frameAt(tRef.current));
      rafRef.current = requestAnimationFrame(frame);
    }
    function startLoop() { lastNow = 0; seekRef.current = true; rafRef.current = requestAnimationFrame(frame); }

    return () => {
      disposed = true;
      clearTimeout(loadTimer);
      cancelAnimationFrame(rafRef.current);
      try { roRef.current && roRef.current.disconnect(); } catch { /* noop */ }
      roRef.current = null;
      markersRef.current = [];
      stopMarkerObjsRef.current = [];
      moverRef.current = null; moverMarkerRef.current = null;
      moverLiftRef.current = null; moverDiscRef.current = null; moverShadowRef.current = null;
      try { map && map.remove(); } catch { /* ignore */ }
      mapRef.current = null;
    };
  }, [sig]);

  function togglePlay() {
    if (ended) {
      const m = mapRef.current;
      replayFromRef.current = m ? {
        center: [m.getCenter().lng, m.getCenter().lat],
        zoom: m.getZoom(),
        pitch: m.getPitch(),
        bearing: m.getBearing(),
      } : null;
      tRef.current = 0; setEnded(false); seekRef.current = true;
    }
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
    if (next) { seekRef.current = true; setInteractive(false); }
    else setInteractive(true);
  }

  function cycleSpeed() {
    const order = [1, 1.5, 2, 3];
    const nextV = order[(order.indexOf(speed) + 1) % order.length];
    speedRef.current = nextV; setSpeed(nextV);
  }

  const wasPlayingRef = useRef(true);
  function seekToClientX(clientX) {
    const el = trackRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = clamp((clientX - r.left) / r.width, 0, 1);
    tRef.current = frac * timelineRef.current.total;
    seekRef.current = true;
    if (ended && frac < 1) setEnded(false);
  }
  function onScrubDown(e) {
    e.preventDefault();
    scrubRef.current = true;
    wasPlayingRef.current = playingRef.current;
    playingRef.current = false; setPlaying(false);
    setInteractive(false);
    seekToClientX(e.clientX);
    const move = (ev) => seekToClientX(ev.clientX);
    const up = () => {
      scrubRef.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (wasPlayingRef.current && tRef.current < timelineRef.current.total) {
        playingRef.current = true; setPlaying(true); seekRef.current = true;
      } else { setInteractive(true); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return html`<div class="story-overlay flyover-overlay" role="dialog" aria-label="Trip flyover">
    <div ref=${containerRef} class="story-map"></div>
    <div class="flyover-scrim" aria-hidden="true"></div>

    <button class="flyover-close" aria-label="Close flyover" onClick=${onClose}><${IconX} className="w-5 h-5" /></button>

    ${status === 'loading' && html`<div class="flyover-center" aria-live="polite">
      <div class="flyover-loading-card">
        <div class="flyover-loading-meta">${Math.round(clamp(loadingProgress, 0, 1) * 100)}%</div>
        <div
          class="flyover-progress"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow=${Math.round(clamp(loadingProgress, 0, 1) * 100)}
        >
          <div class="flyover-progress-fill" style=${{ width: `${Math.round(clamp(loadingProgress, 0, 1) * 1000) / 10}%` }}></div>
        </div>
        <div class="flyover-loading-term">${loadingMessage}</div>
      </div>
    </div>`}
    ${status === 'error' && html`<div class="flyover-center flyover-center--err">
      <p>${enoughStops ? "Couldn't load the 3D map (the network blocked the satellite/terrain tiles)." : 'Add at least two stops to play the flyover.'}</p>
      <button class="flyover-errbtn" onClick=${onClose}>Close</button>
    </div>`}

    ${status === 'ready' && html`<div class="flyover-dock">
      <div class="flyover-meta">
        <div class="flyover-eyebrow" ref=${eyebrowRef}></div>
        <div class="flyover-metarow">
          <div class="flyover-title" ref=${titleRef}>${stops[0]?.name || ''}</div>
          <div class="flyover-sub" ref=${subRef}></div>
        </div>
      </div>
      <div class="flyover-controls">
        <button class="flyover-play" aria-label=${playing ? 'Pause' : 'Play'} onClick=${togglePlay}>
          ${playing
            ? html`<svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`
            : (ended
              ? html`<svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`
              : html`<svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor"><path d="M8 5l11 7-11 7z"/></svg>`)}
        </button>
        <div class="flyover-scrub" ref=${trackRef} onPointerDown=${onScrubDown} role="slider"
          aria-label="Replay progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="flyover-scrub-track"></div>
          <div class="flyover-scrub-fill" ref=${fillRef}></div>
          <div class="flyover-scrub-thumb" ref=${thumbRef}></div>
        </div>
        <button class="flyover-speed" aria-label="Playback speed" onClick=${cycleSpeed}>${speed % 1 === 0 ? speed : speed.toFixed(1)}×</button>
      </div>
    </div>`}

    <div class="flyover-attrib">${ESRI_ATTRIB}</div>
  </div>`;
}

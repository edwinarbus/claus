import { html, useRef, useEffect, useState } from '../html.js';
import L from 'leaflet';
import {
  mapFitPadding, whenMapSized, watchMapResize, basemapUrl, watchBasemapTheme, lightBasemapUrl,
} from '../lib/maps.js';
import { useTheme } from '../lib/theme.js';
import { haversineKm } from '../data/logistics.js';
import { CITY_TRANSIT, intraCityHop, transitPayShort, rideHailShort } from '../data/cityTransit.js';
import { useDayGeo } from './useDayGeo.js';
import { IconChevronDown, IconChevronRight, IconMap, IconCreditCard, IconTicket, IconPhone } from './icons.js';
import { TransportGlyph } from './TransportGlyph.js';

// Render a "getting around" glyph by key: ride-hailing reads as a phone (you
// order it on an app); everything else is a transport-mode glyph.
function TransitGlyph({ glyph, className = 'w-3.5 h-3.5' }) {
  if (glyph === 'rideshare') return html`<${IconPhone} className=${className} />`;
  return html`<${TransportGlyph} mode=${glyph} className=${className} />`;
}

// One compact labeled fact in the day-map "getting around" grid.
function TransitFact({ label, icon, value }) {
  return html`<div class="flex items-start gap-1.5 min-w-0">
    <span class="shrink-0 inline-flex items-center text-slate-500 mt-[0.15rem]">${icon}</span>
    <div class="min-w-0">
      <div class="uppercase tracking-wide text-[10px] font-semibold text-slate-400 leading-tight">${label}</div>
      <div class="text-[11px] text-slate-600 leading-snug">${value}</div>
    </div>
  </div>`;
}

// Chronological order so the route + getting-around list read as the day flows.
const ORDER = ['breakfast', 'morning', 'lunch', 'afternoon', 'dinner', 'evening'];

function collectPoints(day) {
  const pts = [];
  ORDER.forEach((k) => {
    const v = day.slots?.[k];
    if (Array.isArray(v)) v.forEach((it) => pts.push(it));
    else if (v) pts.push(v);
  });
  return pts;
}

// Keep persistent map labels short so they don't crowd the little map.
function shortLabel(name) {
  const s = (name || '').trim();
  return s.length > 22 ? `${s.slice(0, 21)}…` : s;
}

// Inline bed glyph (same shape as the IconBed component) for raw Leaflet HTML —
// `stroke` can be a colour or "currentColor" to inherit the label/text colour.
function bedGlyph(stroke, px) {
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${stroke}"
    stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="display:block">
    <path d="M3 7v12M3 11h15a3 3 0 0 1 3 3v5M3 16h18"/>
    <path d="M6.5 11V9.4a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4V11"/></svg>`;
}

// Route + sight color: deep teal-blue on the light basemap; a brighter sky
// tone on dark_all so the numbered pins and route don't sink into the tiles.
function routeColor(dark) { return dark ? '#4f93b8' : '#2f6a89'; }

function dayPin(n, dark) {
  const bg = routeColor(dark);
  const edge = dark ? 'rgba(248,245,238,0.92)' : '#fff';
  return L.divIcon({
    className: 'scandi-daypin',
    html: `<div style="width:24px;height:24px;border-radius:9999px;background:${bg};color:#fff;
      border:2px solid ${edge};box-shadow:0 1px 5px rgba(0,0,0,${dark ? '.55' : '.35'});display:grid;place-items:center;
      font-weight:700;font-size:12px;font-family:Outfit,sans-serif;">${n}</div>`,
    iconSize: [24, 24], iconAnchor: [12, 12],
  });
}

// The booked hotel gets a distinct "home base" pin (not part of the route).
function lodgePin(dark) {
  const bg = dark ? '#d59a3f' : '#b4791f';
  const edge = dark ? 'rgba(248,245,238,0.92)' : '#fff';
  return L.divIcon({
    className: 'scandi-lodgepin',
    html: `<div style="width:26px;height:26px;border-radius:9999px;background:${bg};color:#fff;
      border:2px solid ${edge};box-shadow:0 1px 5px rgba(0,0,0,${dark ? '.55' : '.35'});display:grid;place-items:center;
      line-height:1;">${bedGlyph('#fff', 15)}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 13],
  });
}

// A hollow, dashed pin for best-guess spots we couldn't locate exactly — so
// the traveler can see it's approximate and not a precise address.
function approxPin(dark) {
  const c = routeColor(dark);
  return L.divIcon({
    className: 'scandi-approxpin',
    html: `<div style="width:18px;height:18px;border-radius:9999px;background:${dark ? 'rgba(95,176,214,.22)' : 'rgba(47,106,137,.18)'};
      border:2px dashed ${c};box-shadow:0 1px 3px rgba(0,0,0,${dark ? '.4' : '.2'});"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9],
  });
}

// Remember each day map's last center + zoom, keyed by stop+day. Collapsing the
// panel (or the whole stop card) tears the Leaflet map down; without this it
// would re-fit from scratch on every reopen — resetting the view and often
// snapping to a too-tight zoom. Module-level so it survives a full unmount.
const DAY_VIEW = new Map();

// A small map of one day's plotted stops + advice on getting between them.
export function DayMap({ stop, day, receipt = false }) {
  const [open, setOpen] = useState(true);
  const [, , theme] = useTheme();
  // Receipt is a printed/paper artifact — pins/route always render in their
  // light-mode colors, never following the device into dark mode.
  const dark = !receipt && theme === 'dark';
  const points = collectPoints(day);
  const lodging = (day.slots && day.slots.lodging) || null;
  const city = { id: stop.cityId || stop.id, name: stop.name, country: stop.country, lat: stop.lat, lng: stop.lng };
  // Geocode activities + the booked hotel (so it can be pinned as a home base).
  const geoPoints = open ? (lodging ? [...points, lodging] : points) : [];
  const coords = useDayGeo(geoPoints, city);

  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const unwatchRef = useRef(null);
  const unwatchThemeRef = useRef(null);
  const fitRef = useRef(null);
  // Once we've framed this day's pins, we stop auto-fitting so the user's (or a
  // restored) zoom/pan is never yanked out from under them.
  const didFitRef = useRef(false);
  // Latest cache key for this day (kept fresh so Leaflet event handlers bound at
  // map-creation time still write to the right slot after a date edit).
  const viewKeyRef = useRef('');
  viewKeyRef.current = `${stop.id}:${day.date}`;

  function saveView() {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    DAY_VIEW.set(viewKeyRef.current, { center: [c.lat, c.lng], zoom: map.getZoom() });
  }

  // Hold the map hidden until it has settled into its final bounds, then fade it
  // in fully formed — otherwise it visibly snaps/zooms as each pin's coordinates
  // stream in from geocoding (the "flash" on load).
  const [revealed, setRevealed] = useState(false);
  const resolvedCount = Object.keys(coords).length;
  const allResolved = open && geoPoints.length > 0 && geoPoints.every((p) => p.id in coords);

  const located = points.map((p) => ({ p, c: coords[p.id] })).filter((x) => x.c);
  // Precise = a real geocoded spot; approx = our best-guess pin near the city
  // center (so every recommendation still lands on the map, honestly flagged).
  const precise = located.filter((x) => !x.c.approx);
  const approxPts = located.filter((x) => x.c.approx);
  // Only pin the hotel when we have its real location — never guess your stay.
  const lodgeLoc = lodging && coords[lodging.id] && !coords[lodging.id].approx
    ? { p: lodging, c: coords[lodging.id] } : null;
  const locatedSig = [
    ...located.map((x) => `${x.p.id}:${x.c.approx ? 'a' : ''}${x.c.lat.toFixed(4)},${x.c.lng.toFixed(4)}`),
    lodgeLoc ? `lodge:${lodgeLoc.c.lat.toFixed(4)},${lodgeLoc.c.lng.toFixed(4)}` : '',
  ].join('|');

  function fitDayBounds(bounds, reveal = false) {
    const map = mapRef.current;
    if (!map) return;
    fitRef.current = bounds;
    whenMapSized(map, ({ width }) => {
      if (!mapRef.current) return;
      if (!bounds.length) map.setView([city.lat, city.lng], 12);
      else if (bounds.length === 1) map.setView(bounds[0], receipt ? 15 : 14);
      else {
        // Receipt: the map carries NO text labels (they'd stack into an
        // unreadable wall in an 80mm frame — the plan is listed above it), so we
        // only need to keep the little pin circles off the edges. A snug, even
        // pad does that. Crucially we let it zoom IN, not out: a day's pins all
        // sit in one city center, so a higher zoom pushes them APART in pixels
        // and de-clutters them — zooming out only crushes them together.
        const pad = receipt
          ? { padding: [26, 26] }
          : mapFitPadding(width, [28, 32], [80, 28]);
        // Cap at neighborhood zoom so tightly-clustered pins don't snap to a
        // disorienting street-level close-up.
        map.fitBounds(L.latLngBounds(bounds), { animate: false, maxZoom: 15, ...pad });
      }
      // Reveal only once the view is correct, so the settle is never seen.
      if (reveal) setRevealed(true);
    });
  }

  // Create / tear down the Leaflet instance with the panel's open state.
  useEffect(() => {
    if (!open) {
      saveView(); // remember where we were before tearing the map down
      if (unwatchRef.current) { unwatchRef.current(); unwatchRef.current = null; }
      if (unwatchThemeRef.current) { unwatchThemeRef.current(); unwatchThemeRef.current = null; }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      fitRef.current = null;
      return undefined;
    }
    if (mapRef.current || !elRef.current) return undefined;
    const map = L.map(elRef.current, {
      scrollWheelZoom: false,
      attributionControl: false,
      // Receipt mode is a static snapshot — no panning, zooming, or controls.
      zoomControl: !receipt,
      dragging: !receipt,
      doubleClickZoom: !receipt,
      touchZoom: !receipt,
      boxZoom: !receipt,
      keyboard: !receipt,
    }).setView([city.lat, city.lng], 12);
    // Receipt is a printed/paper artifact — always light tiles, and never
    // follow the device into dark mode the way the interactive map does.
    const tiles = L.tileLayer(receipt ? lightBasemapUrl() : basemapUrl(), {
      maxZoom: 19, subdomains: 'abcd',
    }).addTo(map);
    if (!receipt) unwatchThemeRef.current = watchBasemapTheme(tiles);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // Restore the last view for this day (panel reopen, or a re-expanded stop)
    // so we don't reset the zoom. Mark it framed so the redraw won't re-fit.
    // A receipt always fits fresh and never records the view.
    const cached = !receipt && DAY_VIEW.get(viewKeyRef.current);
    if (cached) {
      map.setView(cached.center, cached.zoom, { animate: false });
      didFitRef.current = true;
    } else {
      didFitRef.current = false;
    }
    if (!receipt) map.on('moveend zoomend', saveView);
    unwatchRef.current = watchMapResize(elRef.current, () => {
      const m = mapRef.current;
      if (!m) return;
      // Still framing the first load → fit; otherwise keep the view and just
      // tell Leaflet the container changed size (orientation, iOS chrome).
      if (!didFitRef.current && fitRef.current) fitDayBounds(fitRef.current, true);
      else m.invalidateSize();
    });
    return undefined;
  }, [open]);

  useEffect(() => () => {
    saveView();
    if (unwatchRef.current) { unwatchRef.current(); unwatchRef.current = null; }
    if (unwatchThemeRef.current) { unwatchThemeRef.current(); unwatchThemeRef.current = null; }
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    fitRef.current = null;
  }, []);

  // Re-hide when the panel closes; safety-net reveal if geocoding stalls so the
  // map never stays blank waiting on a slow/last lookup.
  useEffect(() => {
    if (!open) { setRevealed(false); return undefined; }
    const t = setTimeout(() => setRevealed(true), 1600);
    return () => clearTimeout(t);
  }, [open]);

  // Redraw pins + route as coordinates stream in.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return undefined;
    layer.clearLayers();
    const bounds = [];
    // The interactive day map labels every pin (to its right). The receipt map
    // does NOT: at 80mm the labels stack into an unreadable pile, and the plan
    // is already listed above the map — so it shows numbered dots + route only.
    const labelBase = 'scandi-maplabel';
    const labelDir = 'right';
    const labelOff = [5, 0];
    const lodgeOff = [6, 0];
    // Numbered route through the precisely-located spots only, so the
    // getting-around distances below stay trustworthy.
    const routeLatLngs = precise.map((x) => [x.c.lat, x.c.lng]);
    if (routeLatLngs.length > 1) {
      L.polyline(routeLatLngs, { color: routeColor(dark), weight: 2.5, opacity: dark ? 0.95 : 0.8, dashArray: '2 7' }).addTo(layer);
    }
    precise.forEach((x, idx) => {
      const m = L.marker([x.c.lat, x.c.lng], { icon: dayPin(idx + 1, dark) }).addTo(layer);
      if (!receipt) m.bindTooltip(shortLabel(x.p.name), { permanent: true, direction: labelDir, offset: labelOff, className: labelBase });
      bounds.push([x.c.lat, x.c.lng]);
    });
    // Best-guess pins fan out slightly around the center so they don't stack.
    const spread = approxPts.length > 1 ? 0.004 : 0;
    approxPts.forEach((x, idx) => {
      const ang = (idx / approxPts.length) * Math.PI * 2;
      const lat = x.c.lat + Math.cos(ang) * spread;
      const lng = x.c.lng + Math.sin(ang) * spread;
      const m = L.marker([lat, lng], { icon: approxPin(dark) }).addTo(layer);
      if (!receipt) m.bindTooltip(`≈ ${shortLabel(x.p.name)}`, { permanent: true, direction: labelDir, offset: labelOff, className: `${labelBase} scandi-maplabel-approx` });
      bounds.push([lat, lng]);
    });
    if (lodgeLoc) {
      const m = L.marker([lodgeLoc.c.lat, lodgeLoc.c.lng], { icon: lodgePin(dark) }).addTo(layer);
      if (!receipt) m.bindTooltip(`<span style="display:inline-flex;align-items:center;gap:4px;">${bedGlyph('currentColor', 12)}${shortLabel(lodgeLoc.p.name)}</span>`, { permanent: true, direction: labelDir, offset: lodgeOff, className: `${labelBase} scandi-maplabel-lodge` });
      bounds.push([lodgeLoc.c.lat, lodgeLoc.c.lng]);
    }
    fitRef.current = bounds;
    if (receipt) {
      // A receipt map is a static snapshot with no user pan/zoom to preserve —
      // re-fit on EVERY redraw. Locking the frame after the first settled fit
      // (like the interactive map below) strands late-arriving coordinates
      // outside the frame: a slow wiki lookup can upgrade a city-center guess
      // to a spot far from the others after the lock, leaving its pin and the
      // route to it cropped off the edge of the receipt.
      fitDayBounds(bounds, allResolved);
    } else if (!didFitRef.current) {
      // First framing of this day: fit as pins stream in (invisibly), then
      // reveal once everything has resolved so load shows a settled map.
      fitDayBounds(bounds, allResolved);
      if (allResolved) didFitRef.current = true;
    } else {
      // Already framed (restored view, or the user moved the map) — leave the
      // view alone; just make sure it's revealed.
      whenMapSized(map, () => { if (mapRef.current) setRevealed(true); });
    }
    return undefined;
  }, [open, locatedSig, resolvedCount, allResolved, dark]);

  if (!points.length && !lodging) return null;
  const transit = CITY_TRANSIT[city.id];
  const pinnedCount = located.length + (lodgeLoc ? 1 : 0);
  const totalMappable = points.length + (lodging ? 1 : 0);

  // Receipt: a static, non-interactive snapshot with no toggle and no getting-
  // around facts (the report already carries a clean, legible "getting around").
  if (receipt) {
    // The pins carry no labels, so a compact key ties each numbered pin back to
    // its name — in the exact same order the pins are numbered (both come from
    // `precise`, so they can't drift). Hollow "≈" rows mirror the dashed
    // best-guess pins; the bed row is the home-base hotel.
    const hasKey = precise.length || approxPts.length || lodgeLoc;
    return html`<div class="receipt-map">
      <div class="receipt-map-head">◆ THE DAY ◆</div>
      <div ref=${elRef} class="receipt-map-canvas"
        style=${{ opacity: revealed ? 1 : 0 }}></div>
      ${hasKey ? html`<div class="receipt-map-key">
        ${precise.map((x, idx) => html`
          <div class="receipt-map-key-item" key=${x.p.id}>
            <span class="receipt-map-key-n">${idx + 1}</span>
            <span class="receipt-map-key-name">${x.p.name}</span>
          </div>`)}
        ${approxPts.map((x) => html`
          <div class="receipt-map-key-item receipt-map-key-approx" key=${x.p.id}>
            <span class="receipt-map-key-n is-approx" aria-hidden="true"></span>
            <span class="receipt-map-key-name">≈ ${x.p.name}</span>
          </div>`)}
        ${lodgeLoc ? html`
          <div class="receipt-map-key-item">
            <span class="receipt-map-key-n is-lodge"
              dangerouslySetInnerHTML=${{ __html: bedGlyph('currentColor', 9) }}></span>
            <span class="receipt-map-key-name">${lodgeLoc.p.name}</span>
          </div>` : null}
      </div>` : null}
    </div>`;
  }

  return html`<div class="mt-2 pt-2 border-t border-[#1a1714]">
    <button onClick=${() => setOpen(!open)}
      class="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition-colors">
      ${open ? html`<${IconChevronDown} className="w-3.5 h-3.5" />` : html`<${IconChevronRight} className="w-3.5 h-3.5" />`}
      <span class="inline-flex items-center gap-1.5"><${IconMap} className="w-4 h-4" /> Day map & getting around</span>
      <span class="text-slate-300 font-normal">(${pinnedCount}/${totalMappable} pinned)</span>
    </button>

    ${open && html`<div class="mt-2 animate-fade-in">
      <div ref=${elRef} class="w-full rounded-[3px] overflow-hidden border border-[1.5px] border-[#1a1714] bg-stone-100 transition-opacity duration-300 ease-out"
        style=${{ height: '240px', opacity: revealed ? 1 : 0 }}></div>
      <p class="text-[10px] text-slate-400 mt-1 text-right">© OpenStreetMap · CARTO</p>

      <!-- Getting around: a compact poster-style fact grid (no verbose prose). -->
      <!-- Public transit + walking only — no ride-hailing (see cityTransit.js). -->
      ${transit && html`<div class="mt-2 grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-3 gap-y-2">
        <${TransitFact} label="Around" icon=${html`<${TransitGlyph} glyph=${transit.glyph} className="w-3.5 h-3.5" />`} value=${transit.primary} />
        ${transitPayShort(city.id) && html`<${TransitFact} label="Pay"
          icon=${transit.tap ? html`<${IconCreditCard} className="w-3.5 h-3.5" />` : html`<${IconTicket} className="w-3.5 h-3.5" />`}
          value=${transitPayShort(city.id)} />`}
      </div>`}

      ${precise.length > 1 && html`<ul class="mt-2.5 pt-2.5 border-t border-[#1a1714] grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-3 gap-y-1">
        ${precise.slice(0, -1).map((x, idx) => {
          const nx = precise[idx + 1];
          const km = haversineKm(x.c, nx.c);
          const hop = intraCityHop(city.id, km);
          return html`<li key=${idx} class="text-[11px] text-slate-500 flex items-start gap-1.5">
            <span class="tnum text-slate-400 font-bold shrink-0">${idx + 1}→${idx + 2}</span>
            <span class="shrink-0 inline-flex items-center text-slate-500 mt-px"><${TransitGlyph} glyph=${hop.glyph} className="w-3.5 h-3.5" /></span>
            <span class="min-w-0 truncate"><span class="font-medium text-slate-600">${hop.mode}</span> · ${x.p.name} → ${nx.p.name}</span>
          </li>`;
        })}
      </ul>`}

      ${precise.length === 1 && approxPts.length === 0 && html`<p class="text-[11px] text-slate-400 mt-1.5">One mappable stop today — plan more to see how to get between them.</p>`}
      ${lodging && !lodgeLoc && html`<p class="text-[10px] text-slate-400 mt-1">Couldn’t locate “${lodging.name}” — try the hotel’s full name.</p>`}
    </div>`}
  </div>`;
}

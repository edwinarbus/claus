import { html, useState, useRef, useEffect, useCallback } from '../html.js';
import L from 'leaflet';
import { useStore } from '../store/store.js';
import { useStopWeather } from './useWeather.js';
import { useWikiImage } from './useWikiImage.js';
import { WeatherChip } from './WeatherChip.js';
import { TierBadge } from './ItemBits.js';
import { resolveTransport, formatDuration } from '../data/logistics.js';
import { TransportGlyph, transportGlyphSvg } from './TransportGlyph.js';
import { isStopPast } from '../store/selectors.js';
import { stopColor, dimForDark } from '../data/palette.js';
import { formatRange, nightsBetween } from '../lib/dates.js';
import { FlagGlyph } from './FlagGlyph.js';
import { StoryMode } from './StoryMode.js';
import { mapFitPadding, whenMapSized, watchMapResize } from '../lib/maps.js';
import { useTheme } from '../lib/theme.js';
import { IconExternal, IconChevronRight, IconX, IconMap } from './icons.js';

// Europe-region slice of Natural Earth 1:50m (trimmed to ~33–73°N, -28–50°E).
// Higher resolution than the old 1:110m world set — smoother coastlines/borders —
// yet smaller on the wire since it drops the rest of the planet.
const COUNTRY_GEOJSON_URL = new URL('../data/countries-eu-50m.geojson', import.meta.url).href;
// Major European cities + national capitals (Natural Earth, trimmed) — the
// reference labels the raster basemap used to provide.
const CITIES_URL = new URL('../data/cities-eu.json', import.meta.url).href;

// Rough label anchor for a country: the centroid of its largest ring, plus that
// ring's bbox span so we can skip tiny countries (avoids label clutter).
function countryLabelPoint(geom) {
  if (!geom) return null;
  const rings = [];
  if (geom.type === 'Polygon') rings.push(...geom.coordinates);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach((p) => rings.push(...p));
  let best = null;
  for (const r of rings) if (!best || r.length > best.length) best = r;
  if (!best || !best.length) return null;
  let sx = 0; let sy = 0; let minx = 180; let maxx = -180; let miny = 90; let maxy = -90;
  for (const [lng, lat] of best) {
    sx += lng; sy += lat;
    if (lng < minx) minx = lng; if (lng > maxx) maxx = lng;
    if (lat < miny) miny = lat; if (lat > maxy) maxy = lat;
  }
  const n = best.length;
  return { lat: sy / n, lng: sx / n, span: (maxx - minx) * (maxy - miny) };
}

function topImageItem(stop) {
  const all = [...(stop.recs?.see || []), ...(stop.recs?.do || [])];
  return all.find((it) => it.wiki || it.imageUrl) || null;
}

function TransportLine({ label, t }) {
  if (!t) return null;
  return html`<div class="flex items-center gap-1.5 text-[11px] text-slate-500">
    <span class="text-slate-400">${label}</span>
    <${TransportGlyph} mode=${t.mode} className="w-3.5 h-3.5 text-slate-600" />
    <span class="capitalize text-slate-600">${t.mode}</span>
    <span class="text-slate-300">·</span>
    <span>~${formatDuration(t.durationMin)}</span>
  </div>`;
}

function travelTooltip(t) {
  if (!t) return '';
  const mode = String(t.mode || 'Travel').replace(/\b\w/g, (ch) => ch.toUpperCase());
  return `${mode}: ${formatDuration(t.durationMin)}`;
}

function countryNames(feature) {
  const p = feature && feature.properties ? feature.properties : {};
  return [p.NAME, p.NAME_LONG, p.ADMIN, p.SOVEREIGNT, p.GEOUNIT, p.SUBUNIT].filter(Boolean);
}

function isVisitedCountry(feature, visitedCountries) {
  return countryNames(feature).some((name) => visitedCountries.has(name));
}

// Stylized vector land. With no raster basemap, every country is drawn as a
// polygon, so the coastline has a single consistent source — no tile-vs-overlay
// mismatch, hence no jagged edge. Visited countries read as warm "trip land";
// the rest recede to a cool grey. A thin border gives the poster-map definition
// that suits Claus's flat editorial style.
function landStyle(dark, visited) {
  if (visited) {
    return dark
      ? { stroke: true, color: '#46536a', weight: 0.8, fillColor: '#33404f', fillOpacity: 1 }
      : { stroke: true, color: '#d7ccb4', weight: 0.8, fillColor: '#f3eee1', fillOpacity: 1 };
  }
  // Non-visited: muted, but clearly above the sea so it still reads as land.
  // The sea is now pure black, so the fill can sit a touch darker while the
  // lighter country stroke keeps borders legible against the water.
  return dark
    ? { stroke: true, color: '#333b46', weight: 0.6, fillColor: '#191e27', fillOpacity: 1 }
    : { stroke: true, color: '#b2bac3', weight: 0.6, fillColor: '#c6ccd3', fillOpacity: 1 };
}

// City labels only appear once you've zoomed in past the trip overview onto a
// single area — at the wide fit they'd just clutter. One notch in from the
// overview fit is enough to reveal them.
const CITY_MIN_ZOOM = 6;

// Geometry of one route leg as actually DRAWN: project both ends into map
// space and take the straight line between them. The geographic (lat/lng)
// midpoint drifts off the drawn line at Mercator's high latitudes, and a
// lat/lng-delta bearing is likewise only approximate — projecting first puts
// the badge exactly on the line and aims the glyph exactly along it. Zoom 0
// is fine: the projection only scales with zoom, angles and midpoints don't.
function legGeometry(map, a, b) {
  const pa = map.project(L.latLng(a.lat, a.lng), 0);
  const pb = map.project(L.latLng(b.lat, b.lng), 0);
  const mid = map.unproject(pa.add(pb).divideBy(2), 0);
  // Screen bearing: 0 = up/north, 90 = right/east (projected y grows downward).
  const bearing = ((Math.atan2(pb.x - pa.x, -(pb.y - pa.y)) * 180) / Math.PI + 360) % 360;
  return { mid, bearing };
}

// CSS transform pointing a transport glyph in the direction of travel.
// Apple (and most emoji sets) draw ✈️ with the nose up-right at ~45°, and
// 🛳️/⛴️/🚗/🚶 facing west; 🚆 and 🚌 are head-on with no direction to show.
// The plane rotates so the cockpit points straight at the next stop,
// mirroring for westbound headings so it never flies belly-up; boats and cars
// only flip east/west — a pitched hull reads as sinking, not sailing.
// Orient the custom glyphs along the route bearing (0=N, 90=E). The plane noses
// up-right (~45°) so it rotates fully; the side-on craft (boats/car/walk) point
// right by default, so we only mirror them when travel heads west — never
// upside-down. Front-view glyphs (train/bus) stay upright.
function transportGlyphTransform(mode, bearing) {
  const m = (mode || '').toLowerCase();
  if (/flight|fly|plane|air/.test(m)) return `rotate(${Math.round(bearing - 45)}deg)`;
  if (/boat|ferry|cruise|sail|express|hydro|car|drive|taxi|walk|foot/.test(m)) {
    return bearing > 180 ? 'scaleX(-1)' : '';
  }
  return '';
}

function FocusCard({ stop, index, total, prevStop, nextStop, onOpen, onClose }) {
  const wx = useStopWeather(stop);
  const nights = nightsBetween(stop.startDate, stop.endDate);
  const { url: img } = useWikiImage(topImageItem(stop) || { wiki: stop.name });
  const incoming = prevStop ? resolveTransport(prevStop, stop) : null;
  const onward = nextStop ? resolveTransport(stop, nextStop) : null;
  return html`<div class="absolute left-3 right-3 bottom-3 sm:left-auto sm:right-3 sm:w-96 z-[1000] flex flex-col max-h-[calc(100%-1.5rem)] bg-white border border-[1.5px] border-[#1a1714] shadow-md rounded-[3px] overflow-hidden gg-pop-in">
    <div class="relative shrink-0">
      ${img && html`<div key=${img} class="thumb-img h-28 w-full bg-stone-100 bg-cover bg-center" style=${{ backgroundImage: `url(${img})` }}></div>`}
      <button onClick=${onClose} title="Close"
        class="absolute top-2 right-2 w-7 h-7 grid place-items-center rounded-[2px] bg-white border border-[1.5px] border-[#1a1714] text-slate-600 hover:text-slate-900">
        <${IconX} className="w-4 h-4" /></button>
    </div>
    <div class="p-3.5 overflow-y-auto scrollbar-thin">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="uppercase tracking-wide text-[11px] font-semibold text-slate-500 tnum">Stop ${index + 1} of ${total}</div>
          <h4 class="font-display font-bold tracking-tight text-slate-900 leading-tight flex items-center gap-1.5 flex-wrap">
            <${FlagGlyph} country=${stop.country} className="w-[1rem] h-[0.75rem]" /> ${stop.name} <${TierBadge} tier=${stop.tier} />
          </h4>
          <div class="text-xs text-slate-500 tnum">${formatRange(stop.startDate, stop.endDate)} · ${nights} ${nights === 1 ? 'night' : 'nights'}</div>
        </div>
        <${WeatherChip} data=${wx.summary} loading=${wx.loading} size="md" />
      </div>
      <p class="text-xs text-slate-600 leading-relaxed mt-2">${stop.blurb}</p>

      ${(incoming || onward) && html`<div class="mt-2.5 pt-2.5 border-t border-[#1a1714] space-y-1">
        <${TransportLine} label=${`From ${prevStop ? prevStop.name : ''}:`} t=${incoming} />
        <${TransportLine} label=${`Onward to ${nextStop ? nextStop.name : ''}:`} t=${onward} />
      </div>`}

      <div class="flex items-center gap-2 mt-3">
        <button onClick=${() => onOpen(stop.id)}
          class="flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold text-white bg-fjord-600 hover:bg-fjord-700 rounded-[2px] py-2">
          Plan this stop <${IconChevronRight} className="w-3.5 h-3.5" />
        </button>
        ${stop.guideUrl && html`<a href=${stop.guideUrl} target="_blank" rel="noopener"
          class="p-2 rounded-[2px] border border-[1.5px] border-[#1a1714] text-slate-500 hover:text-fjord-600"><${IconExternal} className="w-4 h-4" /></a>`}
      </div>
    </div>
  </div>`;
}

function pinIcon(index, selected, past, dark) {
  // Match the per-stop palette used in calendar/timeline; past stops gray out.
  // On dark the vivid -500 fills are muted so they don't glare on the basemap.
  const live = dark ? dimForDark(stopColor(index).hex) : stopColor(index).hex;
  const bg = past ? (dark ? '#565b63' : '#94a3b8') : live;
  const size = selected ? 34 : 28;
  const opacity = past && !selected ? 0.6 : 1;
  // On the dark basemap a chunky pure-white ring reads as a harsh sticker; use
  // a softer warm-white edge and a darker drop shadow so the pin sits IN the
  // map. The selected halo keeps its bright amber ring in both themes.
  const edge = dark ? 'rgba(248,245,238,0.92)' : '#fff';
  const ring = selected
    ? `box-shadow:0 0 0 3px ${edge},0 0 0 6px rgba(217,119,6,.9),0 2px 10px rgba(0,0,0,${dark ? '.6' : '.4'});`
    : `box-shadow:0 2px 7px rgba(0,0,0,${dark ? '.55' : '.35'});`;
  return L.divIcon({
    className: 'scandi-pin',
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};color:#fff;opacity:${opacity};
      border:${dark ? 2 : 3}px solid ${edge};${ring}display:grid;place-items:center;
      font-weight:700;font-size:${selected ? 15 : 13}px;font-family:Outfit,sans-serif;">${index + 1}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function MapView({ onOpenStop }) {
  const { trip } = useStore();
  const [selected, setSelected] = useState(null);
  const [countryGeojson, setCountryGeojson] = useState(null);
  const [cities, setCities] = useState(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [, , theme] = useTheme();
  const dark = theme === 'dark';
  const stops = trip.stops;

  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);      // base overlay: countries + routes + transport
  const cityLayerRef = useRef(null);  // reference-city labels (shown only when zoomed in)
  const pinLayerRef = useRef(null);   // city pins + labels (rebuilt on selection)

  // Reference cities clutter the wide trip view, so they're only on the map once
  // you zoom into a single area. Toggle the layer on zoom rather than rebuilding.
  const syncCityZoom = useCallback(() => {
    const m = mapRef.current; const cl = cityLayerRef.current;
    if (!m || !cl) return;
    const show = m.getZoom() >= CITY_MIN_ZOOM;
    if (show && !m.hasLayer(cl)) cl.addTo(m);
    else if (!show && m.hasLayer(cl)) m.removeLayer(cl);
  }, []);
  const prevCountRef = useRef(0);
  const fitRef = useRef(null); // last latlngs we fit, for resize/orientation reflow
  const boundsReadyRef = useRef(false);
  const revealTimerRef = useRef(null);
  // Keep the map hidden until it has settled into the trip bounds, so opening it
  // doesn't flash the default world view before fitting to the itinerary.
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(COUNTRY_GEOJSON_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.features)) setCountryGeojson(data);
      })
      .catch(() => {});
    fetch(CITIES_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && Array.isArray(data)) setCities(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function revealMap(force = false) {
    if (boundsReadyRef.current || force) setRevealed(true);
  }

  function fitTripBounds(latlngs, withFocusPad) {
    const map = mapRef.current;
    if (!map || !latlngs.length) return;
    boundsReadyRef.current = false;
    setRevealed(false);
    clearTimeout(revealTimerRef.current);
    fitRef.current = { latlngs, withFocusPad };
    whenMapSized(map, ({ width }) => {
      if (!mapRef.current) return;
      const bottom = withFocusPad ? 96 : 40;
      const pad = mapFitPadding(width, [40, 36], [40, bottom]);
      if (latlngs.length === 1) {
        map.setView(latlngs[0], 8, { animate: false });
      } else {
        map.fitBounds(L.latLngBounds(latlngs), { animate: false, maxZoom: 9, ...pad });
      }
      boundsReadyRef.current = true;
      revealMap();
      revealTimerRef.current = setTimeout(() => revealMap(true), 500);
    });
  }

  // Create the map once.
  useEffect(() => {
    if (mapRef.current || !elRef.current) return undefined;
    const map = L.map(elRef.current, {
      scrollWheelZoom: false,
      attributionControl: false,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
    })
      .setView([62, 14], 4);
    // Country name labels get their own pane between the land and the markers so
    // the numbered stop pins AND city labels always stack on top of them (Leaflet
    // otherwise orders markers by latitude, which floated southern labels like
    // AUSTRIA over the Munich pin). NOTE: styles.css flattens every Leaflet pane
    // to z-index:0, so Leaflet's default marker-pane 600 no longer applies — we
    // must set both z-indexes explicitly. countryLabels sits above the overlay
    // pane (land + routes, 0) so labels read over the land...
    map.createPane('countryLabels');
    map.getPane('countryLabels').style.zIndex = 450;
    map.getPane('countryLabels').style.pointerEvents = 'none';
    // ...and the marker pane (city labels + numbered pins) is lifted back above
    // the country labels, undoing the global pane flattening from styles.css.
    map.getPane('markerPane').style.zIndex = 460;
    // No raster basemap: the land is drawn as vector country polygons (see the
    // base effect) and the sea is just the Leaflet container's background
    // (.scandi-map-panel .leaflet-container in styles.css). One coastline source
    // means crisp, consistent borders at every zoom.
    // Two layer groups so selecting a pin doesn't rebuild the heavy base
    // (countries + routes + transport): pins ride above in the marker/tooltip
    // panes and re-render on their own.
    layerRef.current = L.layerGroup().addTo(map);
    // City labels live in their own group, added to the map only when zoomed in.
    cityLayerRef.current = L.layerGroup();
    pinLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.on('zoomend', syncCityZoom);
    // Pause the route's forever stroke-dashoffset animation while the map is
    // actually moving. That animation repaints the whole vector overlay every
    // frame; suppressing it during pan/zoom (when the heavy country polygons are
    // also being re-laid-out) is what kept the gesture smooth — the flow resumes
    // the moment the map settles. Visuals are unchanged while idle.
    const panel = elRef.current;
    const onMoveStart = () => panel && panel.classList.add('is-map-moving');
    const onMoveEnd = () => panel && panel.classList.remove('is-map-moving');
    map.on('movestart zoomstart', onMoveStart);
    map.on('moveend zoomend', onMoveEnd);
    const unwatch = watchMapResize(elRef.current, () => {
      const fit = fitRef.current;
      if (fit) fitTripBounds(fit.latlngs, fit.withFocusPad);
    });
    return () => {
      clearTimeout(revealTimerRef.current);
      unwatch();
      map.off('movestart zoomstart', onMoveStart);
      map.off('moveend zoomend', onMoveEnd);
      map.off('zoomend', syncCityZoom);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      cityLayerRef.current = null;
      pinLayerRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Safety-net reveal in case there are no stops to fit (blank map should show).
  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 1200);
    return () => clearTimeout(t);
  }, []);

  // Phones: fill the screen — the map runs from its spot below the header
  // down to a bottom gutter that clears BOTH the 16px shell rhythm (px-4 side
  // gutters) and the home indicator: max(16px, safe-area-inset-bottom), not
  // their sum — summing left a ~50px dead band above the bottom on Face ID
  // phones. The card's bottom padding is paid INSIDE the calc so the gutter is
  // measured from the card's visible edge. Measured against the document
  // (rect.top + scrollY) so a non-zero scroll position can't shrink the panel.
  // 100dvh tracks Safari's URL bar as it collapses/expands; the ResizeObserver
  // above re-fits Leaflet.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    const GUTTER = 16; // same breathing room as the shell's px-4 sides
    const apply = () => {
      if (window.innerWidth >= 640) { el.style.height = ''; el.style.flexBasis = ''; return; }
      const card = el.parentElement;
      const cardRect = card.getBoundingClientRect();
      const padBottom = Math.round(cardRect.bottom - el.getBoundingClientRect().bottom);
      const docTop = Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY));
      const size = `calc(100dvh - ${docTop + padBottom}px - max(${GUTTER}px, env(safe-area-inset-bottom, 0px)))`;
      // The panel is a `flex: 1` item (flex-basis 0) in the card's auto-height
      // column — there, `height` is ignored for the main axis, so the panel
      // was collapsing to its min-height. flex-basis is what actually sizes a
      // flex item; height stays as a belt-and-braces for non-flex fallbacks.
      el.style.height = size;
      el.style.flexBasis = size;
      el.style.minHeight = '280px';
    };
    // Size immediately so the first paint already fills, then re-measure after
    // the view-push transition settles (its stage can skew rects mid-flight).
    const r = requestAnimationFrame(apply);
    const t = setTimeout(apply, 600);
    const t2 = setTimeout(apply, 900);
    window.addEventListener('resize', apply);
    return () => { cancelAnimationFrame(r); clearTimeout(t); clearTimeout(t2); window.removeEventListener('resize', apply); el.style.height = ''; el.style.flexBasis = ''; el.style.minHeight = ''; };
  }, []);

  // Base overlay — countries, routes, transport glyphs. Deliberately NOT keyed on
  // `selected`: tapping a pin used to rebuild this whole layer (re-parsing all of
  // Europe's polygons + every route), which hitched on every tap. Selection lives
  // in the lightweight pins effect below.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!stops.length) return;

    const latlngs = stops.map((s) => [s.lat, s.lng]);
    const visitedCountries = new Set(stops.map((s) => s.country).filter(Boolean));

    // Draw every country as a polygon: visited = warm trip land, the rest grey.
    // Because the land itself is the vector (no raster tiles underneath), the
    // coastline is one consistent source — crisp, no jagged overlay mismatch.
    if (countryGeojson) {
      L.geoJSON(countryGeojson, {
        interactive: false,
        style: (feature) => landStyle(dark, isVisitedCountry(feature, visitedCountries)),
      }).addTo(layer);

      // Country name labels (the basemap used to carry these). Skip tiny
      // countries so the map doesn't clutter. They live in the 'countryLabels'
      // pane, which sits below the stop pins so a label never covers a pin.
      countryGeojson.features.forEach((f) => {
        const pt = countryLabelPoint(f.geometry);
        const name = f.properties && (f.properties.NAME || f.properties.ADMIN);
        if (!pt || !name || pt.span < 4) return;
        L.marker([pt.lat, pt.lng], {
          interactive: false,
          pane: 'countryLabels',
          icon: L.divIcon({ className: 'scandi-country-label', html: `<span>${name}</span>`, iconSize: [0, 0] }),
        }).addTo(layer);
      });
    }

    // Major reference cities (dot + name) — in BOTH visited and non-visited
    // countries — drawn into their own layer that only shows when zoomed in.
    // Skip any that coincide with a trip stop (those already have a pin + label).
    const cityLayer = cityLayerRef.current;
    if (cities && cityLayer) {
      cityLayer.clearLayers();
      cities.forEach((c) => {
        const near = stops.some((s) => Math.abs(s.lat - c.lat) < 0.5 && Math.abs(s.lng - c.lng) < 0.7);
        if (near) return;
        L.marker([c.lat, c.lng], {
          interactive: false,
          icon: L.divIcon({
            className: 'scandi-city',
            html: `<span><span class="scandi-city-dot"></span><span class="scandi-city-name">${c.n}</span></span>`,
            iconSize: [0, 0],
          }),
        }).addTo(cityLayer);
      });
      syncCityZoom();
    }

    // Per-leg route segments so hovering any line shows that leg's selected
    // method and duration instead of one generic whole-trip route.
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i]; const b = stops[i + 1];
      const t = resolveTransport(a, b);
      const segment = [[a.lat, a.lng], [b.lat, b.lng]];
      const tip = travelTooltip(t);
      // Two-tone route: a wide soft casing + a narrow flowing dash on top that
      // carries the direction-of-travel cue (.scandi-route-flow drifts a → b).
      // Light: cool-blue casing + deep-blue dashes. Dark: the cold blue worm
      // read as out of place on the warm night map, so it's a faint light-sage
      // glow casing with a bright sage dash that fits the theme and pops.
      const casing = dark
        ? { color: '#e7f0e0', weight: 9, opacity: 0.18, lineJoin: 'round' }
        : { color: '#bcdae6', weight: 9, opacity: 0.9, lineJoin: 'round' };
      const flow = dark
        ? { color: '#cfe3bf', weight: 3, opacity: 1, dashArray: '2 8', className: 'scandi-route-flow' }
        : { color: '#2f6a89', weight: 3, opacity: 0.95, dashArray: '2 8', className: 'scandi-route-flow' };
      L.polyline(segment, casing)
        .bindTooltip(tip, { direction: 'top', sticky: true })
        .addTo(layer);
      L.polyline(segment, flow)
        .bindTooltip(tip, { direction: 'top', sticky: true })
        .addTo(layer);

      // Transport icons at segment midpoints, facing the direction of travel
      // (the badge circle stays put; only the glyph inside rotates/flips).
      // Midpoint + bearing come from the projected line so the badge sits ON
      // the drawn route and the glyph points exactly along it; border-box
      // keeps the 22px badge true to its [11,11] anchor despite the border.
      const { mid, bearing } = legGeometry(map, a, b);
      // Custom glyph (same source as the timeline nodes), tinted for the map's
      // theme and rotated to face the direction of travel, inside the bubble.
      const glyphColor = dark ? '#f1ece2' : '#3a352c';
      const tf = transportGlyphTransform(t.mode, bearing);
      const glyph = `<span class="gg-node-emoji" style="color:${glyphColor}"><span class="transport-map-glyph"${tf ? ` style="transform:${tf}"` : ''}>${transportGlyphSvg(t.mode)}</span></span>`;
      L.marker(mid, {
        interactive: true,
        icon: L.divIcon({
          className: 'scandi-transport',
          html: `<div class="gg-node gg-rim">${glyph}<span class="gg-node-lens" aria-hidden="true"></span></div>`,
          iconSize: [30, 30], iconAnchor: [15, 15],
        }),
      }).bindTooltip(tip, { direction: 'top', offset: [0, -14] }).addTo(layer);
    }

    // Fit when stops change. Selecting a pin should update the marker/card only:
    // refitting or panning makes the map visibly jump under the user's finger.
    const countChanged = prevCountRef.current !== stops.length;
    if (countChanged) prevCountRef.current = stops.length;
    if (countChanged) fitTripBounds(latlngs, false);
  }, [stops, dark, countryGeojson, cities]);

  // City pins + name labels. Lightweight, so re-running on selection (to move the
  // highlight) is cheap and never rebuilds the country/route overlay above.
  useEffect(() => {
    const layer = pinLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!stops.length) return;
    stops.forEach((s, i) => {
      const past = isStopPast(s);
      // Always-visible name label; the pin itself already carries the number.
      const m = L.marker([s.lat, s.lng], { icon: pinIcon(i, s.id === selected, past, dark), zIndexOffset: s.id === selected ? 1000 : 0 })
        .addTo(layer)
        .bindTooltip(`${s.name}${past ? ' · past' : ''}`, {
          // Hug the pin: the arrow tip lands ~8px above center, putting the
          // label box right against the 28px pin's top edge.
          permanent: true, direction: 'top', offset: [0, -8],
          className: `scandi-maplabel scandi-maplabel-stop${past ? ' scandi-maplabel-past' : ''}`,
        });
      m.on('click', () => { setSelected(s.id); });
    });
  }, [stops, selected, dark]);

  const selStop = stops.find((s) => s.id === selected) || null;
  const selIndex = stops.findIndex((s) => s.id === selected);

  return html`<div class="bg-white border border-[1.5px] border-[#1a1714] rounded-[3px] p-2 sm:p-3 relative map-view-shell">
    ${!stops.length && html`<div class="absolute inset-0 z-[1000] grid place-items-center bg-stone-50 rounded-[3px] text-center text-slate-500 pointer-events-none">
      <div><div class="mb-2 flex justify-center text-slate-400"><${IconMap} className="w-9 h-9" /></div>Add stops to see them mapped across Scandinavia.</div>
    </div>`}
    <div ref=${elRef} class="w-full rounded-[2px] overflow-hidden border border-[1.5px] border-[#1a1714] scandi-map-panel"
      style=${{ opacity: revealed ? 1 : 0 }}></div>
    ${stops.length >= 2 && html`<button type="button" onClick=${() => setStoryOpen(true)} aria-label="Play flyover" title="Play flyover"
      class="story-launch">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l10 7-10 7z"/></svg>
    </button>`}
    ${storyOpen && html`<${StoryMode} stops=${stops} onClose=${() => setStoryOpen(false)} />`}
    ${selStop && html`<${FocusCard} stop=${selStop} index=${selIndex} total=${stops.length}
      prevStop=${selIndex > 0 ? stops[selIndex - 1] : null}
      nextStop=${selIndex < stops.length - 1 ? stops[selIndex + 1] : null}
      onOpen=${(id) => onOpenStop && onOpenStop(id)} onClose=${() => setSelected(null)} />`}
  </div>`;
}

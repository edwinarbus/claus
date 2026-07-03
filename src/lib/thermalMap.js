// Compose a static day map into a <canvas> for the thermal receipt: CARTO
// light_nolabels tiles for the day's bounding box, then the numbered route,
// pins, and labels drawn on top. Returned canvas is later dithered to 1-bit
// (escpos.js), so the map actually prints — the little riso-grain look is a
// feature on thermal paper.
//
// light_nolabels (the minimal Positron basemap) reduces to clean faint stipple
// under error diffusion, letting the solid-black route + pins carry the image.
// Always light regardless of app theme; tiles are keyless + CORS-enabled, so the
// canvas stays untainted and getImageData works.

const TILE = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png';
const TS = 256;

function project(lat, lng, z) {
  const scale = TS * (2 ** z);
  const x = ((lng + 180) / 360) * scale;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
}

function fitZoom(b, width, height, minZoom, maxZoom, pad) {
  for (let z = maxZoom; z >= minZoom; z -= 1) {
    const a = project(b.north, b.west, z);
    const c = project(b.south, b.east, z);
    if (Math.abs(c.x - a.x) <= width * (1 - pad) && Math.abs(c.y - a.y) <= height * (1 - pad)) return z;
  }
  return minZoom;
}

function loadTile(z, sx, sy, subIdx) {
  const maxTile = 2 ** z;
  const wrapX = ((sx % maxTile) + maxTile) % maxTile;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ img, sx, sy });
    img.onerror = () => resolve({ img: null, sx, sy });
    img.src = TILE
      .replace('{s}', 'abcd'[subIdx % 4])
      .replace('{z}', z).replace('{x}', wrapX).replace('{y}', sy);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * @param points [{ lat, lng, n?, label?, home? }] in route order. `n` numbers a
 *   route stop; `home` draws the lodging marker instead.
 * @returns Promise<HTMLCanvasElement|null> (null if nothing mappable, or if the
 *   tiles tainted the canvas so it couldn't be read back).
 */
export async function renderDayMapCanvas(points, opts = {}) {
  const pts = (points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!pts.length) return null;
  const {
    width = 516, height = 300, minZoom = 9, maxZoom = 15, pad = 0.34, scale = 2,
  } = opts;

  const W = width * scale;   // render at 2× then downscale into the receipt: crisper.
  const H = height * scale;

  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const bounds = {
    north: Math.max(...lats), south: Math.min(...lats),
    east: Math.max(...lngs), west: Math.min(...lngs),
  };
  const single = pts.length === 1 || (bounds.north === bounds.south && bounds.east === bounds.west);
  const z = single ? 14 : fitZoom(bounds, W, H, minZoom, maxZoom, pad);

  const center = { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 };
  const c = project(center.lat, center.lng, z);
  const originX = c.x - W / 2; // world px at the canvas's top-left
  const originY = c.y - H / 2;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Fetch the tiles covering the viewport.
  const x0 = Math.floor(originX / TS);
  const x1 = Math.floor((originX + W) / TS);
  const y0 = Math.floor(originY / TS);
  const y1 = Math.floor((originY + H) / TS);
  const maxTile = 2 ** z;
  const jobs = [];
  let idx = 0;
  for (let tx = x0; tx <= x1; tx += 1) {
    for (let ty = y0; ty <= y1; ty += 1) {
      if (ty < 0 || ty >= maxTile) continue;
      jobs.push(loadTile(z, tx, ty, idx));
      idx += 1;
    }
  }
  const tiles = await Promise.all(jobs);
  ctx.imageSmoothingEnabled = true;
  tiles.forEach((t) => {
    if (!t || !t.img) return;
    ctx.drawImage(t.img, Math.round(t.sx * TS - originX), Math.round(t.sy * TS - originY), TS, TS);
  });

  // A whisper of white lifts the basemap so black ink pins/labels dominate.
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(0, 0, W, H);

  const toXY = (p) => { const w = project(p.lat, p.lng, z); return { x: w.x - originX, y: w.y - originY }; };
  const route = pts.filter((p) => Number.isFinite(p.n)).map(toXY);

  // Route line through the numbered stops (white casing under black dashes so it
  // survives dithering over dark map features).
  if (route.length > 1) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 5 * scale;
    ctx.beginPath();
    route.forEach((r, k) => (k ? ctx.lineTo(r.x, r.y) : ctx.moveTo(r.x, r.y)));
    ctx.stroke();
    ctx.strokeStyle = '#0b0b0b';
    ctx.lineWidth = 2.4 * scale;
    ctx.setLineDash([2 * scale, 5 * scale]);
    ctx.beginPath();
    route.forEach((r, k) => (k ? ctx.lineTo(r.x, r.y) : ctx.moveTo(r.x, r.y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const R = 14 * scale;
  const font = (px, w = 700) => `${w} ${px * scale}px Outfit, ui-sans-serif, sans-serif`;

  // Labels first (under pins) so pins sit on top of any overlap.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  pts.forEach((p) => {
    if (!p.label) return;
    const { x, y } = toXY(p);
    const text = p.label.length > 20 ? `${p.label.slice(0, 19)}…` : p.label;
    ctx.font = font(11, 600);
    const bw = ctx.measureText(text).width + 12 * scale;
    const bh = 19 * scale;
    const bx = x - bw / 2;
    const by = y + R + 3 * scale;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0b0b0b';
    ctx.lineWidth = 1.2 * scale;
    roundRect(ctx, bx, by, bw, bh, 3 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0b0b0b';
    ctx.fillText(text, x, by + bh / 2 + 0.5 * scale);
  });

  // Pins.
  pts.forEach((p) => {
    const { x, y } = toXY(p);
    if (p.home) {
      const s = R * 1.7;
      ctx.fillStyle = '#0b0b0b';
      roundRect(ctx, x - s / 2, y - s / 2, s, s, 3 * scale);
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * scale; roundRect(ctx, x - s / 2, y - s / 2, s, s, 3 * scale); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = font(14, 800);
      ctx.fillText('⌂', x, y + 1 * scale);
      return;
    }
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0b0b';
    ctx.fill();
    ctx.lineWidth = 2.4 * scale;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    if (Number.isFinite(p.n)) {
      ctx.fillStyle = '#fff';
      ctx.font = font(14, 800);
      ctx.fillText(String(p.n), x, y + 0.5 * scale);
    }
  });

  // If tiles tainted the canvas (a CDN without CORS), reading it back throws —
  // signal null so the receipt prints cleanly without the map instead of failing.
  try { ctx.getImageData(0, 0, 1, 1); } catch { return null; }
  return canvas;
}

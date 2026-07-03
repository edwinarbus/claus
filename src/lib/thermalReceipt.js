// Draw the whole daily briefing onto a 576-dot-wide canvas for the Epson: Claus
// masthead, the date + a drawn weather glyph, the parsed brief (slot/transit
// bolds print as inverted ticket badges, matching the on-screen receipt), the
// composed day map, a few local phrases, and a cute footer. escpos.js then
// dithers it to 1-bit and the bridge relays it to the printer.

import { renderDayMapCanvas } from './thermalMap.js';
import { phrasesForCountry } from '../data/phrases.js';
import { RASTER_WIDTH } from './escpos.js';

const W = RASTER_WIDTH;      // 576
const M = 30;                // side margin
const CW = W - M * 2;        // content width
const INK = '#0b0b0b';
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const SANS = "Outfit, ui-sans-serif, system-ui, sans-serif";
const SERIF = "Fraunces, Georgia, serif";

// ---- tiny markdown → blocks -------------------------------------------------

function parseBrief(md) {
  const blocks = [];
  String(md || '').split('\n').forEach((line) => {
    const t = line.trim();
    if (!t) return;
    if (/^---+$/.test(t)) { blocks.push({ type: 'rule' }); return; }
    const h = t.match(/^#{1,4}\s+(.*)$/);
    if (h) { blocks.push({ type: 'head', text: h[1].replace(/\s*[◆·]\s*$/, '') }); return; }
    const b = t.match(/^[-*]\s+(.*)$/);
    blocks.push({ type: b ? 'bullet' : 'para', segs: splitBold(b ? b[1] : t) });
  });
  return blocks;
}

// "**M3** to Nørreport" → [{text:'M3',bold:true},{text:' to Nørreport'}]
function splitBold(s) {
  const segs = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) segs.push({ text: s.slice(last, m.index), bold: false });
    segs.push({ text: m[1], bold: true });
    last = re.lastIndex;
  }
  if (last < s.length) segs.push({ text: s.slice(last), bold: false });
  return segs.length ? segs : [{ text: s, bold: false }];
}

// ---- little vector ornaments ------------------------------------------------

function weatherGlyph(ctx, cx, cy, r, cond) {
  const c = cond.toLowerCase();
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  const rain = /rain|shower|drizzle/.test(c);
  const cloud = /cloud|overcast|grey|gray|fog|mist/.test(c);
  if (!cloud && !rain) { // sun
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
      ctx.lineTo(cx + Math.cos(a) * r * 1.15, cy + Math.sin(a) * r * 1.15);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  // cloud
  ctx.beginPath();
  ctx.arc(cx - r * 0.45, cy, r * 0.5, Math.PI * 0.5, Math.PI * 1.5);
  ctx.arc(cx - r * 0.1, cy - r * 0.35, r * 0.55, Math.PI, Math.PI * 2);
  ctx.arc(cx + r * 0.5, cy - r * 0.15, r * 0.45, Math.PI * 1.5, Math.PI * 0.5);
  ctx.lineTo(cx - r * 0.45, cy + r * 0.5);
  ctx.stroke();
  if (rain) {
    for (let i = -1; i <= 1; i += 1) {
      ctx.beginPath();
      ctx.moveTo(cx + i * r * 0.35, cy + r * 0.6);
      ctx.lineTo(cx + i * r * 0.35 - r * 0.12, cy + r * 1.05);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function heart(ctx, cx, cy, s) {
  ctx.save();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.3);
  ctx.bezierCurveTo(cx - s, cy - s * 0.5, cx - s * 0.5, cy - s, cx, cy - s * 0.35);
  ctx.bezierCurveTo(cx + s * 0.5, cy - s, cx + s, cy - s * 0.5, cx, cy + s * 0.3);
  ctx.fill();
  ctx.restore();
}

// ---- main -------------------------------------------------------------------

export async function renderReceiptCanvas({
  brief, country, mapPoints = [], dayIndex = 0, dayTotal = 0, nowLabel = '',
} = {}) {
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch { /* ignore */ } }

  // Compose the map first (async tile loads) so we can slot it inline.
  let mapCanvas = null;
  try { mapCanvas = await renderDayMapCanvas(mapPoints, { width: CW, height: 300 }); } catch { mapCanvas = null; }

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = 5000; // oversized; cropped to fit at the end
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, cv.height);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';

  const setLS = (px) => { try { ctx.letterSpacing = `${px}px`; } catch { /* older canvas */ } };
  const center = (text, y) => { ctx.textAlign = 'center'; ctx.fillText(text, W / 2, y); };
  const dashed = (y) => {
    ctx.save();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
    ctx.restore();
  };

  let y = 46;

  // Masthead — Claus wordmark + double rule.
  ctx.fillStyle = INK; setLS(0);
  ctx.font = `800 66px ${SERIF}`;
  center('Claus', y); y += 20;
  ctx.font = `700 15px ${SANS}`; setLS(6);
  center('· D A I L Y   B R I E F I N G ·', y); y += 22;
  ctx.font = `400 12px ${SANS}`; setLS(2);
  center('PREPARED OVERNIGHT · CLAUDE MANAGED AGENTS', y); y += 16;
  setLS(0);
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(M, y + 4); ctx.lineTo(W - M, y + 4); ctx.stroke();
  y += 34;

  const blocks = parseBrief(brief);
  let titleDone = false;
  let weatherPending = false; // the one para right after the title is the weather line

  const drawSectionHead = (text) => {
    ctx.fillStyle = INK; ctx.font = `800 20px ${MONO}`; setLS(3);
    center(`◆ ${text} ◆`, y); setLS(0); y += 26;
  };

  // Word/badge layout for a bullet or paragraph line.
  const drawFlow = (segs, startX, indentX, maxX, bullet) => {
    const lineH = 30;
    let x = startX;
    if (bullet) {
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(startX + 3, y - 7, 3, 0, Math.PI * 2); ctx.fill();
      x = startX + 16; indentX = startX + 16;
    }
    const tokens = [];
    segs.forEach((sg) => {
      if (sg.bold) tokens.push({ bold: true, text: sg.text.trim() });
      else sg.text.split(/(\s+)/).forEach((w) => { if (w.length) tokens.push({ bold: false, text: w }); });
    });
    ctx.textAlign = 'left';
    tokens.forEach((tk) => {
      if (tk.bold) {
        ctx.font = `700 21px ${MONO}`;
        const tw = ctx.measureText(tk.text).width;
        const bw = tw + 12;
        if (x + bw > maxX && x > indentX) { y += lineH; x = indentX; }
        ctx.fillStyle = INK;
        // rounded chip
        const bh = 26; const by = y - 20;
        ctx.beginPath();
        const r = 4;
        ctx.moveTo(x + r, by); ctx.arcTo(x + bw, by, x + bw, by + bh, r);
        ctx.arcTo(x + bw, by + bh, x, by + bh, r); ctx.arcTo(x, by + bh, x, by, r);
        ctx.arcTo(x, by, x + bw, by, r); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(tk.text, x + 6, y);
        ctx.fillStyle = INK;
        x += bw + 3;
      } else {
        ctx.font = `400 22px ${MONO}`;
        const tw = ctx.measureText(tk.text).width;
        if (/^\s+$/.test(tk.text)) { x += tw; return; }
        if (x + tw > maxX && x > indentX) { y += lineH; x = indentX; }
        ctx.fillStyle = INK; ctx.fillText(tk.text, x, y);
        x += tw;
      }
    });
    y += lineH;
  };

  blocks.forEach((blk) => {
    if (blk.type === 'rule') { weatherPending = false; y += 4; dashed(y); y += 20; return; }
    if (blk.type === 'head') {
      if (!titleDone) {
        titleDone = true;
        weatherPending = true;
        ctx.fillStyle = INK; setLS(1);
        let ts = 27; ctx.font = `800 ${ts}px ${MONO}`;
        while (ts > 15 && ctx.measureText(blk.text).width > CW) { ts -= 1; ctx.font = `800 ${ts}px ${MONO}`; }
        center(blk.text, y); setLS(0); y += 30;
      } else {
        weatherPending = false;
        drawSectionHead(blk.text);
      }
      return;
    }
    if (blk.type === 'para') {
      // The one paragraph right under the title is the weather line: draw it
      // centered as glyph + text as a single group.
      if (weatherPending) {
        weatherPending = false;
        const text = blk.segs.map((s) => s.text).join('');
        const gsz = 13; const gap = 12;
        let ws = 20; ctx.font = `400 ${ws}px ${MONO}`;
        while (ws > 12 && gsz * 2 + gap + ctx.measureText(text).width > CW) { ws -= 1; ctx.font = `400 ${ws}px ${MONO}`; }
        const total = gsz * 2 + gap + ctx.measureText(text).width;
        const sx = W / 2 - total / 2;
        // Match only the leading condition (before the first "·"), so a later
        // clause like "Rain clears by noon" doesn't flip a sunny day to rain.
        weatherGlyph(ctx, sx + gsz, y - 7, gsz, text.split('·')[0]);
        ctx.textAlign = 'left'; ctx.fillStyle = INK;
        ctx.fillText(text, sx + gsz * 2 + gap, y);
        y += 32;
        return;
      }
      drawFlow(blk.segs, M, M, W - M, false);
      return;
    }
    weatherPending = false;
    // bullet
    drawFlow(blk.segs, M, M, W - M, true);
  });

  // The day map.
  if (mapCanvas) {
    y += 8; dashed(y); y += 22;
    ctx.fillStyle = INK; ctx.font = `800 20px ${MONO}`; setLS(3);
    center('❉ THE DAY ❉', y); setLS(0); y += 20;
    const mh = Math.round((mapCanvas.height / mapCanvas.width) * CW);
    ctx.drawImage(mapCanvas, M, y, CW, mh);
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(M, y, CW, mh);
    y += mh + 30;
  }

  // Local phrases.
  const ph = phrasesForCountry(country);
  if (ph) {
    y += 4; dashed(y); y += 22;
    ctx.fillStyle = INK; ctx.font = `800 20px ${MONO}`; setLS(2);
    center(`SAY IT IN ${ph.lang.toUpperCase()}`, y); setLS(0); y += 30;
    ph.items.forEach(([en, loc]) => {
      ctx.textAlign = 'left'; ctx.font = `700 22px ${MONO}`; ctx.fillStyle = INK;
      ctx.fillText(loc, M + 6, y);
      ctx.textAlign = 'right'; ctx.font = `400 18px ${SANS}`;
      ctx.fillText(en, W - M - 6, y);
      y += 30;
    });
    y += 4;
  }

  // Cute footer.
  y += 6; dashed(y); y += 26;
  ctx.textAlign = 'center'; ctx.fillStyle = INK;
  heart(ctx, W / 2 - 74, y - 6, 7);
  ctx.font = `700 18px ${SANS}`; setLS(3);
  ctx.fillText('TYLER  &  EDWIN', W / 2, y);
  heart(ctx, W / 2 + 74, y - 6, 7);
  setLS(0); y += 26;
  if (dayIndex > 0 && dayTotal > 0) {
    ctx.font = `400 15px ${SANS}`; setLS(2);
    center(`DAY ${dayIndex} OF ${dayTotal}  ·  SCANDINAVIA & THE BALTICS`, y); setLS(0); y += 22;
  }
  if (nowLabel) { ctx.font = `400 14px ${MONO}`; center(nowLabel, y); y += 20; }
  y += 10;

  // Crop to the used height.
  const h = Math.min(cv.height, y);
  const out = document.createElement('canvas');
  out.width = W; out.height = h;
  out.getContext('2d').drawImage(cv, 0, 0);
  return out;
}

// Turn a rendered <canvas> into an ESC/POS byte stream the Epson TM-m30II can
// print. Everything on the receipt — text, the day map, the local phrases — is
// rasterized in the browser and dithered here, so what prints is exactly what we
// drew (and Scandinavian glyphs need no code-page dance). The bytes go to the
// local print bridge (scripts/printbridge.py), which just relays them.
//
// TM-m30II: 80mm paper, 72mm / 576-dot printable width @ 203dpi. Render your
// canvas at width 576 for edge-to-edge output.

const RASTER_WIDTH = 576;

function concatBytes(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Floyd–Steinberg dither the canvas to 1-bit, then pack into one or more GS v 0
// raster commands (banded, so a tall receipt never overflows the print buffer).
function rasterBands(canvas, band = 128) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, w, h);

  // Grayscale, compositing any transparency over white (thermal paper).
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const a = data[i * 4 + 3] / 255;
    const lum = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * a
      + 255 * (1 - a);
    gray[i] = lum;
  }

  // Error-diffusion to a black(1)/white(0) map.
  const mono = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const on = gray[i] < 128;
      mono[i] = on ? 1 : 0;
      const err = gray[i] - (on ? 0 : 255);
      if (x + 1 < w) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) gray[i + w - 1] += (err * 3) / 16;
        gray[i + w] += (err * 5) / 16;
        if (x + 1 < w) gray[i + w + 1] += (err * 1) / 16;
      }
    }
  }

  const bytesPerRow = Math.ceil(w / 8);
  const bands = [];
  for (let y0 = 0; y0 < h; y0 += band) {
    const rows = Math.min(band, h - y0);
    const cmd = new Uint8Array(8 + rows * bytesPerRow);
    cmd[0] = 0x1d; cmd[1] = 0x76; cmd[2] = 0x30; cmd[3] = 0x00; // GS v 0 m=0
    cmd[4] = bytesPerRow & 0xff; cmd[5] = (bytesPerRow >> 8) & 0xff; // xL xH
    cmd[6] = rows & 0xff; cmd[7] = (rows >> 8) & 0xff; // yL yH
    let p = 8;
    for (let y = 0; y < rows; y += 1) {
      const rowBase = (y0 + y) * w;
      for (let bx = 0; bx < bytesPerRow; bx += 1) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const x = bx * 8 + bit;
          if (x < w && mono[rowBase + x]) byte |= (0x80 >> bit);
        }
        cmd[p] = byte; p += 1;
      }
    }
    bands.push(cmd);
  }
  return bands;
}

/** Full print job: init · raster · feed · partial cut (repeated per copy). */
export function canvasToEscpos(canvas, { copies = 1 } = {}) {
  const init = Uint8Array.from([0x1b, 0x40]); // ESC @  reset
  // Feed 4 lines (~17mm) so the content clears the autocutter (which sits ~1.5cm
  // downstream of the print head) before GS V 66 makes a partial cut.
  const feedCut = Uint8Array.from([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00]);
  const bands = rasterBands(canvas);
  const parts = [];
  for (let c = 0; c < Math.max(1, copies); c += 1) {
    parts.push(init, ...bands, feedCut);
  }
  return concatBytes(parts);
}

/** Base64 for the JSON body the bridge expects. */
export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(bin);
}

export { RASTER_WIDTH };

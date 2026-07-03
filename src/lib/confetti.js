// Lightweight, dependency-free celebration effects for success moments — a
// canvas confetti burst plus a soft radial "pop". One-shot: each call spins up
// its own overlay canvas, animates on rAF, and removes itself when done. Honors
// prefers-reduced-motion (no-op), so it only ever adds delight.

const COLORS = ['#3E7BB6', '#F4A623', '#34A853', '#EA4335', '#9B6BD8', '#23B5C9', '#F26FA6'];

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

function makeOverlay() {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  Object.assign(canvas.style, {
    position: 'fixed', left: '0', top: '0', width: `${w}px`, height: `${h}px`,
    pointerEvents: 'none', zIndex: '4000',
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { canvas, ctx, w, h };
}

// Confetti burst. `x`/`y` are the launch origin in viewport px (defaults to the
// upper third, centered). `count` scales the celebration's intensity.
export function confetti({ x, y, count = 90, power = 1, spreadDeg = 360 } = {}) {
  if (typeof document === 'undefined' || reducedMotion()) return;
  const { canvas, ctx, w, h } = makeOverlay();
  const ox = x == null ? w / 2 : x;
  const oy = y == null ? h * 0.32 : y;

  const parts = [];
  for (let i = 0; i < count; i++) {
    // Bias upward (-90°) so confetti pops up and rains down, with a wide spread.
    const base = -Math.PI / 2;
    const a = base + ((Math.random() - 0.5) * (spreadDeg * Math.PI / 180));
    const speed = (4 + Math.random() * 7) * power;
    parts.push({
      x: ox, y: oy,
      vx: Math.cos(a) * speed + (Math.random() - 0.5) * 2,
      vy: Math.sin(a) * speed - Math.random() * 3,
      s: 5 + Math.random() * 6,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      wob: Math.random() * Math.PI * 2,
      life: 1,
      decay: 0.006 + Math.random() * 0.006,
      ratio: 0.45 + Math.random() * 0.5,
    });
  }

  const start = performance.now();
  let raf = 0;
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    let alive = 0;
    for (const p of parts) {
      p.vy += 0.16 * power;        // gravity
      p.vx *= 0.985;               // air drag
      p.vy *= 0.985;
      p.wob += 0.1;
      p.x += p.vx + Math.cos(p.wob) * 0.6;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= p.decay;
      if (p.life > 0 && p.y < h + 30) {
        alive++;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.s / 2, -(p.s * p.ratio) / 2, p.s, p.s * p.ratio);
        ctx.restore();
      }
    }
    if (alive > 0 && t < 4000) {
      raf = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  }
  raf = requestAnimationFrame(frame);
}

// A soft expanding ring centered on a point — a quiet success accent that pairs
// with (or stands in for) confetti on smaller moments.
export function successPop({ x, y, color = '#34A853' } = {}) {
  if (typeof document === 'undefined' || reducedMotion()) return;
  const ring = document.createElement('div');
  Object.assign(ring.style, {
    position: 'fixed', left: `${x}px`, top: `${y}px`, width: '14px', height: '14px',
    marginLeft: '-7px', marginTop: '-7px', borderRadius: '9999px',
    border: `2px solid ${color}`, pointerEvents: 'none', zIndex: '4000',
    opacity: '0.9',
  });
  document.body.appendChild(ring);
  ring.animate(
    [
      { transform: 'scale(0.4)', opacity: 0.9 },
      { transform: 'scale(3.2)', opacity: 0 },
    ],
    { duration: 520, easing: 'cubic-bezier(0.22,1,0.36,1)' },
  ).onfinish = () => ring.remove();
}

// Convenience: celebrate centered on an element (or the viewport if absent).
export function celebrate(el, opts = {}) {
  let origin = {};
  if (el && el.getBoundingClientRect) {
    const r = el.getBoundingClientRect();
    origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  confetti({ ...origin, ...opts });
  if (origin.x != null) successPop({ x: origin.x, y: origin.y });
}

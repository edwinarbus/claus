import { useRef } from '../html.js';

// Horizontal swipe → switch view (timeline ↔ calendar ↔ map), mobile only.
// A decisive, fast, horizontal-dominant flick triggers the existing paged slide.
// Guards: ignores form controls and opt-outs (`data-swipe-ignore`), vertical
// scrolls, and in-progress item drags. The Leaflet map owns horizontal drags
// (panning), so on the map only a left-edge swipe navigates back — everything
// else pans, the way a native map inside a pager behaves.
const SWIPE_MIN_PX = 56;   // min horizontal travel to count as a swipe
const SWIPE_MAX_MS = 600;  // must be a flick, not a slow scrub
const H_RATIO = 1.4;       // horizontal must dominate vertical by this much
const EDGE_PX = 30;        // left-edge zone that escapes the map

export function useSwipeNav({ onNext, onPrev }) {
  const start = useRef(null);

  function onTouchStart(e) {
    if (!e.touches || e.touches.length !== 1) { start.current = null; return; }
    const t = e.touches[0];
    const el = e.target;
    if (el && el.closest && el.closest('input, textarea, select, button, a, [contenteditable], [data-swipe-ignore]')) {
      start.current = null;
      return;
    }
    const onMap = !!(el && el.closest && el.closest('.leaflet-container'));
    start.current = { x: t.clientX, y: t.clientY, at: Date.now(), onMap, fromEdge: t.clientX <= EDGE_PX };
  }

  function onTouchEnd(e) {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Date.now() - s.at > SWIPE_MAX_MS) return;
    if (Math.abs(dx) < SWIPE_MIN_PX) return;
    if (Math.abs(dx) < Math.abs(dy) * H_RATIO) return;        // too vertical
    if (document.querySelector('.is-dragging')) return;        // mid item-drag
    // On the map, only a left-edge rightward swipe leaves it; other drags pan.
    if (s.onMap && !(dx > 0 && s.fromEdge)) return;
    if (dx < 0) onNext && onNext();
    else onPrev && onPrev();
  }

  return { onTouchStart, onTouchEnd };
}

import { useState, useEffect } from '../html.js';

// Presence helper for content that should slide open AND shut. React unmounts a
// `${cond && …}` branch instantly, which kills any close animation — so we keep
// the node mounted for `ms` after `open` flips false, and expose `shown` (the
// `is-open` class flag, toggled one frame after mount so the CSS transition
// runs). Pair with the `.reveal` class.
//
//   const { mounted, shown } = useReveal(open);
//   ${mounted && html`<div class=${`reveal ${shown ? 'is-open' : ''}`}><div>…</div></div>`}
//
// `settled` flips true once the open animation has finished — add it as an
// `is-settled` class so the CSS can drop the animating `grid-template-rows: 1fr`
// for plain `auto`. Without that, Safari can leave the grid row at a stale
// (too-tall) height after the 0fr→1fr transition until a scroll forces a reflow.
export function useReveal(open, ms = 320) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  const [settled, setSettled] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two frames: let the just-mounted *closed* state paint before flipping to
      // open, so the very FIRST open actually transitions. (One frame wasn't
      // enough — the first open jumped, only the second animated.)
      let r2 = 0;
      const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setShown(true)); });
      const st = setTimeout(() => setSettled(true), ms + 40);
      return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); clearTimeout(st); };
    }
    setShown(false);
    setSettled(false);
    const tm = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(tm);
  }, [open]);
  return { mounted, shown, settled };
}

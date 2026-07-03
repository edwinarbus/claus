// A small, reliable hover/focus/tap tooltip. The native `title` attribute is
// slow, inconsistent, and never shows on touch — this renders a styled bubble
// through a portal so it can't be clipped by `overflow-hidden` ancestors and
// always appears. Positions itself above the trigger, flipping below and
// clamping to the viewport as needed.
import { html, useState, useRef, useLayoutEffect } from '../html.js';
import { createPortal } from 'react-dom';

const MARGIN = 8;

export function Tooltip({ label, children, className = '' }) {
  const anchorRef = useRef(null);
  const bubbleRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, ready: false });

  const show = () => setOpen(true);
  const hide = () => { setOpen(false); setPos((p) => ({ ...p, ready: false })); };

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const a = anchor.getBoundingClientRect();
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    let left = a.left + a.width / 2 - bw / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - bw - MARGIN));
    let top = a.top - bh - 8; // prefer above the trigger
    if (top < MARGIN) top = a.bottom + 8; // not enough room → flip below
    setPos({ top, left, ready: true });
  }, [open]);

  return html`<span ref=${anchorRef}
    class=${`inline-flex ${className}`}
    tabindex="0"
    onMouseEnter=${show} onMouseLeave=${hide}
    onFocus=${show} onBlur=${hide}
    onClick=${(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
    ${children}
    ${open && label && createPortal(
      html`<div ref=${bubbleRef} role="tooltip"
        style=${{ position: 'fixed', top: `${pos.top}px`, left: `${pos.left}px`, visibility: pos.ready ? 'visible' : 'hidden', textWrap: 'balance' }}
        class="z-[1200] pointer-events-none max-w-[11rem] text-center gg-tooltip rounded-[2px] border-[1.5px] border-[#1a1714] bg-[#1a1714] text-[#f4f3ee] text-[11px] font-semibold leading-snug px-2.5 py-1.5 gg-pop-in">
        ${label}
      </div>`,
      document.body)}
  </span>`;
}

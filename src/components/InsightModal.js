import { html, useState, useEffect, useRef } from '../html.js';

// Detail behind a trip-health pill: tapping "6 legs to book" opens this glass
// panel listing the SPECIFIC legs/nights/days, instead of teleporting the page
// to the first one. Same floating-glass language as the welcome screen. Rows
// are tappable and jump to their item (then close).
export function InsightModal({ title, icon, rows = [], onJump, onClose }) {
  const [shown, setShown] = useState(false);
  const [exiting, setExiting] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => { requestAnimationFrame(() => setShown(true)); }, []);

  // Esc to dismiss + background scroll lock, like the app's other overlays.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(closeTimer.current);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  function close() {
    if (closeTimer.current) return;
    setExiting(true);
    closeTimer.current = setTimeout(onClose, 280);
  }

  function pick(target) {
    if (target && onJump) {
      // Hand off to the jump after the leave animation so the scroll target
      // isn't fighting a locked body.
      if (!closeTimer.current) {
        setExiting(true);
        closeTimer.current = setTimeout(() => { onClose(); onJump(target); }, 280);
      }
      return;
    }
    close();
  }

  const visible = shown && !exiting;

  return html`<div
    class="fixed inset-0 z-[2000] overflow-y-auto welcome-modal-scrim"
    style=${{ opacity: exiting ? 0 : 1, transition: 'opacity 0.28s ease' }}
    onClick=${close}
    role="dialog" aria-modal="true" aria-label=${title}>
    <div class="min-h-full flex flex-col justify-center px-5"
      style=${{
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
        paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))',
      }}>
      <!-- Entrance is transform-only: fading an ancestor of the glass panel
           makes its backdrop-filter render clear until opacity hits exactly 1
           (the opacity group becomes the backdrop root), flashing un-frosted. -->
      <div class="welcome-modal-panel gg-rim border-[1.5px] border-[#1a1714] w-full max-w-sm mx-auto flex flex-col gap-3.5 rounded-[3px] p-5 sm:p-6"
        onClick=${(e) => e.stopPropagation()}
        style=${{
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.97)',
          transition: 'transform 0.36s cubic-bezier(0.22,1,0.36,1)',
        }}>

        <div class="text-center">
          <div class="mb-1.5 flex justify-center text-slate-500" aria-hidden="true">${typeof icon === 'function' ? html`<${icon} className="w-6 h-6" />` : html`<span class="text-2xl leading-none">${icon}</span>`}</div>
          <h2 class="font-display text-lg font-bold tracking-tight text-slate-800 leading-tight">${title}</h2>
        </div>

        <div class="rounded-[3px] border border-[1.5px] border-[#1a1714] bg-white divide-y divide-[#1a1714] max-h-[55vh] overflow-y-auto scrollbar-thin">
          ${rows.map((r, i) => html`<button key=${i} type="button"
            onClick=${() => pick(r.target)}
            class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left active:bg-stone-100 transition">
            <span class="shrink-0 inline-flex items-center text-slate-500" aria-hidden="true">${typeof r.icon === 'function' ? html`<${r.icon} className="w-4 h-4" />` : html`<span class="text-base leading-none">${r.icon}</span>`}</span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-slate-700 leading-snug">${r.title}</span>
              ${r.sub && html`<span class="block text-[12px] text-slate-500 leading-snug mt-0.5">${r.sub}</span>`}
            </span>
            ${r.target && html`<span class="shrink-0 text-slate-400 text-xs" aria-hidden="true">›</span>`}
          </button>`)}
        </div>

        <button onClick=${close}
          class="w-full py-1 text-[13px] font-medium text-slate-500 hover:text-slate-700">
          Close
        </button>
      </div>
    </div>
  </div>`;
}

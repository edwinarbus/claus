import { html, useState, useEffect, useRef } from '../html.js';
import { createPortal } from 'react-dom';

export function DateChangeConfirmModal({ pending, onConfirm, onCancel }) {
  const [shown, setShown] = useState(false);
  const [exiting, setExiting] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => {
    if (!pending) return undefined;
    requestAnimationFrame(() => setShown(true));
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(closeTimer.current);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [pending]);

  if (!pending) return null;

  function close(confirmed) {
    if (closeTimer.current) return;
    setExiting(true);
    closeTimer.current = setTimeout(() => {
      if (confirmed) onConfirm();
      else onCancel();
    }, 280);
  }

  const visible = shown && !exiting;
  const rows = pending.rows || [];
  const actionLabel = pending.actionLabel || 'Change itinerary dates';

  return createPortal(html`<div
    class="fixed inset-0 z-[2300] overflow-y-auto welcome-modal-scrim"
    style=${{ opacity: exiting ? 0 : 1, transition: 'opacity 0.28s ease' }}
    onClick=${() => close(false)}
    role="dialog" aria-modal="true" aria-label="Confirm itinerary date change">
    <div class="min-h-full flex flex-col justify-center px-5"
      style=${{
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
        paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))',
      }}>
      <div class="welcome-modal-panel gg-rim border-[1.5px] border-[#1a1714] w-full max-w-md mx-auto flex flex-col gap-4 rounded-[3px] p-6 sm:p-7"
        onClick=${(e) => e.stopPropagation()}
        style=${{
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.97)',
          transition: 'transform 0.36s cubic-bezier(0.22,1,0.36,1)',
        }}>
        <div class="text-center">
          <div class="text-3xl leading-none mb-2" aria-hidden="true">📅</div>
          <h2 class="font-display text-[1.55rem] sm:text-3xl font-bold tracking-tight text-slate-800 leading-tight">
            Are you sure?
          </h2>
          <p class="text-[13px] text-slate-500 mt-1.5 leading-relaxed">
            ${actionLabel} moves the locked trip calendar. Bookings and transport were planned around the current dates.
          </p>
        </div>

        <div class="rounded-[3px] border border-[1.5px] border-[#1a1714] bg-white divide-y divide-[#1a1714] max-h-[40vh] overflow-y-auto scrollbar-thin">
          ${rows.map((row) => html`<div key=${row.label + row.after} class="px-3.5 py-3">
            <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">${row.label}</div>
            <div class="grid grid-cols-1 gap-1.5 mt-1.5 text-[13px]">
              <div class="text-slate-600"><span class="font-medium text-slate-500">Was:</span> ${row.before}</div>
              <div class="text-amber-950 font-medium"><span class="text-amber-700">Will be:</span> ${row.after}</div>
            </div>
          </div>`)}
        </div>

        <div class="flex flex-col sm:flex-row gap-2.5 mt-1">
          <button onClick=${() => close(false)}
            class="flex-1 py-3.5 rounded-[2px] text-sm font-semibold border-[1.5px] border-[#1a1714] bg-white text-slate-700 hover:bg-[#1a1714] hover:text-[#f4f3ee] transition">
            Cancel
          </button>
          <button onClick=${() => close(true)}
            class="flex-1 py-3.5 rounded-[2px] text-sm font-semibold bg-amber-600 text-white hover:bg-amber-700 transition">
            Yes, change dates
          </button>
        </div>
      </div>
    </div>
  </div>`, document.body);
}

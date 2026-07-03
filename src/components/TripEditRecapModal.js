import { html, useState, useEffect, useRef } from '../html.js';
import { Avatar } from './Avatar.js';
import { actorOrDefault } from '../lib/actors.js';

function RecapRow({ by, text }) {
  const actor = actorOrDefault(by);
  return html`<li class="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
    <${Avatar} name=${actor} size="w-9 h-9" textSize="text-xs" className="mt-0.5" />
    <p class="flex-1 text-[13px] text-slate-700 leading-snug pt-1.5 min-w-0">
      <span class="font-semibold text-slate-800">${actor}</span>
      ${' '}${text}
    </p>
  </li>`;
}

export function TripEditRecapModal({ recap, onDone }) {
  const [shown, setShown] = useState(false);
  const [exiting, setExiting] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => {
    if (!recap) return undefined;
    requestAnimationFrame(() => setShown(true));
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(closeTimer.current);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [recap]);

  if (!recap) return null;

  function close() {
    if (closeTimer.current) return;
    setExiting(true);
    closeTimer.current = setTimeout(() => onDone(), 280);
  }

  const visible = shown && !exiting;
  const { changes, subtitle } = recap;

  return html`<div
    class="fixed inset-0 z-[2200] overflow-y-auto welcome-modal-scrim"
    style=${{ opacity: exiting ? 0 : 1, transition: 'opacity 0.28s ease' }}
    onClick=${close}
    role="dialog" aria-modal="true" aria-label="Trip updates since your last visit">
    <div class="min-h-full flex flex-col justify-center px-5"
      style=${{
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
        paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))',
      }}>
      <div class="welcome-modal-panel gg-rim border-[1.5px] border-[#1a1714] w-full max-w-md mx-auto flex flex-col gap-4 rounded-[3px] p-6 sm:p-7"
        onClick=${(e) => e.stopPropagation()}
        style=${{
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.98)',
          transition: 'transform 0.38s cubic-bezier(0.22,1,0.36,1)',
        }}>
        <div class="text-center">
          <h2 class="font-display text-[1.45rem] font-bold tracking-tight text-slate-800 leading-tight">While you were away</h2>
          ${subtitle && html`<p class="text-[13px] text-slate-500 mt-1.5 leading-snug">${subtitle}</p>`}
        </div>

        <ul class="rounded-[3px] border border-[1.5px] border-[#1a1714] bg-white px-4 py-3 divide-y divide-[#1a1714] max-h-[min(52vh,24rem)] overflow-y-auto overscroll-contain">
          ${changes.map((row, i) => html`<${RecapRow} key=${i} by=${row.by} text=${row.text} />`)}
        </ul>

        <button type="button" onClick=${close}
          class="btn-ink w-full py-3.5 rounded-[2px] text-sm font-semibold transition">
          Got it
        </button>
      </div>
    </div>
  </div>`;
}

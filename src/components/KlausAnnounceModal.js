import { html, useState, useEffect, useRef } from '../html.js';

// One-time "welcome to Germany" gag modal — fires once the trip reaches its
// Munich stop and the app quietly renames itself from Claus to Klaus.

const SEEN_KEY = 'scandiplan:klausAnnounce:v1';

export function shouldShowKlausAnnounce() {
  try { return !localStorage.getItem(SEEN_KEY); } catch { return false; }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
}

const GERMANY_SWATCHES = ['#000000', '#DD0000', '#FFCE00'];

export function KlausAnnounceModal({ onDone }) {
  const [shown, setShown] = useState(false);
  const [exiting, setExiting] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => { requestAnimationFrame(() => setShown(true)); }, []);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(closeTimer.current);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  function finish() {
    if (closeTimer.current) return;
    markSeen();
    setExiting(true);
    closeTimer.current = setTimeout(onDone, 320);
  }

  const visible = shown && !exiting;

  return html`<div
    class="fixed inset-0 z-[2200] overflow-y-auto welcome-modal-scrim"
    style=${{ opacity: exiting ? 0 : 1, transition: 'opacity 0.32s ease' }}
    onClick=${finish}
    role="dialog" aria-modal="true" aria-label="Welcome to Germany">
    <div class="min-h-full flex flex-col justify-center px-5"
      style=${{
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
        paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))',
      }}>
      <div class="welcome-modal-panel border-[1.5px] border-[#1a1714] w-full max-w-md mx-auto flex flex-col gap-4 rounded-[3px] p-6 sm:p-7"
        onClick=${(e) => e.stopPropagation()}
        style=${{
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.97)',
          transition: 'transform 0.42s cubic-bezier(0.22,1,0.36,1)',
        }}>

        <div class="flex items-center gap-1.5" aria-hidden="true">
          ${GERMANY_SWATCHES.map((c) => html`<span key=${c}
            class="h-3.5 flex-1 rounded-[1px] border-[1.5px] border-[#1a1714]"
            style=${{ background: c }}></span>`)}
        </div>

        <div>
          <div class="uppercase tracking-wide text-[11px] font-semibold text-slate-500">Willkommen</div>
          <h1 class="font-display font-black tracking-tight text-[1.95rem] text-slate-900 leading-[1.04]">Welcome to Germany</h1>
          <p class="text-[13px] text-slate-600 mt-2 leading-snug">
            Claus is now Klaus. Same trip, same plan — just a little more Bavarian for these last few nights in Munich.
          </p>
        </div>

        <button type="button" onClick=${finish}
          class="welcome-cta mt-1 w-full py-3.5 rounded-[2px] bg-[#1a1714] text-[#f4f3ee] text-sm font-semibold flex items-center justify-center">
          <span>Prost!</span>
        </button>
      </div>
    </div>
  </div>`;
}

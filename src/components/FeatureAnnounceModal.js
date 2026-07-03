import { html, useState, useEffect, useRef } from '../html.js';

// One-time "what's new" announcement, shown once per device ahead of every other
// startup modal (welcome-back, recap, onboarding), in the same editorial
// language as the rest of the app. Bump the SEEN_KEY version to re-announce.

const SEEN_KEY = 'claus-demo:featureAnnounce:overflygning:v2';
const OVERFLYGNING_IMAGE = new URL('../../assets/overflygning-announcement.jpg', import.meta.url).href;

export function shouldShowFeatureAnnounce() {
  try {
    if (localStorage.getItem(SEEN_KEY)) return false;
    return true;
  } catch { return false; }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
}

export function FeatureAnnounceModal({ onDone }) {
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
    role="dialog" aria-modal="true" aria-label="Introducing Överflygning">
    <div class="min-h-full flex flex-col justify-center px-5"
      style=${{
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
        paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))',
      }}>
      <div class="welcome-modal-panel border-[1.5px] border-[#1a1714] w-full max-w-lg mx-auto flex flex-col gap-4 rounded-[3px] p-4 sm:p-5"
        onClick=${(e) => e.stopPropagation()}
        style=${{
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.97)',
          transition: 'transform 0.42s cubic-bezier(0.22,1,0.36,1)',
        }}>

        <img
          src=${OVERFLYGNING_IMAGE}
          alt="Överflygning preview over Norwegian mountains"
          class="w-full aspect-[16/10] object-cover rounded-[2px] border-[1.5px] border-[#1a1714]"
        />

        <div class="px-1">
          <h1 class="font-display font-black tracking-tight text-[2rem] text-slate-900 leading-[1.04]">Introducing Överflygning</h1>
          <p class="text-[14px] text-slate-600 mt-2 leading-snug">
            View a 3D flyover of your Nordic adventure. Hit play in map view.
          </p>
        </div>

        <button type="button" onClick=${finish}
          class="btn-accent mt-1 w-full py-3.5 rounded-[2px] text-sm font-bold uppercase tracking-wide flex items-center justify-center">
          <span>Take a look</span>
        </button>
      </div>
    </div>
  </div>`;
}

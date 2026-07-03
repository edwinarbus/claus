import { html, useState, useEffect, useRef } from '../html.js';
import { useTrip } from '../store/store.js';
import { IconChat, IconSliders, IconCalendar, IconUtensils } from './icons.js';
import { TransportGlyph } from './TransportGlyph.js';
import { isKlausMode, brandName } from '../lib/klausMode.js';

// One-time "new feature" card for Claus — same bold editorial modal
// language as mobile onboarding and the desktop notification prompt.

const SEEN_KEY = 'claus-demo:tripChatAnnounceSeen:v2';

export function shouldShowTripChatAnnounce(trip) {
  try {
    if (!trip?.stops?.length) return false;
    if (localStorage.getItem(SEEN_KEY)) return false;
    return true;
  } catch { return false; }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
}

function HintRow({ icon, children }) {
  return html`<div class="flex items-center gap-2.5 px-3.5 py-2.5">
    <span class="shrink-0 inline-flex items-center text-slate-500" aria-hidden="true">${icon}</span>
    <span class="min-w-0 text-sm text-slate-700 leading-snug">${children}</span>
  </div>`;
}

export function TripChatAnnounce({ onDone, onTry }) {
  const trip = useTrip();
  const name = isKlausMode(trip) ? 'Klaus' : 'Claus';
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

  function finish(openChat) {
    if (closeTimer.current) return;
    markSeen();
    if (openChat) onTry?.();
    setExiting(true);
    closeTimer.current = setTimeout(() => {
      onDone();
    }, 320);
  }

  const visible = shown && !exiting;

  return html`<div
    class="fixed inset-0 z-[2100] overflow-y-auto welcome-modal-scrim"
    style=${{ opacity: exiting ? 0 : 1, transition: 'opacity 0.32s ease' }}
    onClick=${() => finish(false)}
    role="dialog" aria-modal="true" aria-label="Meet ${name}">
    <div class="min-h-full flex flex-col justify-center px-5"
      style=${{
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
        paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))',
      }}>
      <div class="welcome-modal-panel gg-rim w-full max-w-md mx-auto flex flex-col gap-4 rounded-[3px] p-6 sm:p-7"
        onClick=${(e) => e.stopPropagation()}
        style=${{
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.97)',
          transition: 'transform 0.42s cubic-bezier(0.22,1,0.36,1)',
        }}>

        <div class="text-center">
          <div class="mb-2 flex justify-center text-fjord-500" aria-hidden="true"><${IconChat} className="w-8 h-8" /></div>
          <h1 class="font-display font-black tracking-tight text-[1.6rem] text-slate-800 leading-tight">${name}</h1>
          <p class="text-[13px] text-slate-500 mt-1 leading-snug">
            Ask about the live plan, move things around, or drop in tickets.
          </p>
        </div>

        <div class="rounded-[3px] border border-[1.5px] border-[#1a1714] bg-white overflow-hidden">
          <p class="uppercase tracking-wide text-[11px] font-semibold text-slate-500 text-center px-3 pt-3 pb-2">In the header</p>
          <div class="mx-3 mb-3 rounded-[3px] border border-[1.5px] border-[#1a1714] bg-stone-50 px-2.5 py-2 flex items-center justify-between gap-2 min-h-[2.75rem]">
            <span class="min-w-0 text-[13px] font-semibold text-slate-800 truncate leading-tight">${brandName(trip) || 'Your trip'}</span>
            <div class="flex items-center flex-nowrap gap-1 shrink-0" aria-hidden="true">
              <span class="inline-flex items-center justify-center w-9 h-9 rounded-[2px] text-slate-500/80">
                <${IconSliders} className="w-[1.15rem] h-[1.15rem]" />
              </span>
              <span class="trip-chat-announce-target inline-flex items-center justify-center w-9 h-9 rounded-[2px] text-slate-600">
                <${IconChat} className="w-[1.15rem] h-[1.15rem]" />
              </span>
            </div>
          </div>
          <p class="text-[12px] text-slate-500 text-center px-3 pb-3 leading-snug">Tap the chat bubble next to settings.</p>
        </div>

        <div class="rounded-[3px] border border-[1.5px] border-[#1a1714] bg-white divide-y divide-[#1a1714]">
          <${HintRow} icon=${html`<${IconCalendar} className="w-4 h-4" />`}>"Move this to Sunday afternoon."<//>
          <${HintRow} icon=${html`<${IconUtensils} className="w-4 h-4" />`}>"Add this dinner to Sunday night."<//>
          <${HintRow} icon=${html`<${TransportGlyph} mode="bus" className="w-4 h-4" />`}>"Put this ticket in the right place."<//>
        </div>

        <button type="button" onClick=${() => finish(true)}
          class="welcome-cta mt-1 w-full py-3.5 rounded-[2px] bg-[#1a1714] text-[#f4f3ee] text-sm font-semibold active:scale-[0.98] flex items-center justify-center">
          <span>Try ${name}</span>
        </button>
        <button type="button" onClick=${() => finish(false)}
          class="w-full py-1 text-[13px] font-medium text-slate-500 hover:text-slate-700">
          Got it
        </button>
      </div>
    </div>
  </div>`;
}

import { html, useState, useEffect, useRef } from '../html.js';
import { isStandalone, pushSupported, subscribeToPush, notificationPermission } from '../lib/push.js';
import { IconBell, IconPhone, IconEdit, IconSunrise, IconCheck } from './icons.js';
import { useTrip } from '../store/store.js';
import { isKlausMode } from '../lib/klausMode.js';

// One-time mobile onboarding — the first open on a phone gets a quick "install
// me" card in the welcome screen's glass language: Share → Add to Home Screen,
// then enable notifications. Inside the installed PWA
// (which has its own storage, so this shows once more there) the card becomes
// the actual notification opt-in with the live permission prompt.

const SEEN_KEY = 'scandiplan:mobileOnboardSeen:v1';

function isMobile() {
  try { return window.matchMedia('(hover: none) and (pointer: coarse)').matches; }
  catch { return false; }
}

export function shouldShowMobileOnboard() {
  try {
    if (!isMobile()) return false;
    if (localStorage.getItem(SEEN_KEY)) return false;
    return true;
  } catch { return false; }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
}

// iOS Share glyph (square with the up arrow), drawn inline to match the text.
function ShareGlyph() {
  return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 inline-block align-[-2px]" aria-hidden="true">
    <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
  </svg>`;
}

function Step({ n, children }) {
  return html`<div class="flex items-start gap-3 px-3.5 py-2.5">
    <span class="shrink-0 w-6 h-6 rounded-[2px] bg-[#1a1714] text-[#f4f3ee] text-[12px] font-bold grid place-items-center mt-px">${n}</span>
    <span class="min-w-0 text-sm text-slate-800 leading-snug">${children}</span>
  </div>`;
}

export function MobileOnboard({ who, onDone }) {
  const trip = useTrip();
  const klausName = isKlausMode(trip) ? 'Klaus' : 'Claus';
  const [shown, setShown] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, reason }
  const closeTimer = useRef(null);
  const standalone = isStandalone();
  const canEnable = standalone && pushSupported();

  useEffect(() => { requestAnimationFrame(() => setShown(true)); }, []);

  // Lock background scroll while open, like the app's other overlays.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(closeTimer.current);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  function close() {
    if (closeTimer.current) return;
    markSeen();
    setExiting(true);
    closeTimer.current = setTimeout(onDone, 320);
  }

  async function enableNotifications() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await subscribeToPush(who);
      // Subscribed but the preview push didn't go out (e.g. server missing its
      // VAPID key): keep the card open and say so, instead of a false "set".
      if (r.ok && r.example !== 'sent') {
        setResult({ ok: false, reason: `Notifications are on, but the preview couldn't be sent (${r.example || 'server on an older deployment'}).` });
        return;
      }
      setResult(r);
      if (r.ok) closeTimer.current = setTimeout(() => { markSeen(); onDone(); }, 1400);
    } finally {
      setBusy(false);
    }
  }

  const visible = shown && !exiting;
  const granted = notificationPermission() === 'granted';

  return html`<div
    class="fixed inset-0 z-[2100] overflow-y-auto welcome-modal-scrim"
    style=${{ opacity: exiting ? 0 : 1, transition: 'opacity 0.32s ease' }}
    onClick=${close}
    role="dialog" aria-modal="true" aria-label="Set up ${klausName} on your phone">
    <div class="min-h-full flex flex-col justify-center px-5"
      style=${{
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
        paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))',
      }}>
      <!-- Entrance is transform-only: fading an ancestor of the glass panel
           makes its backdrop-filter render clear until opacity hits exactly 1
           (the opacity group becomes the backdrop root), flashing un-frosted. -->
      <div class="welcome-modal-panel border-[1.5px] border-[#1a1714] w-full max-w-md mx-auto flex flex-col gap-4 rounded-[3px] p-6 sm:p-7"
        onClick=${(e) => e.stopPropagation()}
        style=${{
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.97)',
          transition: 'transform 0.42s cubic-bezier(0.22,1,0.36,1)',
        }}>

        <div class="text-center">
          <div class="mb-2 flex justify-center text-fjord-500" aria-hidden="true">
            ${standalone ? html`<${IconBell} className="w-8 h-8" />` : html`<${IconPhone} className="w-8 h-8" />`}
          </div>
          <h1 class="font-display text-[1.6rem] font-bold tracking-tight text-slate-800 leading-tight">
            ${standalone ? 'One more thing' : 'Make it an app'}
          </h1>
          <p class="text-[13px] text-slate-500 mt-1">
            ${standalone
              ? 'Get plan-change alerts and a short trip brief each morning.'
              : `Two taps put ${klausName} on your Home Screen, with trip notifications.`}
          </p>
        </div>

        ${standalone
          ? html`
            <div class="rounded-[3px] border-[1.5px] border-[#1a1714] bg-white divide-y divide-[#1a1714]">
              <div class="flex items-center gap-2.5 px-3.5 py-2.5">
                <span class="shrink-0 inline-flex items-center text-slate-500" aria-hidden="true"><${IconEdit} className="w-4 h-4" /></span>
                <span class="min-w-0 text-sm text-slate-700 leading-snug">Plan changes from the other traveler</span>
              </div>
              <div class="flex items-center gap-2.5 px-3.5 py-2.5">
                <span class="shrink-0 inline-flex items-center text-slate-500" aria-hidden="true"><${IconSunrise} className="w-4 h-4" /></span>
                <span class="min-w-0 text-sm text-slate-700 leading-snug">Weather, the day's sights, and any local heads-ups at 6 AM</span>
              </div>
            </div>

            ${result && !result.ok && html`<p class="text-[12px] text-amber-700 text-center leading-snug">${result.reason}</p>`}
            ${result && result.ok && html`<p class="text-[12px] text-emerald-700 text-center leading-snug inline-flex items-center justify-center gap-1 w-full"><span class="inline-flex items-center text-emerald-600" aria-hidden="true"><${IconCheck} className="w-3.5 h-3.5" /></span> You're set — a preview brief is on its way to your lock screen.</p>`}

            <button onClick=${enableNotifications} disabled=${busy || (result && result.ok)}
              class="welcome-cta mt-1 w-full py-3.5 rounded-[2px] text-white text-sm font-semibold flex items-center justify-center disabled:opacity-70">
              <span>${busy ? 'Setting up…' : (result && result.ok) || granted ? 'Notifications enabled' : 'Enable notifications'}</span>
            </button>
            <button onClick=${close}
              class="w-full py-1 text-[13px] font-medium text-slate-500 hover:text-slate-700">
              ${result && result.ok ? 'Done' : 'Not now'}
            </button>`
          : html`
            <div class="rounded-[3px] border-[1.5px] border-[#1a1714] bg-white divide-y divide-[#1a1714]">
              <${Step} n="1">Tap <span class="font-semibold text-slate-800">Share <${ShareGlyph} /></span> in Safari's toolbar<//>
              <${Step} n="2">Choose <span class="font-semibold text-slate-800">Add to Home Screen</span><//>
              <${Step} n="3">Open it from your Home Screen and turn on <span class="font-semibold text-slate-800">notifications</span> when asked<//>
            </div>
            <p class="text-[12px] text-slate-500 text-center leading-snug">
              You'll get plan-change alerts and a 6 AM brief each trip morning.
            </p>
            <button onClick=${close}
              class="welcome-cta mt-1 w-full py-3.5 rounded-[2px] text-white text-sm font-semibold flex items-center justify-center">
              <span>Got it</span>
            </button>`}
      </div>
    </div>
  </div>`;
}

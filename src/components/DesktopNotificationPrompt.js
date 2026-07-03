import { html, useState, useEffect, useRef } from '../html.js';
import { isIOSLike, pushSupported, subscribeToPush, notificationPermission } from '../lib/push.js';
import { IconBell, IconEdit, IconSunrise } from './icons.js';

const SEEN_KEY = 'claus-demo:desktopNotifyPromptSeen:v2';

function isDesktopViewport() {
  try {
    if (isIOSLike()) return false;
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return false;
    return window.innerWidth >= 768;
  } catch {
    return false;
  }
}

export function shouldShowDesktopNotificationPrompt() {
  try {
    if (!isDesktopViewport()) return false;
    if (!pushSupported()) return false;
    if (notificationPermission() !== 'default') return false;
    return !localStorage.getItem(SEEN_KEY);
  } catch {
    return false;
  }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
}

export function DesktopNotificationPrompt({ who, onDone }) {
  const [shown, setShown] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
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

  function close() {
    if (closeTimer.current) return;
    markSeen();
    setExiting(true);
    closeTimer.current = setTimeout(onDone, 320);
  }

  function previewProblem(example) {
    if (!example) return 'Notifications are on, but the server did not report a preview.';
    if (example.includes('VAPID_PRIVATE_KEY')) return 'Notifications are on, but Vercel is missing VAPID_PRIVATE_KEY.';
    return `Notifications are on, but the preview did not go out: ${example}.`;
  }

  async function enable() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await subscribeToPush(who);
      if (r.ok && r.example === 'sent') {
        setResult({ ok: true, reason: 'Notifications enabled.' });
        closeTimer.current = setTimeout(() => { markSeen(); onDone(); }, 1200);
        return;
      }
      if (r.ok) {
        setResult({ ok: false, reason: previewProblem(r.example) });
        return;
      }
      setResult({ ok: false, reason: r.reason || 'Could not enable notifications.' });
    } finally {
      setBusy(false);
    }
  }

  const visible = shown && !exiting;

  return html`<div
    class="fixed inset-0 z-[2100] overflow-y-auto welcome-modal-scrim"
    style=${{ opacity: exiting ? 0 : 1, transition: 'opacity 0.32s ease' }}
    onClick=${close}
    role="dialog" aria-modal="true" aria-label="Enable notifications">
    <div class="min-h-full flex flex-col justify-center px-5"
      style=${{
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
        paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))',
      }}>
      <div class="welcome-modal-panel gg-rim w-full max-w-sm mx-auto flex flex-col gap-4 rounded-[3px] p-6"
        onClick=${(e) => e.stopPropagation()}
        style=${{
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.97)',
          transition: 'transform 0.42s cubic-bezier(0.22,1,0.36,1)',
        }}>
        <div class="text-center">
          <div class="mb-2 flex justify-center text-fjord-500" aria-hidden="true"><${IconBell} className="w-8 h-8" /></div>
          <h1 class="font-display font-black tracking-tight text-[1.55rem] text-slate-800 leading-tight">Enable notifications?</h1>
          <p class="text-[13px] text-slate-500 mt-1 leading-snug">
            Get plan-change alerts here, plus the trip morning brief.
          </p>
        </div>

        <div class="rounded-[3px] border border-[1.5px] border-[#1a1714] bg-white divide-y divide-[#1a1714]">
          <div class="flex items-center gap-2.5 px-3.5 py-2.5">
            <span class="shrink-0 inline-flex items-center text-slate-500" aria-hidden="true"><${IconEdit} className="w-4 h-4" /></span>
            <span class="min-w-0 text-sm text-slate-700 leading-snug">“Edwin moved Tivoli Gardens in Copenhagen from July 13 to July 14”</span>
          </div>
          <div class="flex items-center gap-2.5 px-3.5 py-2.5">
            <span class="shrink-0 inline-flex items-center text-slate-500" aria-hidden="true"><${IconSunrise} className="w-4 h-4" /></span>
            <span class="min-w-0 text-sm text-slate-700 leading-snug">The 6 AM trip brief on travel days</span>
          </div>
        </div>

        ${result && html`<p class=${`text-[12px] text-center leading-snug ${result.ok ? 'text-emerald-700' : 'text-amber-700'}`}>
          ${result.reason}
        </p>`}

        <button onClick=${enable} disabled=${busy || (result && result.ok)}
          class="welcome-cta mt-1 w-full py-3.5 rounded-[2px] bg-[#1a1714] text-[#f4f3ee] text-sm font-semibold active:scale-[0.98] flex items-center justify-center disabled:opacity-70">
          <span>${busy ? 'Setting up…' : 'Enable notifications'}</span>
        </button>
        <button onClick=${close}
          class="w-full py-1 text-[13px] font-medium text-slate-500 hover:text-slate-700">
          Not now
        </button>
      </div>
    </div>
  </div>`;
}

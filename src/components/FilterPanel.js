import { html, useEffect, useState } from '../html.js';
import { useStore, useTrip } from '../store/store.js';
import { isKlausMode } from '../lib/klausMode.js';
import { SYNC_LABEL, syncTime } from '../lib/syncStatus.js';
import { confirmDialog } from '../lib/confirmDialog.js';
import { IconX, IconSun, IconMoon, IconDisplay, IconReset, IconEyeOff, IconHistory, IconUndo, IconCheck, IconBell } from './icons.js';
import { PEOPLE } from '../data/profiles.js';
import { Avatar } from './Avatar.js';
import { useTheme } from '../lib/theme.js';

const THEME_OPTIONS = [
  { value: 'system', label: 'System', Icon: IconDisplay },
  { value: 'light', label: 'Light', Icon: IconSun },
  { value: 'dark', label: 'Dark', Icon: IconMoon },
];

// Appearance: follow the device, or pin Light/Dark — a small icon-only
// switcher (display / sun / moon) living at the bottom of the pane. Writes
// through useTheme → src/lib/theme.js, which flips the `dark` class on <html>.
function AppearanceSection() {
  const [pref, setPref] = useTheme();
  return html`<section class="pt-3 border-t border-[#1a1714] flex items-center justify-between gap-3">
    <h3 class="text-[11px] font-semibold text-slate-900 uppercase tracking-wide">Appearance</h3>
    <div role="radiogroup" aria-label="Theme"
      class="inline-flex items-center gap-0 p-0.5 rounded-[2px] border-[1.5px] border-[#1a1714] bg-white">
      ${THEME_OPTIONS.map((opt) => html`<button key=${opt.value} type="button" role="radio"
        aria-checked=${pref === opt.value} title=${opt.label} aria-label=${opt.label}
        onClick=${() => setPref(opt.value)}
        class=${`w-9 h-7 grid place-items-center rounded-[1px] transition ${pref === opt.value ? 'bg-[#1a1714] text-[#f4f3ee]' : 'text-slate-500 hover:text-slate-900'}`}>
        <${opt.Icon} className="w-4 h-4" />
      </button>`)}
    </div>
  </section>`;
}
import { pushSupported, isStandalone, subscribeToPush, getExistingSubscription, notificationPermission } from '../lib/push.js';

// Notifications: shared-plan edit alerts plus the morning brief. On iOS this
// only works from the installed (Home Screen) app, so the row explains that
// when needed.
function MorningBriefSection({ who }) {
  const trip = useTrip();
  const klausName = isKlausMode(trip) ? 'Klaus' : 'Claus';
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [previewSent, setPreviewSent] = useState(false);
  const supported = pushSupported();

  useEffect(() => {
    let alive = true;
    getExistingSubscription().then((sub) => {
      if (alive) setSubscribed(!!sub && notificationPermission() === 'granted');
    });
    return () => { alive = false; };
  }, []);

  // Turn the server's raw example-push report into something actionable.
  function previewProblem(example) {
    if (!example) return 'Subscribed, but the server didn’t report a preview — it may be running an older deployment.';
    if (example.includes('VAPID_PRIVATE_KEY')) return 'Subscribed, but the server can’t send pushes yet: the VAPID_PRIVATE_KEY env var isn’t set in Vercel.';
    if (example.includes('403') || example.includes('401')) return `Subscribed, but the push service rejected the send (${example}) — the VAPID public/private keys likely don’t match.`;
    return `Subscribed, but the preview didn’t go out: ${example}.`;
  }

  async function enable() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const r = await subscribeToPush(who);
      if (r.ok) {
        setSubscribed(true);
        if (r.example === 'sent') {
          setMessage('');
          setPreviewSent(true);
        } else {
          setPreviewSent(false);
          setMessage(previewProblem(r.example));
        }
      } else {
        setMessage(r.reason || 'Could not enable notifications.');
      }
    } finally {
      setBusy(false);
    }
  }

  return html`<section class="pt-2 border-t border-stone-100">
    <h3 class="text-[11px] font-semibold text-slate-700 uppercase tracking-wide mb-2">Notifications</h3>
    ${subscribed
      ? html`<div class="px-3 py-2.5 rounded-[3px] bg-emerald-50 border-[1.5px] border-[#1a1714]">
          <div class="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <span class="inline-flex items-center text-emerald-600" aria-hidden="true"><${IconCheck} className="w-4 h-4" /></span> Enabled on this device
          </div>
          ${previewSent && html`<div class="text-[11px] text-emerald-600 mt-0.5">Preview brief sent — check your notifications.</div>`}
          <button type="button" onClick=${enable} disabled=${busy}
            class="text-[11px] font-medium text-emerald-700 hover:underline mt-1 disabled:opacity-50">
            ${busy ? 'Sending…' : previewSent ? 'Send another preview' : 'Send a preview notification'}
          </button>
        </div>`
      : html`<button type="button" onClick=${enable} disabled=${busy || !supported}
          class="btn-ink w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[2px] text-sm font-semibold transition disabled:opacity-60">
          <span class="shrink-0 inline-flex items-center" aria-hidden="true"><${IconBell} className="w-4 h-4" /></span>
          <span class="text-left">${busy ? 'Setting up…' : 'Enable notifications'}</span>
        </button>`}
    ${!supported && html`<p class="text-[11px] text-slate-600 mt-1.5">
      ${isStandalone()
        ? 'Notifications need iOS 16.4+ (or a supported browser).'
        : `On iPhone: add ${klausName} to your Home Screen (Share → Add to Home Screen) and enable from inside the app.`}
    </p>`}
    ${message && html`<p class="text-[11px] text-amber-700 mt-1.5">${message}</p>`}
  </section>`;
}

function formatSnapshotTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function FilterPanel({ open, onClose }) {
  const {
    trip, dispatch, hideRecs, setHideRecs,
    snapshots, snapshotsLoading, loadSnapshots, saveSnapshotNow, restoreSnapshot,
    sync, who, setWho, undo, canUndo,
  } = useStore();
  const hasStops = trip.stops.length > 0;
  const [restoringId, setRestoringId] = useState(null);
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  useEffect(() => {
    if (open) loadSnapshots();
  }, [open, loadSnapshots]);

  // Enter/exit choreography: mount off-screen and slide in on the next frame;
  // on close, slide back out to the right and only then unmount. `shown` keeps
  // the panel in the DOM through the exit, `active` drives the transition.
  const [shown, setShown] = useState(open);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(true);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setActive(true)); });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setActive(false);
    const t = setTimeout(() => setShown(false), 340);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!shown) return null;

  async function resetAll() {
    if (!(await confirmDialog({ title: 'Clear the entire trip?', message: 'A snapshot is saved first — you can restore it from Version history.', confirmLabel: 'Clear & start over', tone: 'destructive' }))) return;
    await saveSnapshotNow('Before reset');
    dispatch({ type: 'RESET_ALL' });
    onClose();
  }

  async function onSaveSnapshot() {
    setSavingSnapshot(true);
    try {
      await saveSnapshotNow('Manual save');
    } finally {
      setSavingSnapshot(false);
    }
  }

  async function onRestore(id, label) {
    const when = snapshots.find((s) => s.id === id);
    const detail = when ? formatSnapshotTime(when.created_at) : '';
    if (!(await confirmDialog({ title: `Restore "${label || 'this snapshot'}"?`, message: `${detail ? `Saved ${detail}. ` : ''}Your current plan is saved first.`, confirmLabel: 'Restore' }))) return;
    setRestoringId(id);
    try {
      await restoreSnapshot(id);
      onClose();
    } finally {
      setRestoringId(null);
    }
  }

  return html`
    <div class=${`fixed inset-0 z-50 ${active ? '' : 'pointer-events-none'}`}>
      <div class=${`absolute inset-0 gg-scrim transition-opacity duration-300 ${active ? 'opacity-100' : 'opacity-0'}`}
        onClick=${onClose}></div>
      <aside class=${`gg-sheet gg-rim settings-sheet absolute top-0 right-0 h-[100dvh] max-h-[100dvh] w-full max-w-sm flex flex-col overflow-hidden will-change-transform transition-transform duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${active ? 'translate-x-0' : 'translate-x-full'}`}>
        <div class="shrink-0 flex items-center justify-between gap-3 border-b border-[#1a1714] z-10"
          style=${{
            paddingTop: 'max(1rem, env(safe-area-inset-top))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
            paddingBottom: '1rem',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
          }}>
          <h2 class="font-display text-2xl font-bold tracking-tight text-slate-900 min-w-0 flex-1">Settings</h2>
          <button onClick=${onClose} aria-label="Close settings"
            class="shrink-0 p-2 rounded-[2px] hover:bg-stone-100 text-slate-500 transition-colors">
            <${IconX} className="w-5 h-5" />
          </button>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin p-4 space-y-5"
          style=${{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <!-- On phones the header toolbar collapses to settings + chat, so
               identity, sync state, and undo live here instead. -->
          <section class="sm:hidden">
            <h3 class="text-[11px] font-semibold text-slate-600 uppercase tracking-wide mb-2">Who's planning</h3>
            <div class="grid grid-cols-2 gap-2">
              ${PEOPLE.map((p) => html`<button key=${p.name} type="button" onClick=${() => setWho(p.name)}
                aria-pressed=${who === p.name}
                class="flex items-center justify-center gap-2 px-3 py-2 rounded-[2px] border-[1.5px] text-sm font-medium transition ${who === p.name ? 'border-[#1a1714] bg-[#1a1714] text-[#f4f3ee]' : 'border-[#1a1714] text-slate-700 hover:bg-stone-50'}">
                <${Avatar} name=${p.name} size="w-7 h-7" textSize="text-[11px]" />
                ${p.name}
                ${who === p.name && html`<${IconCheck} className="w-3.5 h-3.5 text-[#f4f3ee] shrink-0" />`}
              </button>`)}
            </div>
          </section>

          <section class="sm:hidden pt-2 border-t border-stone-100">
            <h3 class="text-[11px] font-semibold text-slate-700 uppercase tracking-wide mb-2">Trip status</h3>
            <div class="space-y-2">
              ${(() => {
                const info = SYNC_LABEL[sync?.status] || SYNC_LABEL.local;
                const time = sync?.status === 'synced' ? syncTime(sync.at) : '';
                return html`<div class="flex items-start gap-2.5 px-3 py-2.5 rounded-[3px] bg-stone-50 border-[1.5px] border-[#1a1714]">
                  <span class=${`w-2.5 h-2.5 mt-[3px] rounded-[1px] shrink-0 ${info.dot}`}></span>
                  <div class="min-w-0">
                    <div class=${`text-sm font-medium leading-tight ${info.text}`}>${info.label}${time ? ` · ${time}` : ''}</div>
                    <div class="text-xs text-slate-600 mt-0.5">${info.tip}</div>
                  </div>
                </div>`;
              })()}
              <button type="button" onClick=${() => canUndo && undo()} disabled=${!canUndo}
                class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[2px] text-sm font-medium text-slate-700 hover:text-fjord-700 hover:bg-fjord-50 border-[1.5px] border-[#1a1714] transition disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-600">
                <${IconUndo} className="w-4 h-4 shrink-0" />
                <span class="text-left">${canUndo ? 'Undo last change' : 'Nothing to undo'}</span>
              </button>
            </div>
          </section>

          <section class="pt-2 border-t border-stone-100 sm:pt-0 sm:border-t-0">
            <h3 class="text-[11px] font-semibold text-slate-700 uppercase tracking-wide mb-2">View</h3>
            <label class="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked=${hideRecs}
                onChange=${(e) => setHideRecs(e.target.checked)}
                class="mt-1 accent-fjord-600 w-4 h-4" />
              <span>
                <span class="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <${IconEyeOff} className="w-4 h-4 text-fjord-600" /> Hide recommendations
                </span>
              </span>
            </label>
          </section>

          <${MorningBriefSection} who=${who} />

          <section class="pt-2 border-t border-stone-100">
            <h3 class="text-[11px] font-semibold text-slate-700 uppercase tracking-wide mb-2">Trip</h3>
            <div class="flex gap-2">
              ${hasStops && html`<button onClick=${resetAll}
                class="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-[2px] text-[13px] font-medium text-slate-700 bg-white hover:text-rose-700 hover:bg-rose-50 border-[1.5px] border-[#1a1714] transition">
                <${IconReset} className="w-4 h-4 shrink-0" />
                <span>Reset trip</span>
              </button>`}
            </div>
          </section>

          <section class="pt-2 border-t border-stone-100">
            <div class="flex items-center justify-between gap-2 mb-2">
              <h3 class="text-[11px] font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                <${IconHistory} className="w-3.5 h-3.5" /> Version history
              </h3>
              <button type="button" onClick=${onSaveSnapshot} disabled=${savingSnapshot}
                class="text-[11px] font-medium text-fjord-600 hover:text-fjord-700 disabled:opacity-50">
                ${savingSnapshot ? 'Saving…' : 'Save now'}
              </button>
            </div>
            ${snapshotsLoading && html`<p class="text-xs text-slate-600 py-2">Loading snapshots…</p>`}
            ${!snapshotsLoading && snapshots.length === 0 && html`
              <p class="text-xs text-slate-600 py-2 rounded-[2px] bg-stone-50 px-3 border-[1.5px] border-[#1a1714]">
                No snapshots yet — they appear after your first autosave or when you tap Save now.
              </p>`}
            ${!snapshotsLoading && snapshots.length > 0 && html`
              <ul class="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
                ${snapshots.map((s) => html`
                  <li key=${s.id}
                    class="flex items-center gap-2 px-2.5 py-2 rounded-[2px] border-[1.5px] border-[#1a1714] bg-white hover:bg-stone-50">
                    <div class="flex-1 min-w-0">
                      <div class="text-xs font-medium text-slate-700 truncate">
                        ${s.label || 'Autosave'}
                        ${s.local ? html`<span class="text-slate-600 font-normal"> · local</span>` : ''}
                      </div>
                      <div class="text-[10px] text-slate-600 truncate">
                        ${formatSnapshotTime(s.created_at)}
                        ${s.stops_count != null ? html` · ${s.stops_count} stops` : ''}
                        ${s.saved_by ? html` · ${s.saved_by}` : ''}
                      </div>
                    </div>
                    <button type="button" onClick=${() => onRestore(s.id, s.label)}
                      disabled=${restoringId === s.id}
                      class="shrink-0 text-[11px] font-semibold text-fjord-600 hover:text-fjord-700 px-2 py-1 rounded-[2px] hover:bg-fjord-50 disabled:opacity-50">
                      ${restoringId === s.id ? '…' : 'Restore'}
                    </button>
                  </li>`)}
              </ul>`}
          </section>

          <${AppearanceSection} />
        </div>
      </aside>
    </div>`;
}

import { html, useState, useEffect, useRef } from '../html.js';
import { useStore } from '../store/store.js';
import { findTodayOnTrip } from '../lib/tripDay.js';
import { Header } from './Header.js';
import { ViewToggle, MobileViewToggle } from './ViewToggle.js';
import { Timeline } from './Timeline.js';
import { CalendarView } from './CalendarView.js';
import { MapView } from './MapView.js';
import { FilterPanel } from './FilterPanel.js';
import { TripChatPanel } from './TripChatPanel.js';
import { TripInsights } from './TripInsights.js';
import { NoticeBar } from './NoticeBar.js';
import { SyncConflictBar } from './SyncConflictBar.js';
import { DateChangeConfirmModal } from './DateChangeConfirmModal.js';
import { SyncStatusBar } from './SyncStatusBar.js';
import { MobileOnboard, shouldShowMobileOnboard } from './MobileOnboard.js';
import { DesktopNotificationPrompt, shouldShowDesktopNotificationPrompt } from './DesktopNotificationPrompt.js';
import { KlausAnnounceModal, shouldShowKlausAnnounce } from './KlausAnnounceModal.js';
import { isKlausMode, brandName } from '../lib/klausMode.js';
import { TripEditRecapModal } from './TripEditRecapModal.js';
import { SyncLoadingOverlay, SYNC_LOAD_EXIT_MS } from './SyncLoadingOverlay.js';
import { buildTripChangeRecap, acknowledgeTripRecap } from '../lib/tripChangeRecap.js';
import { syncPushIdentity, pingTripWatch } from '../lib/push.js';
import { scrollToPlanTarget } from '../lib/planScroll.js';
import { useSwipeNav } from '../lib/useSwipeNav.js';
import { ConfirmHost } from './ConfirmHost.js';

const VIEW_ORDER = ['timeline', 'calendar', 'map'];
const VIEW_PUSH_MS = 480;

export function App() {
  const { trip, dispatch, notice, dismissNotice, who, expandStop,
    dateChangePending, confirmDateChange, cancelDateChange, sync, syncReady } = useStore();
  const [view, setView] = useState('timeline');
  const [viewPush, setViewPush] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Claus opens by default on wider screens (floating corner card) — but only
  // AFTER the timeline's entrance cascade plays (see the auto-open effect below),
  // so the itinerary animates in first and the chat then drops in. On a phone
  // it's a full-screen sheet, so it stays closed on load. The chat's own
  // briefing receipt is the app's home/welcome screen, so there's no separate
  // splash to show first.
  const [chatOpen, setChatOpen] = useState(false);
  const chatAutoOpenedRef = useRef(false);
  // First-ever open on a phone: a one-time install/notifications card.
  const [onboarding, setOnboarding] = useState(shouldShowMobileOnboard);
  const [desktopNotifyPrompt, setDesktopNotifyPrompt] = useState(shouldShowDesktopNotificationPrompt);
  const [editRecap, setEditRecap] = useState(null);
  // One-time "welcome to Germany" gag: fires once the trip reaches Munich.
  const [klausAnnounce, setKlausAnnounce] = useState(false);
  const klausAnnounceHandledRef = useRef(false);
  // Post-sync modals wait for the load overlay exit so "While you were away"
  // doesn't fight the staged load-in animation.
  const [postSyncUiReady, setPostSyncUiReady] = useState(() => !sync?.on);
  const recapCheckedForWho = useRef('');
  const viewStageRef = useRef(null);
  const viewPushTimer = useRef(null);

  // Once the trip reaches Munich, the app quietly renames itself Claus → Klaus.
  useEffect(() => {
    if (klausAnnounceHandledRef.current) return;
    if (!trip?.stops?.length || !isKlausMode(trip)) return;
    klausAnnounceHandledRef.current = true;
    if (shouldShowKlausAnnounce()) setKlausAnnounce(true);
  }, [trip]);

  useEffect(() => {
    if (trip?.stops?.length) document.title = `${brandName(trip)} — Scandinavia Trip Planner`;
  }, [trip]);

  useEffect(() => {
    if (who) syncPushIdentity(who);
  }, [who]);

  // A tapped notification deep-links to ?welcome=1 → open the chat, whose
  // briefing receipt IS today's brief (no separate welcome screen anymore). Two
  // entry paths: the URL param when the tap cold-launches the app, and a
  // service-worker message when the app was already open.
  const welcomeLinkHandledRef = useRef(false);
  function openChatFromNotification() {
    setChatOpen(true);
  }
  useEffect(() => {
    if (welcomeLinkHandledRef.current || !trip?.stops?.length) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get('welcome')) { welcomeLinkHandledRef.current = true; return; }
    welcomeLinkHandledRef.current = true;
    // Strip the param so a later reload doesn't re-open the chat.
    params.delete('welcome');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    openChatFromNotification();
  }, [trip]);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (e) => {
      if (e.data && e.data.type === 'notification-tap' && /[?&]welcome=1/.test(e.data.url || '')) {
        openChatFromNotification();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [trip, who]);

  // While traveling, every open / return-to-foreground nudges the server-side
  // disruption watch (it throttles itself; without pings it would only get a
  // daily cron's chance to check today's city and sights for trouble).
  useEffect(() => {
    const ping = () => { if (findTodayOnTrip(trip)) pingTripWatch(); };
    ping();
    const onVis = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [trip]);

  useEffect(() => {
    if (onboarding || desktopNotifyPrompt) return;
    const timer = setTimeout(() => {
      if (shouldShowDesktopNotificationPrompt()) setDesktopNotifyPrompt(true);
    }, 250);
    return () => clearTimeout(timer);
  }, [onboarding, desktopNotifyPrompt]);

  const syncing = !!(sync?.on && !syncReady);

  useEffect(() => {
    if (!sync?.on) {
      setPostSyncUiReady(true);
      return undefined;
    }
    if (!syncReady) {
      setPostSyncUiReady(false);
      return undefined;
    }
    const t = setTimeout(() => setPostSyncUiReady(true), SYNC_LOAD_EXIT_MS + 48);
    return () => clearTimeout(t);
  }, [sync?.on, syncReady]);

  // Auto-open Claus on wide screens once the timeline is revealing — but only
  // after its staggered entrance cascade (~1s) has played, so the itinerary rises
  // in first and the chat card then drops in on top. Runs once; on a phone the
  // full-screen sheet stays closed on load.
  useEffect(() => {
    if (chatAutoOpenedRef.current || syncing) return undefined;
    let wide = false;
    try { wide = window.matchMedia('(min-width: 640px)').matches; } catch { /* default narrow */ }
    chatAutoOpenedRef.current = true;
    if (!wide) return undefined;
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
    const t = setTimeout(() => setChatOpen(true), reduce ? 200 : 1050);
    return () => clearTimeout(t);
  }, [syncing]);

  // After sync + load overlay, show a concise recap of plan edits since last visit.
  useEffect(() => {
    if (!syncReady || !postSyncUiReady || !who || onboarding) return;
    if (recapCheckedForWho.current === who) return;
    recapCheckedForWho.current = who;
    const recap = buildTripChangeRecap(who, trip);
    if (recap) setEditRecap(recap);
  }, [syncReady, postSyncUiReady, who, trip, onboarding]);

  function dismissEditRecap() {
    acknowledgeTripRecap(who, trip);
    setEditRecap(null);
  }

  useEffect(() => () => clearTimeout(viewPushTimer.current), []);

  // Float the sticky top bar on a soft shadow once content scrolls beneath it,
  // so the page reads as sliding under the bar rather than colliding with it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Publish the sticky top bar's height so an expanded stop card can stick its
  // own header right beneath it (CSS `top: var(--app-bar-h)`).
  useEffect(() => {
    const bar = document.querySelector('.app-top-bar');
    if (!bar) return;
    const apply = () => document.documentElement.style.setProperty(
      '--app-bar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
    apply();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    if (ro) ro.observe(bar);
    window.addEventListener('resize', apply);
    // iOS standalone PWA warm-resume: the page isn't reloaded, so a height that
    // depends on env(safe-area-inset-top) can come back stale (ResizeObserver
    // doesn't always fire on resume). Re-measure when we return to foreground.
    const onShow = () => {
      if (document.visibilityState === 'visible') requestAnimationFrame(apply);
    };
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onShow);
      if (ro) ro.disconnect();
    };
  }, []);

  function openChat() {
    setFiltersOpen(false);
    setChatOpen(true);
  }

  function changeView(next) {
    if (!next || next === view) return;
    clearTimeout(viewPushTimer.current);
    const fromIndex = VIEW_ORDER.indexOf(view);
    const toIndex = VIEW_ORDER.indexOf(next);
    const direction = toIndex >= fromIndex ? 'forward' : 'back';
    const minHeight = viewStageRef.current
      ? Math.round(viewStageRef.current.getBoundingClientRect().height)
      : 0;
    setView(next);
    setViewPush({ from: view, to: next, direction, minHeight });
    viewPushTimer.current = setTimeout(() => setViewPush(null), VIEW_PUSH_MS);
  }

  // Mobile: swipe left/right to page between timeline ↔ calendar ↔ map.
  const swipe = useSwipeNav({
    onNext: () => { const i = VIEW_ORDER.indexOf(view); if (i < VIEW_ORDER.length - 1) changeView(VIEW_ORDER[i + 1]); },
    onPrev: () => { const i = VIEW_ORDER.indexOf(view); if (i > 0) changeView(VIEW_ORDER[i - 1]); },
  });

  function renderView(which) {
    if (which === 'timeline') return html`<${Timeline} />`;
    if (which === 'calendar') return html`<${CalendarView} onOpenStop=${openStop} />`;
    return html`<${MapView} onOpenStop=${openStop} />`;
  }

  // Each view gets a readable column: the timeline is a single list (cards get
  // sparse past ~900px), the calendar grid a bit more, the map all the room.
  const VIEW_WIDTH = { timeline: 'max-w-5xl', calendar: 'max-w-5xl', map: 'max-w-screen-2xl' };

  function renderViewPane(which, className = '', key = which) {
    const mapClass = which === 'map' ? ' view-pane--map' : '';
    return html`<div key=${key} class=${`view-pane${mapClass} ${className}`}>
      <div class=${`view-pane-content ${VIEW_WIDTH[which]} mx-auto px-4`}>
        ${renderView(which)}
      </div>
    </div>`;
  }

  function openStop(id) {
    changeView('timeline');
    expandStop(id);
    setTimeout(() => {
      const el = document.getElementById(`stop-${id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 90);
  }

  // Jump from a trip-health pill to the thing it's about. Travel legs scroll to
  // the connector (always rendered); stop targets expand the stop first so the
  // lodging/day planner is visible.
  function jumpTo(target) {
    if (!target || !target.stopId) return;
    changeView('timeline');
    if (target.kind === 'stop' || target.kind === 'day') {
      expandStop(target.stopId);
    }
    const date = target.kind === 'day' ? target.date : '';
    if (target.kind === 'leg') {
      setTimeout(() => {
        const el = document.getElementById(`leg-${target.stopId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 90);
      return;
    }
    scrollToPlanTarget({ stopId: target.stopId, date, slotKey: target.slotKey || '' });
  }

  return html`
    <div>
      <${SyncLoadingOverlay} active=${syncing} />
      <!-- Safari 26's Liquid Glass controls are an unsafe overlay area: the shell
           renders edge-to-edge, then reserves only the hardware safe inset plus a
           small comfort pad at the bottom. -->
      <div class="scandi-app-shell ${view === 'map' ? 'scandi-app-shell--map' : ''} ${syncing ? 'is-sync-revealing' : 'is-sync-revealed'} max-w-screen-2xl mx-auto px-4 pt-0">
        <!-- Horizontal geometry (full-bleed margins + matching padding) lives in
             the .app-top-bar CSS rule so the bar reaches the viewport edges even
             when the shell is narrower than the window (zoomed-out desktop). -->
        <div class=${`app-top-bar bg-stone-50 border-b border-[#1a1714] sticky top-0 z-40 pt-[env(safe-area-inset-top,0px)] pb-2 lg:py-2 mb-2 sm:mb-3 ${scrolled ? 'is-scrolled' : ''} transition-shadow duration-300 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:gap-x-6`}>
          <${Header} onOpenFilters=${() => { setChatOpen(false); setFiltersOpen(true); }} onOpenChat=${openChat}
            viewToggle=${html`<${ViewToggle} view=${view} onChange=${changeView} placement="inline" />`}
            mobileControls=${html`<${MobileViewToggle} view=${view} onChange=${changeView} />`} />
          <${ViewToggle} view=${view} onChange=${changeView} placement="stacked" />
        </div>

        <!-- Banners and insights track the content column so the page reads as
             one centered composition on wide screens. -->
        <div class="max-w-5xl mx-auto">
          <div class="mb-3">
            <${TripInsights} onJump=${jumpTo} />
          </div>

          <${SyncConflictBar} />
          <${SyncStatusBar} />
          <${NoticeBar} notice=${notice} onDismiss=${dismissNotice} />
        </div>

        <main onTouchStart=${swipe.onTouchStart} onTouchEnd=${swipe.onTouchEnd}>
          ${viewPush
            ? html`<div ref=${viewStageRef} class="view-push-stage is-animating"
                style=${{ '--view-min-height': `${viewPush.minHeight}px` }}>
                ${renderViewPane(viewPush.from,
                  `view-pane-exit ${viewPush.direction === 'forward' ? 'view-push-out-forward' : 'view-push-out-back'}`,
                  `exit-${viewPush.from}`)}
                ${renderViewPane(viewPush.to,
                  `view-pane-enter ${viewPush.direction === 'forward' ? 'view-push-in-forward' : 'view-push-in-back'}`,
                  `enter-${viewPush.to}`)}
              </div>`
            : html`<div ref=${viewStageRef} class="view-push-stage">
                ${renderViewPane(view, 'view-pane-enter', `enter-${view}`)}
              </div>`}
        </main>
      </div>

      <${FilterPanel} open=${filtersOpen} onClose=${() => setFiltersOpen(false)} />

      <${TripChatPanel} open=${chatOpen} onClose=${() => setChatOpen(false)} onEnsureTimeline=${() => changeView('timeline')} onEnsureOpen=${() => setChatOpen(true)} />

      <!-- Only the German "Klaus" gag survives as a startup announcement — every
           other one-time announcement/onboarding-tour modal has been removed
           now that the chat's briefing receipt is the app's home screen. The
           mobile install/notifications card and the desktop notification prompt
           stay: they're functional permission gates, not announcements. -->
      ${klausAnnounce && html`<${KlausAnnounceModal} onDone=${() => setKlausAnnounce(false)} />`}
      ${!klausAnnounce && onboarding && html`<${MobileOnboard} who=${who} onDone=${() => setOnboarding(false)} />`}
      ${!klausAnnounce && !onboarding && desktopNotifyPrompt && html`<${DesktopNotificationPrompt} who=${who} onDone=${() => setDesktopNotifyPrompt(false)} />`}
      ${!klausAnnounce && !onboarding && !desktopNotifyPrompt && editRecap && html`<${TripEditRecapModal} recap=${editRecap} onDone=${dismissEditRecap} />`}

      <${DateChangeConfirmModal}
        pending=${dateChangePending}
        onConfirm=${confirmDateChange}
        onCancel=${cancelDateChange} />
      <${ConfirmHost} />
    </div>`;
}

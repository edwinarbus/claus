// Store: context + provider + persistence.
//
// Persistence is two-layered:
//   1) localStorage  — instant, offline cache (always on)
//   2) Supabase      — shared between Tyler & Edwin when configured (config.js)
// The shared copy is the source of truth when sync is on; localStorage is the
// fallback used for first paint and when offline.
import { html, useReducer, useEffect, useRef, useContext, createContext, useMemo, useState, useCallback } from '../html.js';
import { reducer, reconcileTransports } from './reducer.js';
import { initialTrip, STORAGE_KEY, SCHEMA_VERSION, enrichFromCatalog, migrateNorwayNiN, migrateKnownLodging } from './builders.js';
import {
  syncEnabled, fetchRemoteTripRow, prefetchRemoteTripRow, pushRemoteTrip, subscribeRemoteTrip,
  flushRemoteTrip, saveTripSnapshot, listTripSnapshots, fetchTripSnapshot,
} from './sync.js';
import { slotAssignmentAdvice, stopMoveAdvice } from '../data/planAdvice.js';
import { todayISO, daysBetween, addDays } from '../lib/dates.js';
import { summarizeTripEdit, composePlanEditNotification, editSummaryKey } from '../lib/editSummary.js';
import { diffPlanChanges } from '../lib/planChangeDiff.js';
import { notifyPlanChange, syncPushIdentity, showLocalPlanEditNotification } from '../lib/push.js';
import { DEFAULT_ACTOR, actorOrDefault, sameActor } from '../lib/actors.js';
import {
  CANONICAL_TRIP_DATES, DATE_CHANGING_ACTIONS, diffDateSchedules,
  fingerprintFromTrip, seedDateLock, datesChangedBetween, withDateLock,
} from '../lib/tripDateLock.js';

const TripContext = createContext(null);

// Plan-change pushes are batched: edits bundle for a short quiet period, with a
// hard cap so a long editing session still notifies the other traveler.
const PLAN_NOTIFY_DEBOUNCE_MS = 45 * 1000;
const PLAN_NOTIFY_MAX_WAIT_MS = 90 * 1000;

const WHO_KEY = 'scandiplan:who';
// Per-device "Plan only" preference (not synced). Without an explicit manual
// override, defaults OFF before/after the trip and ON while traveling.
const HIDE_RECS_KEY = 'scandiplan:hideRecs';
const HIDE_RECS_MANUAL_KEY = 'scandiplan:hideRecsManual';
// Which stop cards are collapsed. Pure per-device UI state — deliberately NOT
// part of the synced trip, so opening/closing a card never touches Supabase or
// version history (only real plan/itinerary edits do).
const COLLAPSE_KEY = 'scandiplan:collapsed';

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}') || {}; }
  catch { return {}; }
}
function saveCollapsed(map) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function loadHideRecsPrefs() {
  try {
    let manual = localStorage.getItem(HIDE_RECS_MANUAL_KEY) === '1';
    const stored = localStorage.getItem(HIDE_RECS_KEY);
    // Migrate: older builds stored '1'/'0' without a separate manual flag.
    if (!manual && stored != null) {
      manual = true;
      localStorage.setItem(HIDE_RECS_MANUAL_KEY, '1');
    }
    if (!manual) return { manual: false, value: null };
    return { manual: true, value: stored === '1' ? true : stored === '0' ? false : null };
  } catch {
    return { manual: false, value: null };
  }
}

// Today falls within the trip's date window (inclusive).
function isDuringTrip(trip) {
  if (!trip || !trip.startDate || !trip.endDate) return false;
  const today = todayISO();
  return daysBetween(trip.startDate, today) >= 0 && daysBetween(today, trip.endDate) >= 0;
}

const SKIP_META = new Set(['SET_STATE']);

function loadWho() {
  try {
    const saved = localStorage.getItem(WHO_KEY);
    const who = actorOrDefault(saved);
    if (who !== saved) localStorage.setItem(WHO_KEY, who);
    return who;
  } catch {
    return DEFAULT_ACTOR;
  }
}

const DATE_ACTION_LABELS = {
  SET_TRIP_DATES: 'Changing the trip start or end',
  SET_STOP_DATES: 'Changing how long a stop lasts',
  LOAD_DEFAULT_ROUTE: 'Loading the default route',
  ADD_STOP: 'Adding a stop',
  REMOVE_STOP: 'Removing a stop',
  MOVE_STOP: 'Moving a stop',
  REORDER_STOPS: 'Reordering stops',
  RESET_ALL: 'Clearing the trip',
};

// Catalog items that were retracted outright (e.g. the Copenhagen Jazz Festival,
// mistakenly shipped as a tier-1 must-do). Unlike normal catalog edits — which
// deliberately never touch a saved plan — these are corrections the travelers
// asked for, so they're stripped from saved rec pools AND day slots on load.
const RETIRED_ITEM_IDS = new Set(['cph-jazz']);

function isRetired(it) {
  return !!it && RETIRED_ITEM_IDS.has(it.sourceId || it.id);
}

function stripRetiredItems(trip) {
  if (!trip || !Array.isArray(trip.stops)) return trip;
  trip.stops = trip.stops.map((s) => ({
    ...s,
    recs: s.recs ? Object.fromEntries(Object.entries(s.recs).map(
      ([bucket, items]) => [bucket, (items || []).filter((it) => !isRetired(it))],
    )) : s.recs,
    days: (s.days || []).map((d) => ({
      ...d,
      slots: d.slots ? Object.fromEntries(Object.entries(d.slots).map(([key, v]) => [
        key,
        Array.isArray(v) ? v.filter((it) => !isRetired(it)) : (isRetired(v) ? null : v),
      ])) : d.slots,
    })),
  }));
  return trip;
}

export function migrate(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  // Forward-compatible defaults.
  if (parsed.name === 'My Scandinavia Trip' || parsed.name === 'Plandinavia' || parsed.name === 'Scandiplan') parsed.name = 'Claus';
  parsed.filterPrefs = parsed.filterPrefs || initialTrip().filterPrefs;
  // Heat/sun handling is always on now (the "Beat the heat" toggle was removed) —
  // force it true so day-plan advice and the sun flags apply for everyone.
  parsed.filterPrefs.avoidHeatPM = true;
  parsed.dismissedNudges = parsed.dismissedNudges || {};
  parsed.stops = parsed.stops || [];
  parsed.arrival = parsed.arrival || { mode: 'flight', from: '', note: '' };
  parsed.departure = parsed.departure || { mode: 'flight', to: '', note: '' };
  // Home airports for this trip: fly out from Toronto, fly home to San Francisco.
  // Only fill when blank so a manual edit is never overwritten.
  if (!parsed.arrival.from) parsed.arrival.from = 'YYZ (Toronto)';
  if (!parsed.departure.to) parsed.departure.to = 'SFO (San Francisco)';
  // Collapse legacy combined transport modes ("train + ferry") to the main one.
  parsed.stops = parsed.stops.map((s) => {
    const t = s.transportToNext;
    if (t && typeof t.mode === 'string' && t.mode.includes('+')) {
      return { ...s, transportToNext: { ...t, mode: t.mode.split('+')[0].trim() } };
    }
    return s;
  });
  stripRetiredItems(parsed);
  const prevVersion = parsed.version || 1;
  // v13: flip the Norway leg into the Norway-in-a-Nutshell order in place.
  if (prevVersion < 13) parsed = migrateNorwayNiN(parsed);
  parsed = migrateKnownLodging(parsed);
  if (!parsed.meta?.dateLock?.stops?.length) {
    parsed = withDateLock(parsed, seedDateLock(parsed));
  }
  parsed.meta = {
    ...(parsed.meta || {}),
    updatedBy: actorOrDefault(parsed.meta?.updatedBy),
  };
  parsed.version = SCHEMA_VERSION;
  // Backfill the richer catalog fields onto older saved items. On a version
  // bump, also fold in newly-curated catalog items (e.g. must-eat restaurants).
  // Then stamp each travel leg with the stop pair it belongs to (legacy saves
  // predate the stamp) so later stop edits can reset legs that go stale.
  return reconcileTransports(enrichFromCatalog(parsed, { addNew: prevVersion < SCHEMA_VERSION }));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('scandiplan:v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed) return null;
    return migrate(parsed);
  } catch (e) {
    console.warn('Claus: could not load saved trip', e);
    return null;
  }
}

function saveState(trip) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trip));
  } catch (e) {
    console.warn('Claus: could not save trip', e);
  }
}

function stampMeta(trip, who) {
  const actor = actorOrDefault(who);
  return {
    ...trip,
    meta: {
      ...(trip.meta || {}),
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    },
  };
}

// Authoritative last-save time for the shared trip (trip JSON meta, else DB row).
function savedAtFromTrip(trip, rowUpdatedAt) {
  return trip?.meta?.updatedAt || rowUpdatedAt || '';
}

// How much real itinerary a copy holds — used to avoid an empty remote row
// clobbering a full local plan (common when Supabase was seeded before anyone
// loaded the route).
function tripFootprint(t) {
  const stops = (t && t.stops) || [];
  let days = 0;
  let slotItems = 0;
  stops.forEach((s) => {
    (s.days || []).forEach((d) => {
      days += 1;
      const slots = d.slots || {};
      Object.values(slots).forEach((v) => {
        if (Array.isArray(v)) slotItems += v.length;
        else if (v) slotItems += 1;
      });
    });
  });
  return { stops: stops.length, days, slotItems };
}

function richerCopy(a, b) {
  if (a.stops !== b.stops) return a.stops > b.stops ? 1 : -1;
  if (a.slotItems !== b.slotItems) return a.slotItems > b.slotItems ? 1 : -1;
  if (a.days !== b.days) return a.days > b.days ? 1 : -1;
  return 0;
}

function isLocalDirty(trip, lastPushedJson) {
  if (!lastPushedJson) return false;
  return JSON.stringify(trip) !== lastPushedJson;
}

function isSessionDirty(trip, baselineJson, syncReady) {
  if (!syncReady || !baselineJson) return false;
  return JSON.stringify(trip) !== baselineJson;
}

const UNDO_LIMIT = 60;
const SAVE_DEBOUNCE_MS = 350;
const SNAPSHOT_DEBOUNCE_MS = 3 * 60 * 1000; // save once after 3 min of inactivity

export function TripProvider({ children }) {
  const [trip, rawDispatch] = useReducer(reducer, undefined, () => {
    const saved = loadState();
    if (saved) return migrate(saved) || initialTrip();
    // DEMO: no saved trip yet → seed the curated route starting TOMORROW, so a
    // fresh browser opens straight into a full itinerary (no backend, no empty
    // state). Reuses the exact "Load default route" reducer path.
    return reducer(initialTrip(), { type: 'LOAD_DEFAULT_ROUTE', startDate: addDays(todayISO(), 1) });
  });
  const tripRef = useRef(trip);
  tripRef.current = trip;
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);
  const lastPlanEditNoticeRef = useRef({ key: '', at: 0 });

  // Undo history: snapshots of the trip *before* each local mutation. Cleared
  // when a remote update replaces the trip (can't meaningfully undo past that).
  const undoStack = useRef([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const clearUndo = () => { undoStack.current = []; setUndoDepth(0); };

  function showNotice(n) {
    if (!n) return;
    setNotice(n);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 8000);
  }

  function showPlanEditNotice(by, changes) {
    if (!by || !changes?.length) return;
    const text = changes[0];
    const key = `${by}\0${text}\0${changes.length}`;
    const now = Date.now();
    if (lastPlanEditNoticeRef.current.key === key && now - lastPlanEditNoticeRef.current.at < 120000) return;
    lastPlanEditNoticeRef.current = { key, at: now };
    setNotice({
      kind: 'plan-edit',
      level: 'warn',
      by,
      text,
      more: changes.length - 1,
    });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 12000);
  }

  const saveTimer = useRef(null);
  const snapshotTimer = useRef(null);
  const lastPushedJsonRef = useRef(null);
  const echoJsonRef = useRef(null);
  const lastSnapshotJsonRef = useRef(null);
  const pendingEditSummariesRef = useRef([]);
  const planNotifyTimerRef = useRef(null);
  const planNotifyStartedRef = useRef(0);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [sync, setSync] = useState(() => {
    const on = syncEnabled();
    let at = '';
    if (on) {
      try {
        const raw = loadState();
        at = savedAtFromTrip(migrate(raw));
      } catch { /* ignore */ }
    }
    return { on, status: on ? 'connecting' : 'local', at };
  });
  const [syncReady, setSyncReady] = useState(() => !syncEnabled());
  const [syncConflict, setSyncConflict] = useState(null);
  const [dateChangePending, setDateChangePending] = useState(null);
  const initialSyncDoneRef = useRef(false);
  const sessionBaselineJsonRef = useRef(null);
  const datePushApprovedRef = useRef(false);
  const [who, setWhoState] = useState(loadWho);
  const whoRef = useRef(who);
  whoRef.current = who;

  const maybeNotifyRemoteEdit = useCallback((before, after) => {
    if (!initialSyncDoneRef.current) return;
    const updatedBy = actorOrDefault(after.meta?.updatedBy);
    if (sameActor(updatedBy, whoRef.current)) return;
    const changes = diffPlanChanges(before, after);
    if (!changes.length) return;
    const body = changes[0];
    if (document.visibilityState === 'hidden') {
      showLocalPlanEditNotification(updatedBy, body).catch(() => {});
      return;
    }
    showPlanEditNotice(updatedBy, changes);
  }, []);

  const setWho = (name) => {
    const actor = actorOrDefault(name);
    setWhoState(actor);
    try { localStorage.setItem(WHO_KEY, actor); } catch { /* ignore */ }
    syncPushIdentity(actor).catch(() => {});
  };

  const hideRecsInit = loadHideRecsPrefs();
  const [hideRecsManual, setHideRecsManual] = useState(hideRecsInit.manual);
  const [hideRecsPref, setHideRecsPref] = useState(hideRecsInit.value);
  const setHideRecs = useCallback((v) => {
    const on = !!v;
    setHideRecsManual(true);
    setHideRecsPref(on);
    try {
      localStorage.setItem(HIDE_RECS_MANUAL_KEY, '1');
      localStorage.setItem(HIDE_RECS_KEY, on ? '1' : '0');
    } catch { /* ignore */ }
  }, []);
  const resetHideRecsToAuto = useCallback(() => {
    setHideRecsManual(false);
    setHideRecsPref(null);
    try {
      localStorage.removeItem(HIDE_RECS_MANUAL_KEY);
      localStorage.removeItem(HIDE_RECS_KEY);
    } catch { /* ignore */ }
  }, []);
  const hideRecs = hideRecsManual && hideRecsPref != null ? hideRecsPref : isDuringTrip(trip);

  const applyRemote = useCallback((nextTrip, json, rowUpdatedAt) => {
    lastPushedJsonRef.current = json;
    echoJsonRef.current = json;
    // Treat the just-loaded remote as already-saved so the autosave it triggers
    // doesn't spawn a fresh snapshot for an unedited trip.
    lastSnapshotJsonRef.current = json;
    sessionBaselineJsonRef.current = json;
    clearUndo();
    saveState(nextTrip);
    rawDispatch({ type: 'SET_STATE', trip: nextTrip });
    setSync({ on: true, status: 'synced', at: savedAtFromTrip(nextTrip, rowUpdatedAt) });
  }, []);

  const maybeSnapshot = useCallback((trip, { force = false, label = '' } = {}) => {
    if (!syncEnabled()) return;
    const json = JSON.stringify(trip);
    if (!force && json === lastSnapshotJsonRef.current) return;
    if (force) {
      // Forced snapshots (e.g. manual save) fire immediately and cancel any pending debounce.
      clearTimeout(snapshotTimer.current);
      saveTripSnapshot(trip, { label, force }).then((id) => {
        if (id) lastSnapshotJsonRef.current = json;
      });
      return;
    }
    // Debounce: reset the timer on every edit, fire once editing goes quiet.
    clearTimeout(snapshotTimer.current);
    snapshotTimer.current = setTimeout(() => {
      const current = JSON.stringify(tripRef.current);
      if (current === lastSnapshotJsonRef.current) return;
      saveTripSnapshot(tripRef.current, { label }).then((id) => {
        if (id) lastSnapshotJsonRef.current = current;
      });
    }, SNAPSHOT_DEBOUNCE_MS);
  }, []);

  // Send the batched plan-change push now (bundle every pending edit summary
  // into one notification). `keepalive` lets the request survive a closing tab.
  const flushPlanNotify = useCallback((opts = {}) => {
    clearTimeout(planNotifyTimerRef.current);
    planNotifyTimerRef.current = null;
    planNotifyStartedRef.current = 0;
    const summaries = pendingEditSummariesRef.current;
    if (!summaries.length) return;
    pendingEditSummariesRef.current = [];
    const editor = actorOrDefault(tripRef.current?.meta?.updatedBy || whoRef.current);
    let summary = '';
    try {
      summary = composePlanEditNotification(summaries);
    } catch (e) {
      console.warn('Claus: plan-change summary failed', e);
      return;
    }
    if (!summary) return;
    notifyPlanChange({ editor, summary, keepalive: !!opts.keepalive }).catch((e) => {
      console.warn('Claus: plan-change push failed', e);
    });
  }, []);

  // Debounce after the last saved edit; cap wait so continuous editing still
  // notifies within a minute of the first change in a burst.
  const schedulePlanNotify = useCallback(() => {
    if (!pendingEditSummariesRef.current.length) return;
    if (!planNotifyStartedRef.current) planNotifyStartedRef.current = Date.now();
    clearTimeout(planNotifyTimerRef.current);
    const elapsed = Date.now() - planNotifyStartedRef.current;
    const delay = elapsed >= PLAN_NOTIFY_MAX_WAIT_MS ? 0 : PLAN_NOTIFY_DEBOUNCE_MS;
    planNotifyTimerRef.current = setTimeout(flushPlanNotify, delay);
  }, [flushPlanNotify]);

  const persistTrip = useCallback(async (trip, {
    snapshot = true, snapshotLabel = '', allowDatePush = false,
  } = {}) => {
    saveState(trip);
    if (!syncEnabled()) return true;
    const json = JSON.stringify(trip);
    if (json === lastPushedJsonRef.current) return true;

    if (!allowDatePush && !datePushApprovedRef.current && lastPushedJsonRef.current) {
      let prev;
      try { prev = JSON.parse(lastPushedJsonRef.current); } catch { prev = null; }
      const rows = prev ? diffDateSchedules(prev, trip) : [];
      if (rows.length) {
        setDateChangePending({
          action: null,
          rows,
          actionLabel: 'Saving itinerary date changes to the shared trip',
          pushTrip: trip,
          snapshot,
          snapshotLabel,
        });
        setSync((s) => ({ ...s, on: true, status: 'error' }));
        return false;
      }
    }

    echoJsonRef.current = json;
    setSync((s) => ({ ...s, on: true, status: 'saving' }));
    const ok = await pushRemoteTrip(trip);
    if (ok) {
      lastPushedJsonRef.current = json;
      sessionBaselineJsonRef.current = json;
      datePushApprovedRef.current = false;
      setSync({ on: true, status: 'synced', at: savedAtFromTrip(trip) });
      if (snapshot) await maybeSnapshot(trip, { label: snapshotLabel });
      schedulePlanNotify();
    } else {
      setSync((s) => ({ ...s, on: true, status: 'error' }));
    }
    return ok;
  }, [maybeSnapshot, schedulePlanNotify]);

  const handleIncomingRemote = useCallback((incoming, rowUpdatedAt) => {
    const next = migrate(incoming);
    if (!next) return;
    const json = JSON.stringify(next);
    if (json === echoJsonRef.current) return;        // our own write echoed back
    const local = tripRef.current;
    if (json === JSON.stringify(local)) return;       // already identical — nothing to do

    const localFp = tripFootprint(local);
    const remoteFp = tripFootprint(next);
    const localTime = local.meta?.updatedAt || '';
    const remoteTime = next.meta?.updatedAt || rowUpdatedAt || '';
    const updatedBy = actorOrDefault(next.meta?.updatedBy);
    const mine = sameActor(updatedBy, whoRef.current);
    const sessionDirty = isSessionDirty(local, sessionBaselineJsonRef.current, initialSyncDoneRef.current);
    const dirty = sessionDirty || isLocalDirty(local, lastPushedJsonRef.current);
    // Recency is the source of truth: only adopt remote when it was edited LATER
    // than our copy. This stops a stale tab/device (which may hold a larger but
    // older plan) from overwriting newer edits — the cause of "it loaded an old
    // version." ISO-8601 strings compare chronologically.
    const remoteNewer = !!remoteTime && (!localTime || remoteTime > localTime);
    const localNewer = !!localTime && (!remoteTime || localTime > remoteTime);

    // 1. Never accept an empty remote clobbering a real plan — restore from local.
    if (localFp.stops > 0 && remoteFp.stops === 0) {
      if (dirty && !mine) {
        setSyncConflict({ pendingTrip: next, updatedBy, updatedAt: remoteTime });
        setSync((s) => ({ ...s, on: true, status: 'synced', at: remoteTime || s.at }));
        return;
      }
      persistTrip(local, { snapshot: false });
      return;
    }

    // 2. Mid-edit locally: never clobber unsaved work. Surface a conflict only for
    //    someone else's strictly-newer change so you can choose.
    if (dirty) {
      if (!mine && remoteNewer) {
        setSyncConflict({ pendingTrip: next, updatedBy, updatedAt: remoteTime });
        setSync((s) => ({ ...s, on: true, status: 'synced', at: remoteTime || s.at }));
      }
      return;
    }

    // 3. Adopt the remote only if it is the more recent edit (yours from another
    //    tab/device, or theirs).
    if (remoteNewer) {
      maybeNotifyRemoteEdit(local, next);
      applyRemote(next, json, rowUpdatedAt);
      return;
    }

    // 4. Our local copy is newer — only push back if the user edited this session.
    if (localNewer) {
      if (sessionDirty) persistTrip(local, { snapshot: false });
      return;
    }

    // 5. Timestamps tie/unknown: take the richer copy unless we have local edits.
    const rc = richerCopy(localFp, remoteFp);
    if (!sessionDirty && (rc < 0 || (rc === 0 && json < JSON.stringify(local)))) {
      maybeNotifyRemoteEdit(local, next);
      applyRemote(next, json, rowUpdatedAt);
      return;
    }
    if (sessionDirty) persistTrip(local, { snapshot: false });
  }, [applyRemote, persistTrip, maybeNotifyRemoteEdit]);

  const acceptRemote = useCallback(() => {
    if (!syncConflict?.pendingTrip) return;
    const next = syncConflict.pendingTrip;
    const json = JSON.stringify(next);
    setSyncConflict(null);
    applyRemote(next, json);
  }, [syncConflict, applyRemote]);

  const keepLocal = useCallback(async () => {
    const ok = await persistTrip(tripRef.current, { snapshot: true, snapshotLabel: 'Before conflict merge' });
    if (ok) setSyncConflict(null);
  }, [persistTrip]);

  const dismissSyncConflict = useCallback(() => {
    setSyncConflict(null);
  }, []);

  const retrySync = useCallback(async () => {
    if (!syncEnabled()) return;
    await persistTrip(tripRef.current);
  }, [persistTrip]);

  const loadSnapshots = useCallback(async () => {
    setSnapshotsLoading(true);
    try {
      const rows = await listTripSnapshots(25);
      setSnapshots(rows);
    } finally {
      setSnapshotsLoading(false);
    }
  }, []);

  const saveSnapshotNow = useCallback(async (label = 'Manual save') => {
    const current = stampMeta(tripRef.current, whoRef.current);
    rawDispatch({ type: 'SET_STATE', trip: current });
    await maybeSnapshot(current, { force: true, label });
    await loadSnapshots();
  }, [maybeSnapshot, loadSnapshots]);

  // ---- Collapse: per-device UI state, never synced ----
  const [collapsedStops, setCollapsedStops] = useState(loadCollapsed);
  const collapsedRef = useRef(collapsedStops);
  collapsedRef.current = collapsedStops;
  const isStopCollapsed = useCallback((id) => {
    const m = collapsedRef.current;
    return id in m ? !!m[id] : true;
  }, []);
  const toggleStopCollapse = useCallback((id) => {
    setCollapsedStops((m) => {
      const cur = id in m ? !!m[id] : true;
      const next = { ...m, [id]: !cur };
      saveCollapsed(next);
      return next;
    });
  }, []);
  const expandStop = useCallback((id) => {
    setCollapsedStops((m) => {
      if (m[id] === false) return m;
      const next = { ...m, [id]: false };
      saveCollapsed(next);
      return next;
    });
  }, []);

  const restoreSnapshot = useCallback(async (id) => {
    const raw = await fetchTripSnapshot(id);
    if (!raw) return false;
    await maybeSnapshot(tripRef.current, { force: true, label: 'Before restore' });
    const next = migrate(raw);
    if (!next) return false;
    let stamped = stampMeta(next, whoRef.current);
    stamped = withDateLock(stamped, fingerprintFromTrip(stamped));
    const json = JSON.stringify(stamped);
    clearUndo();
    rawDispatch({ type: 'SET_STATE', trip: stamped });
    saveState(stamped);
    lastPushedJsonRef.current = json;
    echoJsonRef.current = json;
    sessionBaselineJsonRef.current = json;
    lastSnapshotJsonRef.current = json;
    datePushApprovedRef.current = true;
    tripRef.current = stamped;
    const ok = await pushRemoteTrip(stamped);
    setSync({
      on: true,
      status: ok ? 'synced' : 'error',
      at: ok ? stamped.meta?.updatedAt : undefined,
    });
    await loadSnapshots();
    return ok;
  }, [maybeSnapshot, loadSnapshots]);

  const cancelDateChange = useCallback(() => {
    setDateChangePending(null);
  }, []);

  const confirmDateChange = useCallback(async () => {
    const pending = dateChangePending;
    if (!pending) return;
    setDateChangePending(null);

    if (pending.pushTrip) {
      datePushApprovedRef.current = true;
      const locked = withDateLock(pending.pushTrip, fingerprintFromTrip(pending.pushTrip));
      tripRef.current = locked;
      rawDispatch({ type: 'SET_STATE', trip: locked });
      await persistTrip(locked, {
        snapshot: pending.snapshot !== false,
        snapshotLabel: pending.snapshotLabel || '',
        allowDatePush: true,
      });
      return;
    }

    if (pending.action) {
      applyDispatchAction({ ...pending.action, dateChangeConfirmed: true });
    }
  }, [dateChangePending, persistTrip]);

  function applyDispatchAction(action, { refreshDateLock = false } = {}) {
    const t = tripRef.current;
    if (!SKIP_META.has(action.type) && action.who === undefined) {
      action = { ...action, who: actorOrDefault(whoRef.current) };
    }
    if (action.type === 'ASSIGN_TO_SLOT') {
      const stop = t.stops.find((s) => s.id === action.stopId);
      const day = stop && stop.days.find((d) => d.date === action.date);
      if (stop && day && action.item) {
        showNotice(slotAssignmentAdvice(stop, day, action.slotKey, action.item));
      }
    }
    if (action.type === 'MOVE_STOP') {
      const idx = t.stops.findIndex((s) => s.id === action.stopId);
      const target = idx + action.dir;
      showNotice(stopMoveAdvice(t, idx, target));
    }
    if (!SKIP_META.has(action.type)) {
      const next = reducer(t, action);
      if (next === t) return;
      const editSummary = summarizeTripEdit(t, next, action);
      if (editSummary) {
        const key = editSummaryKey(editSummary);
        const recent = pendingEditSummariesRef.current.filter((s) => editSummaryKey(s) !== key);
        pendingEditSummariesRef.current = [...recent, editSummary].slice(-6);
      }
      undoStack.current.push(t);
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      setUndoDepth(undoStack.current.length);
      let stamped = stampMeta(next, whoRef.current);
      if (refreshDateLock || action.dateChangeConfirmed) {
        stamped = withDateLock(stamped, fingerprintFromTrip(stamped));
        datePushApprovedRef.current = true;
      }
      tripRef.current = stamped;
      rawDispatch({ type: 'SET_STATE', trip: stamped });
      if (action.type === 'ADD_STOP') {
        const fresh = next.stops.find((s) => !t.stops.some((o) => o.id === s.id));
        if (fresh) expandStop(fresh.id);
      }
      return;
    }
    rawDispatch(action);
  }

  const dispatch = (action) => {
    if (action.skipDateGuard || action.dateChangeConfirmed) {
      const { skipDateGuard, dateChangeConfirmed, ...rest } = action;
      applyDispatchAction(rest, { refreshDateLock: !!dateChangeConfirmed });
      return;
    }
    if (DATE_CHANGING_ACTIONS.has(action.type)) {
      const preview = reducer(tripRef.current, action);
      if (preview === tripRef.current) return;
      const rows = diffDateSchedules(tripRef.current, preview);
      if (rows.length) {
        setDateChangePending({
          action,
          rows,
          actionLabel: DATE_ACTION_LABELS[action.type] || 'Changing itinerary dates',
        });
        return;
      }
    }
    applyDispatchAction(action);
  };

  // Restore the trip to just before the last local mutation.
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    setUndoDepth(undoStack.current.length);
    if (prev == null) return;
    // Drop the matching pending edit summary so undoing a change before the
    // debounced push fires never notifies the other traveler about an edit that
    // no longer exists. If that empties the queue, cancel the scheduled push.
    pendingEditSummariesRef.current = pendingEditSummariesRef.current.slice(0, -1);
    if (!pendingEditSummariesRef.current.length) {
      clearTimeout(planNotifyTimerRef.current);
      planNotifyTimerRef.current = null;
      planNotifyStartedRef.current = 0;
    }
    rawDispatch({ type: 'SET_STATE', trip: stampMeta(prev, whoRef.current) });
  }, []);

  const dismissNotice = () => {
    setNotice(null);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  };

  const hydratedRef = useRef(false);

  // Initial remote load + live subscription.
  useEffect(() => {
    if (!syncEnabled()) {
      initialSyncDoneRef.current = true;
      sessionBaselineJsonRef.current = JSON.stringify(tripRef.current);
      return undefined;
    }
    let cancelled = false;

    const finishInitialSync = (json, { markSynced = true, rowUpdatedAt } = {}) => {
      initialSyncDoneRef.current = true;
      setSyncReady(true);
      sessionBaselineJsonRef.current = json;
      lastPushedJsonRef.current = json;
      lastSnapshotJsonRef.current = json;
      hydratedRef.current = true;
      if (markSynced) {
        let trip = null;
        try { trip = JSON.parse(json); } catch { /* ignore */ }
        setSync({ on: true, status: 'synced', at: savedAtFromTrip(trip, rowUpdatedAt) });
      }
    };

    (async () => {
      try {
        const row = await prefetchRemoteTripRow();
        if (cancelled) return;
        const remote = row?.data;
        const local = tripRef.current;

        if (remote) {
          const next = migrate(remote);
          const remoteJson = JSON.stringify(next);
          const localJson = JSON.stringify(local);

          if (remoteJson === localJson) {
            applyRemote(next, remoteJson, row?.updated_at);
            finishInitialSync(remoteJson, { rowUpdatedAt: row?.updated_at });
            return;
          }

          const localFp = tripFootprint(local);
          const remoteFp = tripFootprint(next);

          // Empty remote with a real local plan — recover once (no snapshot on open).
          if (localFp.stops > 0 && remoteFp.stops === 0) {
            await persistTrip(local, { snapshot: false, allowDatePush: true });
            finishInitialSync(localJson, { rowUpdatedAt: local.meta?.updatedAt });
            return;
          }

          // Fresh device — take the shared trip.
          if (localFp.stops === 0 && remoteFp.stops > 0) {
            applyRemote(next, remoteJson, row?.updated_at);
            finishInitialSync(remoteJson, { rowUpdatedAt: row?.updated_at });
            return;
          }

          // Both differ: the shared server copy wins on cold open. Refresh this
          // browser's cache so stale localStorage cannot push back on autosave.
          applyRemote(next, remoteJson, row?.updated_at);
          finishInitialSync(remoteJson, { rowUpdatedAt: row?.updated_at });

          const localTime = local.meta?.updatedAt || '';
          const remoteTime = next.meta?.updatedAt || row?.updated_at || '';
          if (localJson !== remoteJson && localTime && remoteTime && localTime > remoteTime) {
            setSyncConflict({
              pendingTrip: local,
              updatedBy: actorOrDefault(local.meta?.updatedBy),
              updatedAt: localTime,
              kind: 'stale-local',
            });
          }
        } else {
          const seeded = migrate(loadState() || initialTrip()) || initialTrip();
          const stamped = stampMeta(seeded, whoRef.current);
          await persistTrip(stamped, { snapshot: true, snapshotLabel: 'Initial sync', allowDatePush: true });
          const json = JSON.stringify(stamped);
          rawDispatch({ type: 'SET_STATE', trip: stamped });
          finishInitialSync(json, { rowUpdatedAt: stamped.meta?.updatedAt });
        }
      } catch (e) {
        console.warn('Claus: initial sync failed', e);
        if (cancelled) return;
        finishInitialSync(JSON.stringify(tripRef.current), { markSynced: false });
        setSync({ on: true, status: 'error' });
      }
    })();
    const unsub = subscribeRemoteTrip((incoming, rowUpdatedAt) => {
      if (!cancelled) handleIncomingRemote(incoming, rowUpdatedAt);
    });
    return () => { cancelled = true; unsub(); };
  }, [applyRemote, handleIncomingRemote, persistTrip]);

  // PWA / tab resume: pull the shared trip when the app comes back to the
  // foreground so a home-screen icon doesn't sit on yesterday's localStorage.
  useEffect(() => {
    if (!syncEnabled()) return undefined;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || !initialSyncDoneRef.current) return;
      fetchRemoteTripRow().then((row) => {
        if (row?.data) handleIncomingRemote(row.data, row.updated_at);
      });
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [handleIncomingRemote]);

  // Autosave on every trip change (local + Supabase + throttled snapshots).
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      lastSnapshotJsonRef.current = JSON.stringify(trip);
      return;
    }
    if (!initialSyncDoneRef.current) return;
    saveTimer.current = setTimeout(() => {
      persistTrip(trip);
    }, SAVE_DEBOUNCE_MS);
    return () => saveTimer.current && clearTimeout(saveTimer.current);
  }, [trip, persistTrip]);

  // Flush when the tab hides or closes.
  useEffect(() => {
    const flush = () => {
      if (!initialSyncDoneRef.current) return;
      const current = tripRef.current;
      saveState(current);
      let mayFlushRemote = datePushApprovedRef.current;
      if (!mayFlushRemote && lastPushedJsonRef.current) {
        try {
          mayFlushRemote = !datesChangedBetween(JSON.parse(lastPushedJsonRef.current), current);
        } catch { mayFlushRemote = true; }
      }
      if (mayFlushRemote) flushRemoteTrip(current);
      flushPlanNotify({ keepalive: true });
      if (snapshotTimer.current) {
        clearTimeout(snapshotTimer.current);
        snapshotTimer.current = null;
        const json = JSON.stringify(current);
        if (json !== lastSnapshotJsonRef.current && initialSyncDoneRef.current) {
          saveTripSnapshot(current).then((id) => {
            if (id) lastSnapshotJsonRef.current = json;
          });
        }
      }
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [flushPlanNotify]);

  // Plan-change pushes: when the app tab is in the foreground the service
  // worker posts here instead of showing a system notification.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onMessage = (e) => {
      const d = e.data;
      if (!d || d.type !== 'plan-change') return;
      const by = actorOrDefault(d.editor);
      const body = String(d.body || '').trim().replace(/\.\s*$/, '');
      if (!body || sameActor(by, whoRef.current)) return;
      showPlanEditNotice(by, [body]);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  const value = useMemo(() => ({
    trip,
    dispatch,
    undo,
    canUndo: undoDepth > 0,
    sync,
    syncReady,
    who,
    setWho,
    hideRecs,
    hideRecsManual,
    setHideRecs,
    resetHideRecsToAuto,
    notice,
    dismissNotice,
    syncConflict,
    acceptRemote,
    keepLocal,
    dismissSyncConflict,
    retrySync,
    dateChangePending,
    confirmDateChange,
    cancelDateChange,
    snapshots,
    snapshotsLoading,
    loadSnapshots,
    saveSnapshotNow,
    restoreSnapshot,
    collapsedStops,
    isStopCollapsed,
    toggleStopCollapse,
    expandStop,
  }), [trip, undo, undoDepth, sync, syncReady, who, hideRecs, hideRecsManual, setHideRecs, resetHideRecsToAuto, notice, syncConflict, acceptRemote, keepLocal, dismissSyncConflict, retrySync, dateChangePending, confirmDateChange, cancelDateChange, snapshots, snapshotsLoading, loadSnapshots, saveSnapshotNow, restoreSnapshot, collapsedStops, isStopCollapsed, toggleStopCollapse, expandStop]);

  return html`<${TripContext.Provider} value=${value}>${children}<//>`;
}

export function useStore() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useStore must be used within TripProvider');
  return ctx;
}

export function useTrip() {
  return useStore().trip;
}

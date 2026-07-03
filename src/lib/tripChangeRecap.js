// Compare the shared trip against what this user last saw on this device and
// produce a short list for the load-time recap modal.

import { migrate } from '../store/store.js';
import { diffPlanChanges } from './planChangeDiff.js';
import { actorOrDefault, sameActor } from './actors.js';

const STORAGE_PREFIX = 'scandiplan:lastSeenTrip:v1';

function storageKey(who) {
  return `${STORAGE_PREFIX}:${who || 'anonymous'}`;
}

export function loadLastSeenTrip(who) {
  if (!who) return null;
  try {
    const raw = localStorage.getItem(storageKey(who));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.trip) return null;
    return { savedAt: parsed.savedAt || '', trip: migrate(parsed.trip) };
  } catch {
    return null;
  }
}

export function saveLastSeenTrip(who, trip) {
  if (!who || !trip) return;
  try {
    localStorage.setItem(storageKey(who), JSON.stringify({
      savedAt: new Date().toISOString(),
      trip,
    }));
  } catch { /* quota */ }
}

export function buildTripChangeRecap(who, trip) {
  if (!who || !trip) return null;
  const current = migrate(trip);
  const last = loadLastSeenTrip(who);
  if (!last?.trip) {
    saveLastSeenTrip(who, current);
    return null;
  }

  const changes = diffPlanChanges(last.trip, current);
  if (!changes.length) {
    saveLastSeenTrip(who, current);
    return null;
  }

  const updatedBy = actorOrDefault(current.meta?.updatedBy || who);
  const updatedAt = current.meta?.updatedAt || '';
  let subtitle = '';
  if (!sameActor(updatedBy, who)) {
    subtitle = updatedAt
      ? `${updatedBy} updated the plan while you were away`
      : `Changes from ${updatedBy}`;
  } else {
    subtitle = 'Updates since your last visit';
  }

  return {
    changes: changes.map((text) => ({ by: updatedBy, text })),
    subtitle,
    since: last.savedAt,
    updatedBy,
  };
}

export function acknowledgeTripRecap(who, trip) {
  if (!who || !trip) return;
  saveLastSeenTrip(who, migrate(trip));
}

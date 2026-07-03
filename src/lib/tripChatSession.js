// Per-user Claus chat history in localStorage (device-local, not synced).

import { TRIP_ID } from '../config.js';

const STORAGE_KEY = 'scandiplan:tripChat:v1';
const MAX_MESSAGES = 60;
const MAX_CONTENT_LEN = 16_000;

function storageKey(who, tripId = TRIP_ID) {
  const user = (who || '').trim() || 'anonymous';
  return `${user}:${tripId}`;
}

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota exceeded or private mode — chat still works, just won't persist.
  }
}

function sanitizeMessage(msg) {
  if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) return null;
  const content = typeof msg.content === 'string' ? msg.content.slice(0, MAX_CONTENT_LEN) : '';
  if (msg.role === 'assistant' && !content) return null;
  return { role: msg.role, content };
}

// The daily briefing is derived UI (re-fetched from /api/concierge on every
// load and rendered as the receipt), never conversation history. Skip it when
// persisting so it can't be resurrected as a plain chat bubble beside the fresh
// receipt. Match the live `concierge` flag AND — for briefs an older build
// already flattened into localStorage — the brief's distinctive section text.
function isConciergeBrief(m) {
  if (!m) return false;
  if (m.concierge) return true;
  if (m.role !== 'assistant') return false;
  const c = typeof m.content === 'string' ? m.content : '';
  return /GETTING AROUND/i.test(c) && /TODAY.?S PLAN/i.test(c);
}

export function serializeTripChatMessages(messages, { streaming = false } = {}) {
  let list = Array.isArray(messages) ? messages : [];
  if (streaming && list.length) {
    const last = list[list.length - 1];
    if (last?.role === 'assistant' && !last.content) list = list.slice(0, -1);
  }
  return list
    .filter((m) => !isConciergeBrief(m))
    .map(sanitizeMessage)
    .filter(Boolean)
    .slice(-MAX_MESSAGES);
}

export function loadTripChatSession(who, tripId = TRIP_ID) {
  const key = storageKey(who, tripId);
  const entry = readAll()[key];
  if (!entry || typeof entry !== 'object') {
    return { messages: [], previousResponseId: null, lastContextHash: null };
  }
  const messages = serializeTripChatMessages(entry.messages);
  const previousResponseId = typeof entry.previousResponseId === 'string'
    ? entry.previousResponseId
    : null;
  const lastContextHash = typeof entry.lastContextHash === 'string'
    ? entry.lastContextHash
    : null;
  return { messages, previousResponseId, lastContextHash };
}

export function saveTripChatSession(who, tripId, session, { streaming = false } = {}) {
  const key = storageKey(who, tripId);
  const messages = serializeTripChatMessages(session?.messages, { streaming });
  const previousResponseId = typeof session?.previousResponseId === 'string'
    ? session.previousResponseId
    : null;
  const lastContextHash = typeof session?.lastContextHash === 'string'
    ? session.lastContextHash
    : null;

  const all = readAll();
  if (!messages.length && !previousResponseId) {
    if (all[key]) {
      delete all[key];
      writeAll(all);
    }
    return;
  }

  all[key] = {
    messages,
    previousResponseId,
    lastContextHash,
    updatedAt: new Date().toISOString(),
  };
  writeAll(all);
}

export function clearTripChatSession(who, tripId = TRIP_ID) {
  const key = storageKey(who, tripId);
  const all = readAll();
  if (!all[key]) return;
  delete all[key];
  writeAll(all);
}

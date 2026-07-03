// Web Push client for morning briefs and shared-plan edit alerts.
//
// iOS reality check: Safari only exposes Notification/PushManager to web apps
// that have been ADDED TO THE HOME SCREEN (iOS 16.4+), and the permission
// prompt must come from a user gesture. So the flow is: Add to Home Screen →
// open the app from there → tap "Enable notifications" (MobileOnboard or
// Settings) → permission prompt → we subscribe and register the subscription
// with /api/push, where the daily cron and edit alerts pick it up. Desktop
// browsers can subscribe directly from the normal web app.

import { VAPID_PUBLIC_KEY } from '../config.js';

const SW_URL = './sw.js';

export function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  } catch { return false; }
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function notificationPermission() {
  try { return ('Notification' in window) ? Notification.permission : 'unsupported'; }
  catch { return 'unsupported'; }
}

export function isIOSLike() {
  try {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch { return false; }
}

// Registered on every load so the worker stays current and an existing push
// subscription keeps a live handler. Safe no-op where SW is unsupported.
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: './' });
    reg.update().catch(() => {});
    return reg;
  } catch (e) {
    console.warn('Claus: service worker registration failed', e);
    return null;
  }
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getExistingSubscription() {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch { return null; }
}

function unsupportedReason() {
  if (isIOSLike() && !isStandalone()) {
    return 'Add Claus to your Home Screen first, then enable notifications from inside the app.';
  }
  return 'Notifications are not supported in this browser.';
}

async function saveSubscription(who, sub, { preview = true } = {}) {
  const res = await fetch('/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'subscribe', who, subscription: sub.toJSON(), preview }),
  });
  return res.json().catch(() => ({})).then((data) => ({ res, data }));
}

// Full enable flow. Returns { ok, reason } — reason is a short, user-showable
// string when something blocks the subscription.
export async function subscribeToPush(who = '', { preview = true } = {}) {
  if (!pushSupported()) {
    return { ok: false, reason: unsupportedReason() };
  }
  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: 'Could not start the notification service.' };
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: 'Notifications are blocked — allow them in Settings to get the morning brief.' };
  }

  let sub;
  try {
    sub = await reg.pushManager.getSubscription()
      || await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
  } catch (e) {
    console.warn('Claus: push subscribe failed', e);
    return { ok: false, reason: 'Could not subscribe this device to push.' };
  }

  try {
    const { res, data } = await saveSubscription(who, sub, { preview });
    if (!res.ok || data.status !== 'ok') {
      return { ok: false, reason: data.message || 'The server could not store this device.' };
    }
    // The server pushes a preview brief on subscribe and reports how it went
    // ('sent', 'skipped (no VAPID_PRIVATE_KEY)', 'failed (403)', …) — pass it
    // through so the UI can say so instead of claiming a preview that never
    // left the server.
    return { ok: true, example: data.example || '' };
  } catch {
    return { ok: false, reason: 'Could not reach the server to register this device.' };
  }
}

export async function syncPushIdentity(who = '') {
  if (!pushSupported() || notificationPermission() !== 'granted') return false;
  const sub = await getExistingSubscription();
  if (!sub) return false;
  try {
    const { res, data } = await saveSubscription(who, sub, { preview: false });
    return res.ok && data.status === 'ok';
  } catch {
    return false;
  }
}

export async function notifyPlanChange({ editor = '', summary = '', keepalive = false } = {}) {
  if (!summary) return false;
  // Tell the server which device is doing the editing so it can be excluded
  // even when its registered `who` is stale or empty — the editor never needs
  // a push about their own change.
  let senderEndpoint = '';
  try { senderEndpoint = (await getExistingSubscription())?.endpoint || ''; } catch { /* best effort */ }
  try {
    const res = await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Batched notifications flush on pagehide; keepalive lets that last
      // request outlive the closing tab.
      keepalive,
      body: JSON.stringify({ action: 'plan-change', editor, summary, senderEndpoint }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'ok') {
      console.warn('Claus: plan-change push failed', data.message || data.note || res.status);
      return false;
    }
    if (!data.sent) {
      console.warn('Claus: plan-change push not delivered', data.note || data.message || 'no recipients');
    }
    return true;
  } catch (e) {
    console.warn('Claus: plan-change push failed', e);
    return false;
  }
}

// When a remote edit syncs in while this tab is backgrounded, show a local
// notification immediately — don't wait for the editor's device to flush push.
export async function showLocalPlanEditNotification(editor = '', body = '') {
  if (!editor || !body) return false;
  if (notificationPermission() !== 'granted') return false;
  if (document.visibilityState === 'visible') return false;
  const trimmed = String(body).replace(/\.\s*$/, '').trim();
  if (!trimmed) return false;
  // Match the push body: lead with a capital ("Updated transport…").
  const text = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  try {
    const reg = await registerServiceWorker();
    if (!reg) return false;
    await reg.showNotification(`${editor} updated the plan`, {
      body: text,
      tag: 'scandiplan-plan-change',
      renotify: true,
      icon: './favicon.png',
      badge: './favicon.png',
    });
    return true;
  } catch (e) {
    console.warn('Claus: local plan-change notification failed', e);
    return false;
  }
}

const WATCH_PING_KEY = 'claus-demo:tripWatchPing';
const WATCH_PING_MIN_MS = 30 * 60 * 1000;

// Nudge the server's disruption watch. The endpoint throttles itself (real
// checks at most every few hours) — this just hands it chances to run while
// someone has the app open during the trip, since Hobby-plan crons only fire
// once a day. Locally rate-limited so app-switching doesn't spam the API.
export function pingTripWatch() {
  try {
    const last = Number(localStorage.getItem(WATCH_PING_KEY) || 0);
    if (Date.now() - last < WATCH_PING_MIN_MS) return;
    localStorage.setItem(WATCH_PING_KEY, String(Date.now()));
    fetch('/api/trip-watch', { method: 'POST' }).catch(() => {});
  } catch { /* best effort */ }
}

export async function unsubscribeFromPush() {
  const sub = await getExistingSubscription();
  if (!sub) return { ok: true };
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* best effort */ }
  try {
    await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unsubscribe', endpoint }),
    });
  } catch { /* best effort */ }
  return { ok: true };
}

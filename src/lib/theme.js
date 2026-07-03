// Theme controller. Preference is one of 'system' | 'light' | 'dark', stored in
// localStorage. We resolve 'system' against the OS setting and drive the whole
// app off a single `dark` class on <html> — so an explicit Light/Dark choice
// always wins over the media query, and there's exactly one source of truth.
//
// The same resolution runs in a tiny inline <head> script (in index.html) so the
// first paint is already the right theme with no flash. This module owns the
// runtime: react to OS changes while on 'system', persist explicit choices,
// update the browser/PWA chrome color, and expose a React hook + a plain
// subscription (used by the maps to swap tile sets).

import { useState, useEffect } from '../html.js';

export const THEME_KEY = 'scandiplan.theme';
const VALID = new Set(['system', 'light', 'dark']);

// Status-bar / browser-chrome tone so Safari's URL bar and the iOS PWA region
// match the page (top of the body gradient in each theme).
const CHROME = { light: '#f4f3ee', dark: '#000000' };

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return VALID.has(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function systemPrefersDark() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

// The actual light/dark in effect for a given preference.
export function resolveTheme(pref) {
  const p = VALID.has(pref) ? pref : 'system';
  return p === 'dark' || (p === 'system' && systemPrefersDark()) ? 'dark' : 'light';
}

function applyResolved(resolved) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  root.style.backgroundColor = CHROME[resolved];
  const set = (name, content) => {
    const m = document.querySelector(`meta[name="${name}"]`);
    if (m) m.setAttribute('content', content);
  };
  set('color-scheme', resolved);
  set('supported-color-schemes', resolved);
  set('theme-color', CHROME[resolved]);
  // apple-mobile-web-app-status-bar-style stays "default" in BOTH themes:
  // modern iOS standalone colors the status-bar region from the page
  // background (which we just set), while "black" paints a solid black band.
}

// Subscribers are notified with the current preference; they recompute the
// resolved theme themselves (so 'system' subscribers update on OS changes too).
const listeners = new Set();
let current = getStoredTheme();

export function getThemePref() { return current; }
export function isDark() { return resolveTheme(current) === 'dark'; }

export function setThemePref(pref) {
  current = VALID.has(pref) ? pref : 'system';
  try { localStorage.setItem(THEME_KEY, current); } catch { /* private mode */ }
  applyResolved(resolveTheme(current));
  listeners.forEach((fn) => fn(current));
}

let mqlBound = false;
export function initTheme() {
  current = getStoredTheme();
  applyResolved(resolveTheme(current));
  if (mqlBound || typeof matchMedia !== 'function') return;
  mqlBound = true;
  const mql = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (current !== 'system') return;
    applyResolved(resolveTheme('system'));
    listeners.forEach((fn) => fn(current));
  };
  if (mql.addEventListener) mql.addEventListener('change', onChange);
  else if (mql.addListener) mql.addListener(onChange);
}

// Plain subscription handing back the RESOLVED theme ('light' | 'dark'), used by
// non-React consumers (Leaflet maps swapping tile sets). Returns an unsubscribe.
export function subscribeResolvedTheme(fn) {
  const wrap = () => fn(resolveTheme(current));
  listeners.add(wrap);
  return () => listeners.delete(wrap);
}

// React hook → [pref, setPref, resolved].
export function useTheme() {
  const [pref, setPref] = useState(current);
  useEffect(() => {
    const fn = (p) => setPref(p);
    listeners.add(fn);
    // Reconcile in case a change landed between module load and mount.
    fn(current);
    return () => listeners.delete(fn);
  }, []);
  return [pref, setThemePref, resolveTheme(pref)];
}

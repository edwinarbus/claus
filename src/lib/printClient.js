// Talk to the local Epson print bridge (scripts/printbridge.py). The browser
// renders + encodes the receipt; this just probes the bridge and POSTs the
// ESC/POS bytes. Also tracks which day we've already auto-printed so a new brief
// prints itself exactly once.

import { bytesToBase64 } from './escpos.js';

const URL_KEY = 'claus-demo:printBridgeUrl';
const PRINTED_KEY = 'claus-demo:printedBriefDate';
const DEFAULT_URL = 'http://localhost:8899';

export function bridgeUrl() {
  try { return localStorage.getItem(URL_KEY) || DEFAULT_URL; } catch { return DEFAULT_URL; }
}

export function setBridgeUrl(url) {
  try {
    if (url) localStorage.setItem(URL_KEY, url);
    else localStorage.removeItem(URL_KEY);
  } catch { /* ignore */ }
}

/** GET /health — returns the bridge status object, or null if unreachable. */
export async function probeBridge(timeoutMs = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${bridgeUrl()}/health`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.ok ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** POST /print with the raw ESC/POS byte stream. Throws on failure. */
export async function sendToPrinter(bytes) {
  const res = await fetch(`${bridgeUrl()}/print`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: bytesToBase64(bytes) }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || !j.ok) {
    throw new Error((j && j.error) || `bridge ${res.status}`);
  }
  return j;
}

// Auto-print bookkeeping: one print per brief date, so opening the app on the
// same day doesn't spew duplicates.
export function alreadyPrinted(date) {
  try { return localStorage.getItem(PRINTED_KEY) === String(date); } catch { return false; }
}

export function markPrinted(date) {
  try { localStorage.setItem(PRINTED_KEY, String(date)); } catch { /* ignore */ }
}

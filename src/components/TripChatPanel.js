import { html, useEffect, useLayoutEffect, useRef, useState, useMemo, Fragment } from '../html.js';
import { useStore } from '../store/store.js';
import { buildTripChatContext, tripContextHash, buildChatSuggestions, buildQueryTimeFocus, resolveWebSearchLocation } from '../lib/tripChatContext.js';
import {
  applyTicketMatch, applyTripChatActions, composeAgentReply, buildTripChatEditContext,
  buildDirectMealAddAction, isEditConfirmation, wantsTripEditTool,
  matchTicket, ticketFromFile, TICKET_ACCEPT, TICKET_MAX_FILE_BYTES,
} from '../lib/tripChatAgent.js';
import { ChatMarkdown } from '../lib/tripChatMarkdown.js';
import {
  clearTripChatSession, loadTripChatSession, saveTripChatSession,
} from '../lib/tripChatSession.js';
import { TRIP_ID } from '../config.js';
import { scrollToPlanTarget } from '../lib/planScroll.js';
import { celebrate } from '../lib/confetti.js';
import { BlockSpinner } from './BlockSpinner.js';
import { ActivitySection } from './TripChatActivity.js';
import { DayMap } from './DayMap.js';
import { findDayOnTrip } from '../lib/tripDay.js';
import { daysBetween } from '../lib/dates.js';
import { resolveItemCoords } from './useDayGeo.js';
import { renderReceiptCanvas } from '../lib/thermalReceipt.js';
import { canvasToEscpos } from '../lib/escpos.js';
import { probeBridge, sendToPrinter, alreadyPrinted, markPrinted } from '../lib/printClient.js';
import { phrasesForCountry } from '../data/phrases.js';
import { buildLocalBrief } from '../lib/localBrief.js';
import { Tooltip } from './Tooltip.js';
import { IconX, IconSend, IconGlobe, IconPaperclip, IconPlus, IconCheck, IconChevronDown } from './icons.js';
import { isKlausMode } from '../lib/klausMode.js';

const INPUT_MAX_PX = 112;
const CONCIERGE_SEEN_KEY = 'claus-demo:conciergeSeenAt';
const WIDTH_KEY = 'claus-demo:tripChatWidth:v1';
const HEIGHT_KEY = 'claus-demo:tripChatHeight:v1';
const POS_KEY = 'claus-demo:tripChatPos:v1';
const MIN_PANEL_PX = 320;
const MAX_PANEL_PX = 720;
const MIN_PANEL_H = 340;
const MAX_PANEL_H = 960;
// Gap (px) between the floating card and the viewport edges when docked
// bottom-right on desktop. Matches the Tailwind `bottom-4`/`right-4` anchor.
const PANEL_MARGIN = 16;

// "Thinking" in the languages of the trip's countries — Danish, Swedish,
// Norwegian (Bokmål), Finnish, Estonian — cycled as the warm-up placeholder.
const THINKING_WORDS = ['Tænker', 'Tänker', 'Thinking', 'Tenker', 'Ajattelee', 'Mõtleb'];
const THINKING_ROTATE_MS = 1300;

// The daily brief is ALWAYS surfaced as the chat's home screen; the seen-mark
// only gates the nightly nudge — we auto-OPEN the panel just once per genuinely
// new brief (tracked by its `latest.at` timestamp, keyed per trip). Reloading
// the same brief re-prints it in place without popping the panel open.
function conciergeSeenStorageKey(tripId = TRIP_ID) {
  return `${CONCIERGE_SEEN_KEY}:${tripId}`;
}

function loadConciergeSeen(tripId = TRIP_ID) {
  try {
    const v = parseInt(localStorage.getItem(conciergeSeenStorageKey(tripId)), 10);
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}

function saveConciergeSeen(at, tripId = TRIP_ID) {
  try { localStorage.setItem(conciergeSeenStorageKey(tripId), String(at)); } catch { /* ignore */ }
}

// Forget the mark so the next load treats the brief as new and re-opens the
// panel — used when the user starts a fresh chat.
function clearConciergeSeen(tripId = TRIP_ID) {
  try { localStorage.removeItem(conciergeSeenStorageKey(tripId)); } catch { /* ignore */ }
}

// Default to the smallest allowed size — the panel opens compact and the user
// grows it from there (their size persists).
function defaultPanelWidth() {
  return MIN_PANEL_PX;
}

function loadPanelWidth() {
  try {
    const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10);
    if (Number.isFinite(saved) && saved >= MIN_PANEL_PX && saved <= MAX_PANEL_PX) return saved;
  } catch { /* ignore */ }
  return defaultPanelWidth();
}

// The tallest the floating card may be: the gap between the top/bottom margins,
// so a tall saved height never overflows a short window.
function maxPanelHeight() {
  return Math.max(MIN_PANEL_H, Math.min(MAX_PANEL_H, window.innerHeight - PANEL_MARGIN * 2));
}

function defaultPanelHeight() {
  return Math.min(MIN_PANEL_H, maxPanelHeight());
}

function loadPanelHeight() {
  try {
    const saved = parseInt(localStorage.getItem(HEIGHT_KEY), 10);
    if (Number.isFinite(saved) && saved >= MIN_PANEL_H && saved <= MAX_PANEL_H) {
      return Math.min(saved, maxPanelHeight());
    }
  } catch { /* ignore */ }
  return defaultPanelHeight();
}

// Where the floating card is docked, as offsets from the viewport's right/bottom
// edges (so resizing, which grows toward the top-left, stays consistent). The
// user can drag it anywhere by its header; default is the bottom-right corner.
function loadPanelPos() {
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (saved && Number.isFinite(saved.right) && Number.isFinite(saved.bottom)) {
      return { right: Math.max(8, saved.right), bottom: Math.max(8, saved.bottom) };
    }
  } catch { /* ignore */ }
  return { right: PANEL_MARGIN, bottom: PANEL_MARGIN };
}

function panelCanResize() {
  try { return window.matchMedia('(min-width: 640px)').matches; }
  catch { return false; }
}

function resizeInput(el) {
  if (!el) return;
  const shell = el.closest('.trip-chat-input-shell');
  el.style.height = 'auto';
  const capped = Math.min(el.scrollHeight, INPUT_MAX_PX);
  const multiline = capped > 44;
  if (shell) shell.classList.toggle('trip-chat-input-shell--multiline', multiline);
  if (multiline) {
    el.style.height = `${capped}px`;
    el.style.overflowY = el.scrollHeight > INPUT_MAX_PX ? 'auto' : 'hidden';
  } else {
    el.style.height = '';
    el.style.overflowY = 'hidden';
  }
}

function normalizeChatError(message, name = 'Claus') {
  const m = String(message || '').trim();
  if (!m) return 'Something went wrong. Try again.';
  if (/error occurred while processing/i.test(m)) {
    return `${name} hit a server error (often on web-search turns). Try again, or tap New and ask without web search for itinerary-only answers.`;
  }
  if (/upstream|fetch_failed|502|503|429/i.test(m)) {
    return 'Live search timed out or hit a temporary Claude error. Wait a few seconds and try again.';
  }
  if (/no tool output found/i.test(m)) {
    return `${name} lost the previous tool step. I refreshed the edit context — try that add/edit again.`;
  }
  return m;
}

function isAppliedConfirmation(text) {
  const lines = String(text || '').trim().split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return !!lines.length && lines.every((line) => /^(?:Added|Set|Updated|Moved|Removed|Attached)\s+.+\.$/.test(line));
}

function AppliedConfirmation({ text }) {
  return html`<div class="trip-chat-applied-confirmation flex items-center gap-2.5">
    <span class="trip-chat-applied-check shrink-0 inline-flex items-center justify-center" aria-hidden="true">
      <${IconCheck} className="w-3.5 h-3.5" />
    </span>
    <div class="min-w-0"><${ChatMarkdown} text=${text} /></div>
  </div>`;
}

// Print the briefing as an 80mm thermal receipt. The paper is CLONED into a
// dedicated print root — the chat sheet's transforms/overflow would otherwise
// clip or mis-position it — and @media print rules isolate that root.
function printBriefing() {
  // The print button lives OUTSIDE the receipt (so it's never printed), and
  // there's only ever one briefing card, so query it directly.
  const paper = document.querySelector('.trip-chat-receipt');
  if (!paper) return;
  document.getElementById('receipt-print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'receipt-print-root';
  const clone = paper.cloneNode(true);
  root.appendChild(clone);
  document.body.appendChild(root);

  // Measure the clone at its real print width (briefly, off-screen) so the
  // @page height can be set to the actual content height. A "size: 80mm auto"
  // height isn't reliably honored by browsers/PDF export — many fall back to a
  // default Letter/A4 page with the narrow receipt stranded in a corner. An
  // explicit computed mm height fixes that everywhere print-to-PDF is used.
  root.style.cssText = 'position:fixed; left:-9999px; top:0; display:block;';
  clone.style.cssText = 'width:72mm; margin:0; padding:0 1mm; border:none; box-shadow:none; font-size:12px;';
  clone.querySelectorAll('.receipt-screen-only, .receipt-map, .receipt-tear').forEach((el) => { el.style.display = 'none'; });
  const heightPx = clone.getBoundingClientRect().height;
  const heightMM = Math.max(80, Math.ceil((heightPx / 96) * 25.4) + 12);
  root.removeAttribute('style');
  clone.removeAttribute('style');

  // 80mm roll @page, sized to the measured content — injected only for this
  // print so normal app printing (Cmd+P elsewhere) keeps the default page size.
  const pageStyle = document.createElement('style');
  pageStyle.id = 'receipt-page-style';
  pageStyle.textContent = `@page { size: 80mm ${heightMM}mm; margin: 3mm; }`;
  document.head.appendChild(pageStyle);
  document.documentElement.classList.add('receipt-printing');
  const cleanup = () => {
    document.documentElement.classList.remove('receipt-printing');
    root.remove();
    pageStyle.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  requestAnimationFrame(() => window.print());
}

// Same slot order the on-screen day map uses, so the printed map matches it.
const MAP_SLOT_ORDER = ['breakfast', 'morning', 'lunch', 'afternoon', 'dinner', 'evening'];

// Resolve the day's plotted stops to numbered map points (+ the hotel as home)
// for the thermal print. Coordinates come from the same cache the day map fills,
// so once the on-screen map has drawn these return instantly.
async function briefMapPoints(stop, day) {
  const city = {
    id: stop.cityId || stop.id, name: stop.name, country: stop.country, lat: stop.lat, lng: stop.lng,
  };
  const raw = [];
  MAP_SLOT_ORDER.forEach((k) => {
    const v = day.slots?.[k];
    if (Array.isArray(v)) raw.push(...v);
    else if (v) raw.push(v);
  });
  const points = [];
  let n = 0;
  for (const it of raw) {
    const c = await resolveItemCoords(it, city).catch(() => null);
    if (c && Number.isFinite(c.lat) && !c.approx) {
      n += 1;
      points.push({ lat: c.lat, lng: c.lng, n, label: it.name });
    }
  }
  const lodging = day.slots && day.slots.lodging;
  if (lodging) {
    const lc = await resolveItemCoords(lodging, city).catch(() => null);
    if (lc && Number.isFinite(lc.lat) && !lc.approx) {
      points.push({ lat: lc.lat, lng: lc.lng, home: true, label: lodging.name });
    }
  }
  return points;
}

function uploadPreviewForFile(file) {
  const isImage = (file?.type || '').startsWith('image/');
  if (!isImage || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  return {
    type: 'image',
    url: URL.createObjectURL(file),
    name: file.name || 'Uploaded image',
  };
}

function UploadUserMessage({ message }) {
  const previews = Array.isArray(message.attachments) ? message.attachments.filter((a) => a?.type === 'image' && a.url) : [];
  if (!previews.length) {
    return html`<p class="trip-chat-text whitespace-pre-wrap m-0">${message.content}</p>`;
  }
  return html`<div class="trip-chat-upload-msg">
    <div class="trip-chat-upload-thumbs" aria-label=${message.content || 'Uploaded image'}>
      ${previews.slice(0, 3).map((preview, i) => html`
        <span key=${preview.url || i} class="trip-chat-upload-thumb" title=${preview.name || 'Uploaded image'}>
          <img src=${preview.url} alt=${preview.name || 'Uploaded image'} />
        </span>`)}
      ${previews.length > 3 && html`<span class="trip-chat-upload-more">+${previews.length - 3}</span>`}
    </div>
    <div class="trip-chat-upload-caption">${previews.length === 1 ? 'Reservation screenshot' : `${previews.length} reservation screenshots`}</div>
  </div>`;
}

async function streamChat(body, handlers) {
  const res = await fetch('/api/trip-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (err.error === 'not_configured') throw new Error('not_configured');
    throw new Error(err.detail || err.error || `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = { responseId: null, actions: [], clarification: '' };
  const onDelta = typeof handlers === 'function' ? handlers : handlers?.onDelta;
  const onReasoning = typeof handlers === 'function' ? null : handlers?.onReasoning;
  const onToolStatus = typeof handlers === 'function' ? null : handlers?.onToolStatus;
  const onSearch = typeof handlers === 'function' ? null : handlers?.onSearch;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const evt = JSON.parse(raw);
        if (evt.type === 'delta' && evt.text) onDelta?.(evt.text);
        else if (evt.type === 'text_final' && evt.text) onDelta?.(evt.text, { replace: true });
        else if (evt.type === 'reasoning_reset') onReasoning?.('', { reset: true });
        else if (evt.type === 'reasoning_delta' && evt.text) onReasoning?.(evt.text);
        else if (evt.type === 'reasoning_final' && evt.text) onReasoning?.(evt.text, { replace: true });
        else if (evt.type === 'tool_status') onToolStatus?.(evt.text || evt.status || 'Using a tool');
        else if (evt.type === 'search') onSearch?.(evt);
        else if (evt.type === 'done') {
          // Claude Messages is stateless — the server returns no responseId, so
          // capture the structured edits/clarification unconditionally.
          if (evt.responseId) result.responseId = evt.responseId;
          if (Array.isArray(evt.actions)) result.actions = evt.actions;
          if (evt.clarification) result.clarification = evt.clarification;
        }
        else if (evt.type === 'error') throw new Error(evt.message || 'stream_error');
      } catch (e) {
        if (e.message && e.message !== 'stream_error') throw e;
      }
    }
  }
  return result;
}

// Fly a clicked suggestion pill up to exactly where its user bubble lands,
// morphing the pill's rounded shape into the bubble's, then cross-fading the two
// (ghost out, real bubble in). Runs entirely on cloned DOM appended to <body>,
// so React never sees it and the panel's overflow can't clip the flight.
function animateSuggestionFly(from, clone, bubbleEl) {
  if (!from || !clone || !bubbleEl) return;
  const to = bubbleEl.getBoundingClientRect();
  if (!to.width || !to.height) return;

  // Read the destination bubble's exact look so the pill morphs *into* it —
  // green rounded pill → the black, square, cream-text chat bubble.
  const bs = getComputedStyle(bubbleEl);
  const bubbleBg = bs.backgroundColor;
  const bubbleColor = bs.color;
  const bubbleRadius = bs.borderTopLeftRadius || '3px';

  bubbleEl.style.transition = 'none';
  bubbleEl.style.opacity = '0'; // hide the real bubble until the ghost lands

  const ghost = clone;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.removeAttribute('disabled');
  ghost.removeAttribute('tabindex');
  ghost.style.cssText += `;position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;min-height:0;margin:0;z-index:70;pointer-events:none;box-shadow:none;transform:none;overflow:hidden;will-change:left,top,width,height,border-radius;`;
  document.body.appendChild(ghost);

  // Pin the pill's own colours/shape as explicit inline start values, so the
  // morph is a clean inline→inline transition rather than class→inline.
  const gs = getComputedStyle(ghost);
  ghost.style.backgroundColor = gs.backgroundColor;
  ghost.style.color = gs.color;
  ghost.style.borderColor = gs.borderColor;
  // Start the radius at the pill's *effective* capsule radius (half its height),
  // NOT the literal 9999px. Interpolating 9999px→3px keeps the corners fully
  // round until the final ~1% and then snaps square; from height/2 they round
  // down smoothly the whole way.
  ghost.style.borderRadius = `${Math.round(from.height / 2)}px`;
  // Fade the pill's text out fast so the shape morphs without the text visibly
  // reflowing inside it — the real bubble's text settles in at the very end.
  const txt = ghost.querySelector('.trip-chat-chip-text');
  if (txt) txt.style.transition = 'opacity 150ms ease';
  ghost.getBoundingClientRect(); // commit the start frame

  // Quick, single-timeline morph: position, size, corner-radius, and colour all
  // animate together (green pill → black square bubble) at the same pace, so it
  // transforms WHILE it flies — no move-then-pause-then-grow. The opacity fade is
  // baked into the same transition with a delay (not a second transition, which
  // would restart the morph), so the hand-off to the real bubble overlaps the
  // tail of the flight with no dead beat.
  const EASE = 'cubic-bezier(0.33, 0.7, 0.2, 1)'; // brisk, only a soft settle
  const DUR = 420;
  const FADE_AT = DUR - 90;
  ghost.style.transition = [
    `left ${DUR}ms ${EASE}`, `top ${DUR}ms ${EASE}`, `width ${DUR}ms ${EASE}`, `height ${DUR}ms ${EASE}`,
    `border-radius ${DUR}ms ${EASE}`, `background-color ${DUR}ms ${EASE}`,
    `border-color ${DUR}ms ${EASE}`, `color ${DUR}ms ${EASE}`,
    `opacity 150ms ease ${FADE_AT}ms`,
  ].join(',');
  ghost.style.left = `${to.left}px`;
  ghost.style.top = `${to.top}px`;
  ghost.style.width = `${to.width}px`;
  ghost.style.height = `${to.height}px`;
  ghost.style.borderRadius = bubbleRadius;
  ghost.style.backgroundColor = bubbleBg;
  ghost.style.color = bubbleColor;
  ghost.style.borderColor = 'transparent';
  ghost.style.opacity = '0'; // fades over the last ~150ms via the delayed transition above
  if (txt) txt.style.opacity = '0';

  // Reveal the real bubble underneath just as the ghost begins to fade — the
  // ghost has nearly finished morphing to the bubble's shape/colour, so this
  // reads as one continuous settle, not a cross-fade or a snap.
  setTimeout(() => { bubbleEl.style.opacity = '1'; }, FADE_AT);
  setTimeout(() => {
    ghost.remove();
    bubbleEl.style.transition = '';
    bubbleEl.style.opacity = '';
  }, DUR + 120);
}

// One horizontally-scrolling row of suggestion pills. Auto-scrolls via scrollLeft
// (so the user can also swipe/drag/wheel through it), pauses while the pointer is
// over it, and loops seamlessly because the items are rendered twice. direction:
// +1 drifts the content left, -1 drifts it right.
function MarqueeRow({ items, direction, loading, onPick, onChipPointerDown }) {
  const ref = useRef(null);
  // How many times the item set is repeated in the track. The loop wraps at one
  // copy's width; that only scrolls without the browser clamping scrollLeft if
  // there's at least a container's width of copies *past* the first. With few
  // short chips (esp. the second row / concierge suggestions) two copies aren't
  // enough — the row freezes at the end of its range, then jumps. Grow as needed.
  const [copies, setCopies] = useState(2);
  useEffect(() => {
    const el = ref.current;
    if (!el || !items.length) return undefined;

    const oneCopy = el.scrollWidth / copies; // width of a single item set
    if (oneCopy > 0) {
      const need = Math.max(2, Math.ceil(el.clientWidth / oneCopy) + 1);
      if (need !== copies) { setCopies(need); return undefined; } // re-runs with more copies
    }

    const reduce = (() => {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
      catch { return false; }
    })();
    const unit = () => el.scrollWidth / copies; // one copy = the seamless loop unit
    // Track the position in a JS accumulator rather than reading el.scrollLeft
    // back each frame: the browser can round scrollLeft to an integer, and a
    // sub-pixel per-frame delta then rounds away and the row never moves.
    let pos = direction < 0 ? unit() : 0;
    if (pos > 0) el.scrollLeft = pos;

    let paused = reduce;
    const onEnter = () => { paused = true; };
    // Resume from wherever the user left it after a manual scroll.
    const onLeave = () => { if (!reduce) { pos = el.scrollLeft; paused = false; } };
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);

    const SPEED = 30; // px/sec
    let raf = 0;
    let last = 0;
    const step = (t) => {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
      last = t;
      if (!paused) {
        const u = unit();
        if (u > 0) {
          pos += direction * SPEED * dt;
          if (pos >= u) pos -= u;
          else if (pos < 0) pos += u;
          el.scrollLeft = pos;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [items, direction, copies]);

  return html`
    <div ref=${ref} class="trip-chat-marquee-row">
      <div class="trip-chat-marquee-track">
        ${Array.from({ length: copies }, () => items).flat().map((q, i) => html`<button key=${i} type="button"
          disabled=${loading}
          onClick=${(e) => onPick(q, e)}
          onPointerDown=${onChipPointerDown}
          aria-hidden=${i >= items.length ? 'true' : undefined}
          tabindex=${i >= items.length ? -1 : undefined}
          class="trip-chat-chip"><span class="trip-chat-chip-text">${q}</span></button>`)}
      </div>
    </div>`;
}

export function TripChatPanel({ open, onClose, onEnsureTimeline, onEnsureOpen }) {
  const { trip, who, dispatch, expandStop } = useStore();
  const klausName = isKlausMode(trip) ? 'Klaus' : 'Claus';
  const [shown, setShown] = useState(open);
  const [active, setActive] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activityStatus, setActivityStatus] = useState('');
  const loading = streaming || busy;
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const previousResponseIdRef = useRef(null);
  const lastContextHashRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const streamDraftRef = useRef('');
  const streamRafRef = useRef(0);
  const answerStartedRef = useRef(false);
  const reasoningDraftRef = useRef('');
  const asideRef = useRef(null);
  const rootRef = useRef(null);
  const flyPendingRef = useRef(null);
  const widthRef = useRef(loadPanelWidth());
  const heightRef = useRef(loadPanelHeight());
  const posRef = useRef(loadPanelPos());
  const [panelWidth, setPanelWidth] = useState(widthRef.current);
  const [panelHeight, setPanelHeight] = useState(heightRef.current);
  const [panelPos, setPanelPos] = useState(posRef.current);
  const [resizing, setResizing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [wideEnough, setWideEnough] = useState(panelCanResize);
  const [mobileFrame, setMobileFrame] = useState(null);
  const [webSearch, setWebSearch] = useState(true);
  const [draggingTickets, setDraggingTickets] = useState(false);
  const [reasoningSummary, setReasoningSummary] = useState('');
  const [liveSearches, setLiveSearches] = useState([]);
  const searchesRef = useRef([]);
  const [answerStarted, setAnswerStarted] = useState(false);
  // On-demand concierge re-run: { status, reasoning, searches } while the managed
  // agent regenerates the brief, so its steps stream into the activity UI.
  const [conciergeRun, setConciergeRun] = useState(null);
  const conciergeRunRef = useRef({ cancelled: false, timer: 0 });
  // Last typewriter tick (ms) — drives wall-clock pacing of the brief reveal.
  const conciergeTypeTickRef = useRef(0);
  // Epson print bridge: whether it's reachable + a printer is configured, and a
  // transient status for the manual "Print" button. Auto-print runs once per day.
  const [printerReady, setPrinterReady] = useState(false);
  const [printStatus, setPrintStatus] = useState('idle'); // idle|printing|done|error|browser
  const autoPrintedRef = useRef(''); // brief date we've already auto-printed
  const [thinkingIdx, setThinkingIdx] = useState(0);
  // While the model warms up (streaming, no summary yet, answer not started) cycle
  // a "thinking…" placeholder — in the languages of the trip's countries (DK, SE,
  // NO, FI, EE) — shown as the activity section's thinking header until the real
  // summary arrives.
  const showThinking = streaming && !answerStarted && !reasoningSummary;
  const thinkingPlaceholder = `${THINKING_WORDS[thinkingIdx]}…`;
  const lastWebSearchStopRef = useRef(null);
  const peakViewportHeightRef = useRef(0);
  const bodyLockScrollY = useRef(0);
  const ticketInputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const chatSessionReadyRef = useRef(false);
  const conciergeDoneRef = useRef(false);
  // Read by scrollMessagesToBottom to suppress auto-scroll while the briefing leads.
  const briefingLeadsRef = useRef(false);
  const uploadPreviewUrlsRef = useRef([]);

  function rememberUploadPreview(url) {
    if (url) uploadPreviewUrlsRef.current.push(url);
  }

  function clearUploadPreviews() {
    uploadPreviewUrlsRef.current.forEach((url) => {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    });
    uploadPreviewUrlsRef.current = [];
  }

  useEffect(() => clearUploadPreviews, []);
  useEffect(() => stopConciergePoll, []);

  // Watch the local Epson print bridge on a steady 30s heartbeat so the button
  // and auto-print reflect its live state — it picks up a bridge started after
  // the app, and self-heals `printerReady` after a transient print error.
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      const info = await probeBridge();
      if (!alive) return;
      const ready = !!(info && info.configured);
      setPrinterReady(ready);
      // Tighter heartbeat once live (catch it going down); slower when absent
      // (less pointless traffic when no bridge is running).
      timer = setTimeout(tick, ready ? 30000 : 60000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  // Render the current brief to a 1-bit thermal receipt (text + real map + local
  // phrases) and send the ESC/POS bytes to the bridge. Falls back to the browser
  // print dialog if the bridge isn't reachable.
  async function printToEpson({ auto = false } = {}) {
    const briefMsg = messages.find((m) => m.concierge);
    if (!briefMsg || briefMsg.conciergeTyping) return;
    if (!auto) setPrintStatus('printing');
    try {
      const found = briefMsg.conciergeDate ? findDayOnTrip(trip, briefMsg.conciergeDate) : null;
      const points = found ? await briefMapPoints(found.stop, found.day) : [];
      const dayIndex = trip.startDate && briefMsg.conciergeDate
        ? daysBetween(trip.startDate, briefMsg.conciergeDate) + 1 : 0;
      const dayTotal = trip.startDate && trip.endDate
        ? daysBetween(trip.startDate, trip.endDate) + 1 : 0;
      const canvas = await renderReceiptCanvas({
        brief: briefMsg.conciergeFull || briefMsg.content || '',
        country: found ? found.stop.country : '',
        mapPoints: points,
        dayIndex,
        dayTotal,
        nowLabel: new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
      });
      const bytes = canvasToEscpos(canvas, { copies: 1 });
      await sendToPrinter(bytes);
      markPrinted(briefMsg.conciergeDate || '');
      setPrinterReady(true); // a successful send confirms the bridge, even if a probe was missed
      setPrintStatus('done'); setTimeout(() => setPrintStatus('idle'), 3500);
    } catch (e) {
      // Bridge unreachable or a printer error → browser dialog, so the manual
      // button never dead-ends.
      setPrinterReady(false);
      if (!auto) {
        printBriefing();
        setPrintStatus('browser');
        setTimeout(() => setPrintStatus('idle'), 3500);
      }
    }
  }

  // Auto-print a brand-new brief exactly once, when the bridge is up and it isn't
  // still typing itself in. Deduped by the brief's date (across reloads and a new
  // day rolling over while the app stays open).
  const briefForPrint = messages.find((m) => m.concierge);
  const briefPrintKey = briefForPrint && !briefForPrint.conciergeTyping ? (briefForPrint.conciergeDate || '') : '';
  useEffect(() => {
    if (!printerReady || !briefPrintKey || autoPrintedRef.current === briefPrintKey) return;
    if (alreadyPrinted(briefPrintKey)) { autoPrintedRef.current = briefPrintKey; return; }
    autoPrintedRef.current = briefPrintKey;
    printToEpson({ auto: true });
  }, [printerReady, briefPrintKey]);

  useEffect(() => {
    chatSessionReadyRef.current = false;
    const session = loadTripChatSession(who, TRIP_ID);
    setMessages(session.messages);
    previousResponseIdRef.current = session.previousResponseId;
    lastContextHashRef.current = session.lastContextHash;
    chatSessionReadyRef.current = true;
  }, [who]);

  useEffect(() => {
    if (!chatSessionReadyRef.current || streaming) return undefined;
    const t = setTimeout(() => {
      saveTripChatSession(who, TRIP_ID, {
        messages,
        previousResponseId: previousResponseIdRef.current,
        lastContextHash: lastContextHashRef.current,
      });
    }, 200);
    return () => clearTimeout(t);
  }, [messages, who, streaming]);

  // While Today's briefing is the current view (it's the last message, nothing
  // sent after it), keep the scroll pinned to the TOP so the "Today's briefing"
  // heading stays visible — don't let the typewriter (or any effect) yank the
  // view to the bottom mid-reveal. Normal auto-scroll resumes once the traveler
  // sends something.
  const briefingLeads = messages.length > 0 && !!messages[messages.length - 1]?.concierge;
  briefingLeadsRef.current = briefingLeads;

  function scrollMessagesToBottom() {
    if (briefingLeadsRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  // Overnight Concierge → main chat screen. The briefing receipt is the chat's
  // default HOME SCREEN and always shows: we surface the latest concierge brief
  // if the API has one, and otherwise fall back to a locally-built brief drawn
  // from the trip data — so there's always a receipt at the top, even before the
  // managed agent is provisioned. It types itself in; only a genuinely new
  // nightly run also auto-opens the panel. Waits for the trip to load (the local
  // fallback needs it); the ref keeps it to a single run.
  const tripReady = !!(trip && trip.stops && trip.stops.length);
  useEffect(() => {
    if (conciergeDoneRef.current || !tripReady) return undefined;
    conciergeDoneRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        let latest = null;
        // Cap the wait so a slow/hung API still yields to the local fallback fast.
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch('/api/concierge', { headers: { accept: 'application/json' }, signal: ctrl.signal }).catch(() => null);
        clearTimeout(to);
        if (res && res.ok) {
          const data = await res.json().catch(() => null);
          latest = data && data.latest;
        }
        // Fall back to a locally-built brief so the receipt is ALWAYS the home
        // screen — even when the API has nothing yet.
        if (!latest || !latest.brief) latest = await buildLocalBrief(trip).catch(() => null);
        if (!latest || !latest.brief) return;
        // Only a genuinely new nightly run (never a local fallback) auto-OPENS
        // the panel; a reload of the same brief re-prints in place, untouched.
        const isNewBrief = !latest.local && Number(latest.at) > loadConciergeSeen(TRIP_ID);
        if (cancelled) return;
        const conciergeMsg = {
          role: 'assistant',
          content: '',
          concierge: true,
          conciergeAt: Number(latest.at) || 0,
          conciergeDate: String(latest.date || ''),
          conciergeFull: String(latest.brief || ''),
          conciergeTyping: true,
          conciergeSuggestions: Array.isArray(latest.suggestions) ? latest.suggestions : [],
        };
        setTimeout(() => {
          if (cancelled) return;
          // Auto-open only for a new brief; otherwise leave the panel as-is (the
          // receipt still becomes the home screen the moment it's opened).
          if (isNewBrief) {
            saveConciergeSeen(Number(latest.at), TRIP_ID);
            onEnsureOpen?.();
          }
          // Only ever ONE briefing in the chat, and it's the latest: drop any
          // earlier concierge card before surfacing this one.
          setMessages((prev) => [conciergeMsg, ...prev.filter((m) => !m.concierge)]);
        }, 250);
      } catch { /* best-effort — the concierge brief is optional */ }
    })();
    return () => { cancelled = true; };
  }, [tripReady]);

  // Typewriter for the concierge brief: reveal the stored full text a few chars
  // at a time so it reads like a streamed reply, then clear the typing flag —
  // which reveals the suggestion pills beneath it. Re-finds the message by flag
  // each tick so a mid-reveal user action can't corrupt it by stale index.
  useEffect(() => {
    const typingMsg = messages.find((m) => m.concierge && m.conciergeTyping);
    if (!typingMsg) { conciergeTypeTickRef.current = 0; return undefined; }
    const full = typingMsg.conciergeFull || '';
    if ((typingMsg.content || '').length >= full.length) {
      conciergeTypeTickRef.current = 0;
      setMessages((prev) => prev.map((m) => (
        m.concierge && m.conciergeTyping ? { ...m, conciergeTyping: false, content: m.conciergeFull || '' } : m
      )));
      return undefined;
    }
    const t = setTimeout(() => {
      // Wall-clock pacing: reveal the whole brief in ~1.6s of real time no
      // matter how the browser spaces the ticks (background tabs clamp timers
      // to ≥1s — a fixed per-tick step made the reveal crawl for minutes).
      const now = Date.now();
      const dt = conciergeTypeTickRef.current ? Math.min(1200, now - conciergeTypeTickRef.current) : 22;
      conciergeTypeTickRef.current = now;
      setMessages((prev) => prev.map((m) => {
        if (!(m.concierge && m.conciergeTyping)) return m;
        const f = m.conciergeFull || '';
        const cur = m.content || '';
        if (cur.length >= f.length) return m;
        const stepChars = Math.max(2, Math.round((f.length * dt) / 1600));
        return { ...m, content: f.slice(0, Math.min(f.length, cur.length + stepChars)) };
      }));
      scrollMessagesToBottom();
    }, 22);
    return () => clearTimeout(t);
  }, [messages]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const update = () => setWideEnough(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

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

  // Mobile: lock page scroll and pin the sheet to the visual viewport so the
  // header + close button stay reachable when the keyboard opens/closes.
  useEffect(() => {
    if (!open || wideEnough) {
      setMobileFrame(null);
      return undefined;
    }

    bodyLockScrollY.current = window.scrollY;
    peakViewportHeightRef.current = 0;
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      width: document.body.style.width,
      top: document.body.style.top,
    };
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${bodyLockScrollY.current}px`;

    const vv = window.visualViewport;
    const sync = () => {
      if (!vv) return;
      peakViewportHeightRef.current = Math.max(peakViewportHeightRef.current, vv.height);
      const keyboardOpen = peakViewportHeightRef.current - vv.height > 60;
      setMobileFrame({
        top: vv.offsetTop,
        left: vv.offsetLeft,
        width: vv.width,
        height: vv.height,
        keyboardOpen,
      });
      requestAnimationFrame(scrollMessagesToBottom);
    };

    sync();
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);

    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      setMobileFrame(null);
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.width = prev.width;
      document.body.style.top = prev.top;
      window.scrollTo(0, bodyLockScrollY.current);
    };
  }, [open, wideEnough]);

  useEffect(() => {
    if (open && inputRef.current) {
      const t = setTimeout(() => {
        inputRef.current?.focus();
        resizeInput(inputRef.current);
      }, 320);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    resizeInput(inputRef.current);
  }, [input]);

  useLayoutEffect(() => {
    scrollMessagesToBottom();
  }, [messages, streaming]);

  // After a suggestion is clicked and its user bubble mounts, fly the pill into
  // it. Runs after the scroll effect above so the bubble is at its final spot.
  useLayoutEffect(() => {
    const pending = flyPendingRef.current;
    if (!pending) return;
    const scrollEl = scrollRef.current;
    const bubbles = scrollEl ? scrollEl.querySelectorAll('.trip-chat-bubble-user') : null;
    const bubbleEl = bubbles && bubbles[bubbles.length - 1];
    if (!bubbleEl) return; // bubble not in the DOM yet; retry on the next change
    flyPendingRef.current = null;
    animateSuggestionFly(pending.from, pending.clone, bubbleEl);
  }, [messages]);

  useLayoutEffect(() => {
    if (!open || !shown) return undefined;
    scrollMessagesToBottom();
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      scrollMessagesToBottom();
      raf2 = requestAnimationFrame(scrollMessagesToBottom);
    });
    const t = setTimeout(scrollMessagesToBottom, 360);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t);
    };
  }, [open, shown]);

  useLayoutEffect(() => {
    if (activityStatus) scrollMessagesToBottom();
  }, [activityStatus]);

  useLayoutEffect(() => {
    if (reasoningSummary || liveSearches.length) scrollMessagesToBottom();
  }, [reasoningSummary, liveSearches]);

  // Rotate the warm-up placeholder through the trip's languages (random start so
  // it varies per turn); the typewriter retypes each word as the target changes.
  useEffect(() => {
    if (!showThinking) return undefined;
    setThinkingIdx(Math.floor(Math.random() * THINKING_WORDS.length));
    const id = setInterval(() => {
      setThinkingIdx((i) => (i + 1) % THINKING_WORDS.length);
    }, THINKING_ROTATE_MS);
    return () => clearInterval(id);
  }, [showThinking]);

  useLayoutEffect(() => {
    if (mobileFrame) scrollMessagesToBottom();
  }, [mobileFrame]);

  const suggestions = useMemo(() => buildChatSuggestions(trip), [trip]);
  // Split the starter prompts across two marquee rows (even/odd) that scroll in
  // opposite directions.
  const [suggestRowA, suggestRowB] = useMemo(() => {
    const a = [];
    const b = [];
    suggestions.forEach((q, i) => (i % 2 ? b : a).push(q));
    return [a, b];
  }, [suggestions]);

  if (!shown || !trip.stops.length) return null;

  function flushStreamDraft() {
    streamRafRef.current = 0;
    const content = streamDraftRef.current;
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, content };
      return next;
    });
  }

  function appendStreamDelta(delta, opts) {
    if (!answerStartedRef.current) {
      answerStartedRef.current = true;
      // Answer tokens are arriving — settle the reasoning typewriter so it can't
      // appear to still be typing "behind" the response.
      setAnswerStarted(true);
    }
    streamDraftRef.current = opts?.replace ? delta : streamDraftRef.current + delta;
    if (opts?.replace) {
      if (streamRafRef.current) {
        cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = 0;
      }
      flushStreamDraft();
      return;
    }
    if (!streamRafRef.current) {
      streamRafRef.current = requestAnimationFrame(flushStreamDraft);
    }
  }

  function appendReasoningDelta(delta, opts) {
    if (opts?.reset) {
      reasoningDraftRef.current = '';
      setReasoningSummary('');
      return;
    }
    // Accumulate every thinking delta for the whole turn (multiple thinking
    // blocks arrive separated by blank lines and must all be kept); a `replace`
    // final just syncs to the server's full accumulated text. Cleared per turn in
    // send(), so there's no cross-turn bleed.
    reasoningDraftRef.current = opts?.replace ? delta : reasoningDraftRef.current + delta;
    setReasoningSummary(reasoningDraftRef.current);
  }

  // Fold a streamed `search` event (start → query → results/error) into the live
  // search list, keyed by the server tool-use id so concurrent/sequential
  // searches each get their own block.
  function handleSearchEvent(evt) {
    if (!evt || !evt.id) return;
    const list = searchesRef.current.slice();
    let entry = list.find((s) => s.id === evt.id);
    if (!entry) { entry = { id: evt.id, query: '', results: [], status: 'searching' }; list.push(entry); }
    if (evt.phase === 'query') entry.query = String(evt.query || '');
    else if (evt.phase === 'results') { entry.results = Array.isArray(evt.results) ? evt.results : []; entry.status = 'done'; }
    else if (evt.phase === 'error') { entry.status = 'error'; }
    searchesRef.current = list;
    setLiveSearches(list.map((s) => ({ ...s })));
  }

  function celebrateAppliedEdit() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const root = scrollRef.current;
        const successes = root ? Array.from(root.querySelectorAll('.trip-chat-applied-confirmation')) : [];
        const successMessage = successes.at(-1);
        celebrate(successMessage || root || asideRef.current, { count: 75, power: 0.9, spreadDeg: 135 });
      });
    });
  }

  // The card is anchored bottom-right, so dragging the left edge left grows
  // width and dragging the top edge up grows height. axis: 'x' | 'y' | 'both'.
  function onResizePointerDown(e, axis = 'x') {
    if (!wideEnough) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = asideRef.current?.getBoundingClientRect();
    const startW = rect?.width ?? panelWidth;
    const startH = rect?.height ?? panelHeight;
    const maxH = maxPanelHeight();
    setResizing(true);

    const onMove = (ev) => {
      if (axis === 'x' || axis === 'both') {
        const next = Math.round(Math.min(
          MAX_PANEL_PX,
          Math.max(MIN_PANEL_PX, startW + (startX - ev.clientX)),
        ));
        widthRef.current = next;
        setPanelWidth(next);
      }
      if (axis === 'y' || axis === 'both') {
        const next = Math.round(Math.min(
          maxH,
          Math.max(MIN_PANEL_H, startH + (startY - ev.clientY)),
        ));
        heightRef.current = next;
        setPanelHeight(next);
      }
    };
    const onUp = () => {
      setResizing(false);
      try {
        localStorage.setItem(WIDTH_KEY, String(widthRef.current));
        localStorage.setItem(HEIGHT_KEY, String(heightRef.current));
      } catch { /* ignore */ }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Drag the whole card around by grabbing its header (desktop only). Position is
  // tracked as right/bottom offsets and clamped so it can't leave the viewport.
  function onHeaderPointerDown(e) {
    if (!wideEnough) return;
    if (e.target.closest('button')) return; // let header buttons work
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = asideRef.current?.getBoundingClientRect();
    const w = rect?.width ?? panelWidth;
    const h = rect?.height ?? panelHeight;
    const startRight = posRef.current.right;
    const startBottom = posRef.current.bottom;
    setDragging(true);

    const onMove = (ev) => {
      const maxRight = Math.max(8, window.innerWidth - w - 8);
      const maxBottom = Math.max(8, window.innerHeight - h - 8);
      const right = Math.min(maxRight, Math.max(8, startRight - (ev.clientX - startX)));
      const bottom = Math.min(maxBottom, Math.max(8, startBottom - (ev.clientY - startY)));
      posRef.current = { right, bottom };
      setPanelPos({ right, bottom });
    };
    const onUp = () => {
      setDragging(false);
      try { localStorage.setItem(POS_KEY, JSON.stringify(posRef.current)); } catch { /* ignore */ }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function webSearchOpts(forText) {
    const recentMessages = messages.filter((m) => m.role === 'user').map((m) => m.content);
    if (forText?.trim()) recentMessages.push(forText.trim());
    return {
      recentMessages,
      priorStop: lastWebSearchStopRef.current,
    };
  }

  function rememberWebSearchStop(location) {
    if (!location?.stopId) return;
    lastWebSearchStopRef.current = trip.stops.find((s) => s.id === location.stopId) || null;
  }

  function replaceLastAssistant(content) {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, content };
      return next;
    });
  }

  // ── "Run briefing agent again" — trigger the managed agent on demand and
  // stream its steps into the activity UI, then swap in the fresh brief. ─────
  function stopConciergePoll() {
    conciergeRunRef.current.cancelled = true;
    if (conciergeRunRef.current.timer) { clearTimeout(conciergeRunRef.current.timer); conciergeRunRef.current.timer = 0; }
  }

  function replaceConciergeBrief(latest) {
    if (!latest || !latest.brief) return;
    // A manual re-run's result counts as seen, so it won't re-pop the panel open
    // on the next load.
    saveConciergeSeen(Number(latest.at) || Date.now(), TRIP_ID);
    setMessages((prev) => prev.map((m) => (m.concierge ? {
      ...m,
      conciergeAt: Number(latest.at) || m.conciergeAt || 0,
      conciergeDate: String(latest.date || m.conciergeDate || ''),
      content: '',
      conciergeFull: String(latest.brief || ''),
      conciergeTyping: true,
      conciergeSuggestions: Array.isArray(latest.suggestions) ? latest.suggestions : [],
    } : m)));
  }

  function pollConciergeRun(runId, sessionId, attempt) {
    if (conciergeRunRef.current.cancelled) return;
    if (attempt > 60) { // ~2.5 min ceiling
      setConciergeRun((p) => ({ ...(p || {}), status: 'error', error: 'The briefing agent is taking a while — try again shortly.' }));
      return;
    }
    const q = `poll=${encodeURIComponent(runId)}${sessionId ? `&session=${encodeURIComponent(sessionId)}` : ''}`;
    fetch(`/api/concierge?${q}`, { headers: { accept: 'application/json' } })
      .then((r) => r.json())
      .then((data) => {
        if (conciergeRunRef.current.cancelled) return;
        const nextSession = sessionId || data.sessionId || '';
        if (data.status === 'done') {
          setConciergeRun({ status: 'done', reasoning: data.reasoning || '', searches: data.searches || [] });
          if (data.latest) replaceConciergeBrief(data.latest);
          return;
        }
        setConciergeRun({ status: data.status === 'starting' ? 'starting' : 'running', reasoning: data.reasoning || '', searches: data.searches || [] });
        conciergeRunRef.current.timer = setTimeout(() => pollConciergeRun(runId, nextSession, attempt + 1), 2600);
      })
      .catch(() => {
        if (conciergeRunRef.current.cancelled) return;
        conciergeRunRef.current.timer = setTimeout(() => pollConciergeRun(runId, sessionId, attempt + 1), 3200);
      });
  }

  async function runBriefingAgain() {
    if (conciergeRun && conciergeRun.status !== 'done' && conciergeRun.status !== 'error') return;
    stopConciergePoll();
    conciergeRunRef.current = { cancelled: false, timer: 0 };
    setConciergeRun({ status: 'starting', reasoning: '', searches: [] });
    let started = {};
    try {
      const r = await fetch('/api/concierge?run=1', { method: 'POST', headers: { accept: 'application/json' } });
      started = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = started?.message === 'cooldown' ? 'Just ran — give it a moment before re-running.'
          : started?.message === 'not_provisioned' ? 'The briefing agent isn\'t set up yet.'
          : started?.message || `Couldn\'t start (${r.status}).`;
        throw new Error(msg);
      }
    } catch (e) {
      setConciergeRun({ status: 'error', reasoning: '', searches: [], error: e.message });
      return;
    }
    if (!started.runId) { setConciergeRun({ status: 'error', reasoning: '', searches: [], error: 'Could not start the briefing agent.' }); return; }
    setConciergeRun({ status: 'running', reasoning: '', searches: [] });
    pollConciergeRun(started.runId, started.sessionId || '', 0);
  }

  // Stamp the just-finished turn's thinking + searches onto the last assistant
  // message so the activity section renders from persisted data afterward.
  function commitActivityToLast() {
    const reasoning = reasoningDraftRef.current || '';
    const searches = searchesRef.current || [];
    if (!reasoning && !searches.length) return;
    const snapshot = searches.map((s) => ({ ...s }));
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant') { next[i] = { ...next[i], reasoning, searches: snapshot }; break; }
      }
      return next;
    });
  }

  // Add a fresh assistant bubble (used for the edit-confirmation, so it reads as
  // its own message instead of being merged into the chat reply above).
  function appendAssistant(content) {
    setMessages((prev) => [...prev, { role: 'assistant', content }]);
  }

  function removeEmptyAssistant() {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant' && !last.content) next.pop();
      return next;
    });
  }

  async function send(textOverride) {
    const text = (textOverride ?? input).trim();
    if (!text || streaming) return;

    setError('');
    setInput('');
    requestAnimationFrame(() => resizeInput(inputRef.current));
    setStreaming(true);
    answerStartedRef.current = false;
    setAnswerStarted(false);
    reasoningDraftRef.current = '';
    setReasoningSummary('');
    searchesRef.current = [];
    setLiveSearches([]);

    const userMsg = { role: 'user', content: text };

    const context = buildTripChatContext(trip, who, { message: text });
    const contextHash = tripContextHash(trip);
    const contextUpdated = lastContextHashRef.current != null
      && lastContextHashRef.current !== contextHash;
    const includeEditTool = wantsTripEditTool(text, { webSearch });
    const sendContext = includeEditTool || !previousResponseIdRef.current || contextUpdated;
    const sendEditContext = includeEditTool;
    const promptCacheKey = `scandiplan-${trip.startDate || 'trip'}`.slice(0, 64);
    const queryFocus = buildQueryTimeFocus(trip, text);
    const webSearchLocation = webSearch
      ? resolveWebSearchLocation(trip, text, webSearchOpts())
      : null;
    if (webSearchLocation) rememberWebSearchStop(webSearchLocation);

    const directAction = buildDirectMealAddAction(text, trip);
    if (directAction) {
      streamDraftRef.current = '';
      setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '' }]);
      try {
        const outcome = applyTripChatActions(trip, dispatch, [directAction]);
        const confirmation = composeAgentReply('', outcome, '');
        replaceLastAssistant(confirmation);
        if (outcome.applied.length) celebrateAppliedEdit();
        if (outcome.applied.length && outcome.focus?.stopId) {
          onEnsureTimeline?.();
          expandStop(outcome.focus.stopId);
          scrollToPlanTarget(outcome.focus);
        }
        if (sendContext) lastContextHashRef.current = contextHash;
        setConfigured(true);
      } catch (e) {
        setError(normalizeChatError(e.message, klausName));
        removeEmptyAssistant();
      } finally {
        setStreaming(false);
      }
      return;
    }

    const assistantMsg = { role: 'assistant', content: '' };
    streamDraftRef.current = '';
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      const priorResponseId = previousResponseIdRef.current;
      // Make Claus aware of the overnight managed-agent brief: it's a *leading*
      // assistant message, which the server drops from history, so pass its text
      // explicitly as context.
      const briefMsg = messages.find((m) => m.concierge);
      const conciergeBrief = briefMsg ? String(briefMsg.conciergeFull || briefMsg.content || '').trim() : '';
      const chatResult = await streamChat({
        message: text,
        queryFocus: queryFocus || undefined,
        context: sendContext ? context : undefined,
        contextHash,
        contextUpdated,
        previousResponseId: priorResponseId,
        promptCacheKey,
        webSearch,
        webSearchLocation: webSearchLocation || undefined,
        editContext: sendEditContext ? buildTripChatEditContext(trip) : undefined,
        // Claude is stateless, so send recent history every turn (not just on
        // edit turns) — this is what preserves "it/that/yes" on follow-ups.
        recentMessages: messages.slice(-6),
        conciergeBrief: conciergeBrief || undefined,
        includeEditContext: sendEditContext || undefined,
        includeEditTool: includeEditTool || undefined,
      }, {
        onDelta: appendStreamDelta,
        onReasoning: appendReasoningDelta,
        onSearch: handleSearchEvent,
      });

      if (streamRafRef.current) {
        cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = 0;
      }
      flushStreamDraft();
      // Persist the turn's activity onto its assistant message so it survives past
      // streaming (collapsed, but re-expandable) instead of vanishing.
      commitActivityToLast();
      setReasoningSummary('');

      if (chatResult.responseId) previousResponseIdRef.current = chatResult.responseId;
      if (sendContext) lastContextHashRef.current = contextHash;
      setConfigured(true);

      const actions = chatResult.actions || [];
      const clarification = chatResult.clarification || '';
      if (actions.length || clarification) {
        setActivityStatus(actions.length ? 'Updating your itinerary…' : '');
        try {
          const outcome = actions.length
            ? applyTripChatActions(trip, dispatch, actions)
            : { applied: [], skipped: [], focus: null };
          const effective = (outcome.applied.length || outcome.skipped.length) ? outcome : {
            applied: [],
            skipped: clarification ? [] : [],
          };
          const replyText = (streamDraftRef.current || '').trim();
          const confirmation = composeAgentReply('', effective, clarification);
          if (replyText && (outcome.applied.length || outcome.skipped.length || clarification)) {
            replaceLastAssistant(replyText);
            appendAssistant(confirmation);
          } else if (replyText) {
            replaceLastAssistant(replyText);
          } else {
            replaceLastAssistant(confirmation || replyText);
          }
          if (outcome.applied.length) celebrateAppliedEdit();
          if (outcome.applied.length && outcome.focus?.stopId) {
            onEnsureTimeline?.();
            expandStop(outcome.focus.stopId);
            scrollToPlanTarget(outcome.focus);
          }
        } finally {
          setActivityStatus('');
        }
      }
    } catch (e) {
      if (e.message === 'not_configured') {
        setConfigured(false);
        setError('Chat is off — set ANTHROPIC_API_KEY in Vercel to enable it.');
      } else {
        setError(normalizeChatError(e.message, klausName));
      }
      removeEmptyAssistant();
    } finally {
      setReasoningSummary('');
      setStreaming(false);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        resizeInput(el);
      });
    }
  }

  function ticketFileAllowed(file) {
    const type = file?.type || '';
    return type.includes('pdf') || type.startsWith('image/') || /\.pdf$/i.test(file?.name || '');
  }

  async function handleTicketFiles(fileList) {
    if (busy) return;
    const files = Array.from(fileList || []).filter(ticketFileAllowed);
    if (!files.length) return;

    setError('');
    setActivityStatus('Reading uploads…');
    setBusy(true);
    const attachments = files.map(uploadPreviewForFile).filter(Boolean);
    attachments.forEach((preview) => rememberUploadPreview(preview.url));
    const imageCount = attachments.length;
    const label = imageCount
      ? (imageCount === 1 ? 'Uploaded reservation screenshot' : `Uploaded ${imageCount} reservation screenshots`)
      : (files.length === 1 ? 'Uploaded 1 file' : `Uploaded ${files.length} files`);
    setMessages((prev) => [...prev, { role: 'user', content: label, attachments }]);

    const results = [];
    const ticketMemory = new Map();
    try {
      for (const file of files) {
        if (file.size > TICKET_MAX_FILE_BYTES) {
          results.push(`${file.name}: too large to attach.`);
          continue;
        }
        let ticket = null;
        try {
          ticket = await ticketFromFile(file);
          const match = await matchTicket(ticket, trip);
          if (match.status === 'unconfigured') {
            setConfigured(false);
            results.push(`${file.name}: ticket reading is off.`);
            continue;
          }
          if (match.status === 'toobig') {
            results.push(`${file.name}: too large to auto-read.`);
            continue;
          }
          if (match.status !== 'ok') {
            results.push(`${file.name}: I could not read it.`);
            continue;
          }
          const applied = applyTicketMatch(trip, dispatch, ticket, match, ticketMemory);
          results.push(applied.ok ? `Attached ${applied.summary}.` : `${file.name}: ${applied.summary}`);
        } catch {
          results.push(`${file.name}: I could not read it.`);
        }
      }
      appendAssistant(results.length ? results.join('\n') : 'I could not find any tickets or reservations in that drop.');
    } finally {
      setActivityStatus('');
      setBusy(false);
      dragDepthRef.current = 0;
      setDraggingTickets(false);
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    }
  }

  function dragHasFiles(e) {
    return Array.from(e.dataTransfer?.types || []).includes('Files');
  }

  function onTicketDragEnter(e) {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDraggingTickets(true);
  }

  function onTicketDragOver(e) {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function onTicketDragLeave(e) {
    if (!dragHasFiles(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingTickets(false);
  }

  function onTicketDrop(e) {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDraggingTickets(false);
    handleTicketFiles(e.dataTransfer?.files);
  }

  function onSubmit(e) {
    e.preventDefault();
    send();
  }

  // Keep keyboard focus on desktop when clicking send; don't block touch taps.
  function keepInputFocus(e) {
    if (e.pointerType === 'mouse') e.preventDefault();
  }

  function onSendClick(e) {
    e.preventDefault();
    send();
  }

  // Snapshot the clicked pill (position + a DOM clone) so it can fly into the
  // new user bubble once it mounts. Desktop only — the mobile sheet locks the
  // body, which complicates fixed-position ghosts, so it just sends there.
  function onSuggestionClick(q, e) {
    if (loading) return;
    const el = e?.currentTarget;
    if (wideEnough && el) {
      flyPendingRef.current = { text: q, from: el.getBoundingClientRect(), clone: el.cloneNode(true) };
    }
    send(q);
  }

  function newChat() {
    clearUploadPreviews();
    stopConciergePoll();
    setConciergeRun(null);
    setMessages([]);
    setError('');
    previousResponseIdRef.current = null;
    lastContextHashRef.current = null;
    lastWebSearchStopRef.current = null;
    clearTripChatSession(who, TRIP_ID);
    // Re-arm the nightly nudge so the brief re-opens the panel on the next load.
    clearConciergeSeen(TRIP_ID);
    inputRef.current?.focus();
  }

  const hasMessages = messages.length > 0;
  const panelStyle = wideEnough
    ? {
        width: `${panelWidth}px`,
        maxWidth: `calc(100vw - ${PANEL_MARGIN * 2}px)`,
        height: `${panelHeight}px`,
        maxHeight: `calc(100dvh - ${PANEL_MARGIN * 2}px)`,
        right: `${panelPos.right}px`,
        bottom: `${panelPos.bottom}px`,
      }
    : undefined;
  const rootStyle = mobileFrame ? {
    top: `${mobileFrame.top}px`,
    left: `${mobileFrame.left}px`,
    width: `${mobileFrame.width}px`,
    height: `${mobileFrame.height}px`,
  } : undefined;
  const composerPadBottom = wideEnough
    ? 'max(0.875rem, env(safe-area-inset-bottom))'
    : mobileFrame?.keyboardOpen
      ? '0.375rem'
      : 'max(0.625rem, env(safe-area-inset-bottom))';
  const webSearchHint = webSearch
    ? resolveWebSearchLocation(trip, input || 'today', webSearchOpts(input))
    : null;

  return html`
    <div
      ref=${rootRef}
      style=${rootStyle}
      class=${`fixed z-40 ${wideEnough || !mobileFrame ? 'inset-0' : ''} ${wideEnough ? 'pointer-events-none' : (active ? '' : 'pointer-events-none')}`}>
      ${!wideEnough && html`<div class=${`absolute inset-0 gg-scrim transition-opacity duration-300 ${active ? 'opacity-100' : 'opacity-0'}`}
        onClick=${onClose}></div>`}
      <aside
        ref=${asideRef}
        style=${panelStyle}
        onDragEnter=${onTicketDragEnter}
        onDragOver=${onTicketDragOver}
        onDragLeave=${onTicketDragLeave}
        onDrop=${onTicketDrop}
        class=${`gg-sheet gg-rim trip-chat-sheet pointer-events-auto z-[1] ${wideEnough ? 'trip-chat-sheet--float' : 'trip-chat-sheet--mobile'} ${wideEnough ? 'absolute overflow-hidden' : 'absolute inset-0 h-full max-h-full min-h-0'} flex flex-col will-change-transform origin-center ${(resizing || dragging) ? 'trip-chat-sheet--resizing' : (wideEnough ? 'transition duration-[130ms] ease-out' : 'transition-transform duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)]')} ${wideEnough ? '' : 'w-full'} ${wideEnough ? (active ? 'scale-100 opacity-100' : 'scale-[0.8] opacity-0') : (active ? 'translate-x-0' : 'translate-x-full')}`}>
        ${draggingTickets && html`<div class="trip-chat-drop-overlay absolute inset-0 z-40 grid place-items-center pointer-events-none">
          <div class="trip-chat-drop-target gg-rim px-5 py-4 text-center flex flex-col items-center gap-1.5">
            <span class="trip-chat-drop-arrow" aria-hidden="true"><${IconChevronDown} className="w-6 h-6" /></span>
            <div class="text-[13px] font-semibold text-slate-800">Drop tickets/reservations to add to itinerary</div>
          </div>
        </div>`}
        <div
          class="trip-chat-resize trip-chat-resize--x hidden sm:block"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat width"
          onPointerDown=${(e) => onResizePointerDown(e, 'x')}
        ></div>
        <div
          class="trip-chat-resize trip-chat-resize--y hidden sm:block"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize chat height"
          onPointerDown=${(e) => onResizePointerDown(e, 'y')}
        ></div>
        <div
          class="trip-chat-resize trip-chat-resize--corner hidden sm:block"
          role="separator"
          aria-label="Resize chat"
          onPointerDown=${(e) => onResizePointerDown(e, 'both')}
        ></div>
        <div class=${`trip-chat-header shrink-0 flex items-center justify-between gap-3 border-b border-[#1a1714] z-20 ${wideEnough ? `trip-chat-header--drag ${dragging ? 'trip-chat-header--dragging' : ''}` : ''}`}
          onPointerDown=${onHeaderPointerDown}
          style=${{
            paddingTop: 'max(0.25rem, env(safe-area-inset-top))',
            paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
            paddingBottom: '0.25rem',
            paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
          }}>
          <div class="flex items-center min-w-0">
            ${hasMessages && html`<button type="button" onClick=${newChat} disabled=${loading}
              class="trip-chat-new inline-flex items-center gap-1 text-[10px] leading-none font-semibold uppercase tracking-wide px-2 py-1 rounded-[2px] border-[1.5px] border-[#1a1714] disabled:opacity-50 transition active:scale-95">
              <${IconPlus} className="w-2.5 h-2.5" /> New
            </button>`}
          </div>
          <button onClick=${onClose} aria-label="Close chat"
            class="gg-icon-btn p-1 rounded-[2px] text-slate-500 shrink-0">
            <${IconX} className="w-3.5 h-3.5" />
          </button>
        </div>

        <div ref=${scrollRef}
          class="trip-chat-messages flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin px-4 pt-5 pb-3 space-y-3.5">
          ${!hasMessages && html`
            <div class="trip-chat-suggest flex flex-col justify-center min-h-full">
              <div class="trip-chat-marquee">
                <${MarqueeRow} items=${suggestRowA} direction=${1} loading=${loading}
                  onPick=${onSuggestionClick} onChipPointerDown=${keepInputFocus} />
                <${MarqueeRow} items=${suggestRowB} direction=${-1} loading=${loading}
                  onPick=${onSuggestionClick} onChipPointerDown=${keepInputFocus} />
              </div>
            </div>`}
          ${messages.map((m, i) => {
            if (m.concierge) {
              const typing = !!m.conciergeTyping;
              const runActive = !!conciergeRun && (conciergeRun.status === 'starting' || conciergeRun.status === 'running');
              const titles = (Array.isArray(m.conciergeSuggestions) ? m.conciergeSuggestions : [])
                .map((s) => (s && s.title ? String(s.title).trim() : ''))
                .filter(Boolean);
              const rowA = titles.filter((_, j) => j % 2 === 0);
              const rowB = titles.filter((_, j) => j % 2 === 1);
              // The report's day (resolved from the brief's date) drives the
              // day-plan mini-map — the same one used in the day plan.
              const briefDay = m.conciergeDate ? findDayOnTrip(trip, m.conciergeDate) : null;
              const printLabel = printStatus === 'printing' ? 'Printing…'
                : printStatus === 'done' ? 'Sent to Epson ✓'
                  : printerReady ? 'Print to Epson' : 'Print receipt';
              const briefPhrases = briefDay ? phrasesForCountry(briefDay.stop.country) : null;
              return html`
                <${Fragment} key=${`concierge-${i}`}>
                  <div class="trip-chat-receipt receipt-print-in">
                    <div class="receipt-masthead">
                      <div class="receipt-brand font-display">Claus</div>
                      <div class="receipt-sub">Daily briefing</div>
                      <div class="receipt-agents">Prepared overnight · Claude Managed Agents</div>
                    </div>
                    ${m.content
                      ? html`<div class="receipt-body"><${ChatMarkdown} text=${m.content} streaming=${typing} /></div>`
                      : html`<span class="inline-flex items-center py-0.5" aria-label="Thinking"><${BlockSpinner} size="md" /></span>`}
                    ${!typing && briefDay ? html`
                      <div class="trip-chat-brief-map receipt-screen-only">
                        <${DayMap} stop=${briefDay.stop} day=${briefDay.day} receipt=${true} />
                      </div>` : null}
                    ${!typing && briefPhrases ? html`
                      <div class="receipt-phrases">
                        <div class="receipt-phrases-head">Say it in ${briefPhrases.lang}</div>
                        ${briefPhrases.items.map(([en, loc]) => html`
                          <div class="receipt-phrase" key=${en}>
                            <span class="receipt-phrase-loc">${loc}</span>
                            <span class="receipt-phrase-dot" aria-hidden="true"></span>
                            <span class="receipt-phrase-en">${en}</span>
                          </div>`)}
                      </div>` : null}
                    ${!typing ? html`
                      <div class="receipt-foot" aria-hidden="true">
                        <div class="receipt-tak">· TAK ·</div>
                      </div>` : null}
                    <div class="receipt-tear" aria-hidden="true"></div>
                  </div>
                  ${conciergeRun ? html`<div class="receipt-controls">
                    <${ActivitySection} reasoning=${conciergeRun.reasoning} searches=${conciergeRun.searches}
                      streaming=${runActive} answerStarted=${false} placeholder="Preparing tomorrow’s brief…" />
                  </div>` : null}
                  ${conciergeRun && conciergeRun.status === 'error' ? html`
                    <p class="trip-chat-run-error">${conciergeRun.error}</p>` : null}
                  ${!typing && !runActive ? html`
                    <div class="receipt-controls receipt-buttons">
                      <button type="button" class="trip-chat-rerun" onClick=${runBriefingAgain}
                        aria-label="Run briefing agent again">
                        <span class="trip-chat-rerun-ico" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                        </span>
                        Run again
                      </button>
                      <button type="button" class=${`trip-chat-rerun ${printerReady ? 'trip-chat-rerun--epson' : ''}`}
                        onClick=${() => (printerReady ? printToEpson() : printBriefing())}
                        disabled=${printStatus === 'printing'}
                        aria-label=${printerReady ? 'Print this briefing to the Epson receipt printer' : 'Print this briefing (80mm receipt)'}>
                        <span class="trip-chat-rerun-ico" aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M7 8V3h10v5" /><path d="M7 16H4a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 4 8h16a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 20 16h-3" /><path d="M7 13h10v8H7z" />
                          </svg>
                        </span>
                        ${printLabel}
                      </button>
                    </div>` : null}
                  ${!typing && !runActive && (printerReady || printStatus === 'browser') ? html`
                    <p class=${`receipt-print-hint ${printStatus === 'browser' ? 'is-warn' : ''}`}>
                      <span class="receipt-print-dot" aria-hidden="true"></span>
                      ${printStatus === 'browser' ? 'Epson unreachable — used the browser print dialog' : 'Epson ready · auto-prints each new day'}
                    </p>` : null}
                  ${!typing && titles.length && !runActive ? html`
                    <div class="trip-chat-marquee trip-chat-marquee--concierge">
                      <${MarqueeRow} items=${rowA} direction=${1} loading=${loading}
                        onPick=${onSuggestionClick} onChipPointerDown=${keepInputFocus} />
                      ${rowB.length ? html`<${MarqueeRow} items=${rowB} direction=${-1} loading=${loading}
                        onPick=${onSuggestionClick} onChipPointerDown=${keepInputFocus} />` : null}
                    </div>` : null}
                </${Fragment}>`;
            }
            const isStreaming = m.role === 'assistant' && streaming && i === messages.length - 1;
            const bubble = html`<div key=${`msg-${i}`} class=${`flex ${m.role === 'user' ? 'justify-end pl-6' : 'justify-start pr-4'}`}>
              <div class=${`max-w-full rounded-[3px] px-4 py-3 ${
                m.role === 'user'
                  ? 'trip-chat-bubble-user text-white rounded-br-[1px]'
                  : 'trip-chat-bubble-assistant text-slate-800 rounded-bl-[1px]'
              }`}>
                ${m.role === 'user'
                  ? html`<${UploadUserMessage} message=${m} />`
                  : isAppliedConfirmation(m.content)
                    ? html`<${AppliedConfirmation} text=${m.content} />`
                    : html`<${ChatMarkdown} text=${m.content} streaming=${isStreaming} />`}
              </div>
            </div>`;
            if (m.role !== 'assistant') return bubble;
            // Activity (thinking + web searches) renders above the answer bubble:
            // live state for the streaming turn, persisted state afterward. The
            // section shows the "thinking…" state itself, so the bubble only
            // appears once real answer text has arrived.
            return html`
              <${Fragment} key=${i}>
                <${ActivitySection}
                  reasoning=${isStreaming ? reasoningSummary : m.reasoning}
                  searches=${isStreaming ? liveSearches : m.searches}
                  streaming=${isStreaming}
                  answerStarted=${isStreaming ? answerStarted : true}
                  placeholder=${isStreaming && showThinking ? thinkingPlaceholder : ''} />
                ${m.content ? bubble : null}
              </${Fragment}>`;
          })}
          ${activityStatus && html`
            <div class="flex justify-start pr-4" aria-live="polite">
              <div class="trip-chat-bubble-assistant trip-chat-activity text-slate-700 rounded-[3px] px-4 py-3">
                <span class="inline-flex items-center gap-2 trip-chat-text m-0 min-w-0">
                  <${BlockSpinner} key=${activityStatus} size="sm" />
                  <span class="trip-chat-activity-label">${activityStatus}</span>
                </span>
              </div>
            </div>`}
          ${error && html`<p class="text-xs text-amber-800 bg-amber-50 border-[1.5px] border-[#1a1714] rounded-[2px] px-3 py-2.5 m-0">${error}</p>`}
          ${!configured && html`<p class="text-xs text-slate-500 m-0 px-1">${klausName} is off — add your Anthropic key in Vercel.</p>`}
        </div>

        <form onSubmit=${onSubmit} class="trip-chat-composer shrink-0 z-10"
          style=${{
            paddingTop: '0.625rem',
            paddingRight: wideEnough ? 'max(0.875rem, env(safe-area-inset-right))' : 'max(0.75rem, env(safe-area-inset-right))',
            paddingBottom: composerPadBottom,
            paddingLeft: wideEnough ? 'max(0.875rem, env(safe-area-inset-left))' : 'max(0.75rem, env(safe-area-inset-left))',
          }}>
          <div class="trip-chat-composer-inner flex gap-1.5">
            <div
              class="trip-chat-input-shell flex flex-1 min-w-0"
              onClick=${() => inputRef.current?.focus()}>
              <textarea
                ref=${inputRef}
                rows="1"
                value=${input}
                readOnly=${loading}
                placeholder="Ask ${klausName}…"
                enterKeyHint="send"
                onFocus=${() => requestAnimationFrame(scrollMessagesToBottom)}
                onInput=${(e) => {
                  setInput(e.target.value);
                  requestAnimationFrame(() => {
                    resizeInput(inputRef.current);
                    scrollMessagesToBottom();
                  });
                }}
                onKeyDown=${(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                class="trip-chat-input flex-1 min-w-0 resize-none bg-transparent text-slate-800 placeholder:text-slate-400 focus:outline-none read-only:opacity-60"
              />
              <div class="trip-chat-inline-tools shrink-0 flex items-center gap-0.5">
                <input ref=${ticketInputRef} type="file" accept=${TICKET_ACCEPT} multiple class="hidden"
                  onChange=${(e) => { handleTicketFiles(e.target.files); e.target.value = ''; }} />
                <button
                  type="button"
                  disabled=${streaming || busy}
                  aria-label="Attach tickets or reservations"
                  title="Attach travel tickets or restaurant reservations (PDFs or screenshots)"
                  onClick=${() => ticketInputRef.current?.click()}
                  onPointerDown=${keepInputFocus}
                  class="trip-chat-attach">
                  <${IconPaperclip} className="trip-chat-attach-icon" />
                </button>
                <${Tooltip} label="Web search">
                  <button
                    type="button"
                    disabled=${streaming || busy}
                    aria-label=${webSearch ? 'Web search on' : 'Web search off'}
                    aria-pressed=${webSearch}
                    onClick=${() => setWebSearch((on) => !on)}
                    onPointerDown=${keepInputFocus}
                    class=${`trip-chat-web-toggle ${webSearch ? 'trip-chat-web-toggle--on' : 'trip-chat-web-toggle--off'}`}>
                    <${IconGlobe} className="trip-chat-web-toggle-icon" />
                  </button>
                </${Tooltip}>
              </div>
            </div>
            <button type="button" disabled=${streaming || !input.trim()}
              aria-label="Send message"
              onClick=${onSendClick}
              onPointerDown=${keepInputFocus}
              class="trip-chat-send shrink-0 rounded-[2px] grid place-items-center transition disabled:opacity-35">
              <${IconSend} className="trip-chat-send-icon" />
            </button>
          </div>
        </form>
      </aside>
    </div>`;
}

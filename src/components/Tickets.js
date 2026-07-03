import { html, useState, useEffect, useMemo, useRef, Fragment } from '../html.js';
import { createPortal } from 'react-dom';
import { IconPlus, IconX, IconTrash, IconExternal, IconCheck, IconWarning, IconTicket } from './icons.js';
import { formatWithWeekday } from '../lib/dates.js';
import { celebrate } from '../lib/confetti.js';
import { confirmDialog } from '../lib/confirmDialog.js';

// Tickets (PDFs or photos) live on the transport leg as data URLs so they sync
// and persist with the trip. Keep each one modest — localStorage is ~5 MB and
// the whole trip re-uploads on every sync.
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/*';

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// data: URLs don't reliably open in a new tab (iOS blocks them); a blob: URL
// does, and previews inline.
function dataUrlToBlobUrl(dataUrl) {
  try {
    const [meta, b64] = String(dataUrl).split(',');
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: mime }));
  } catch {
    return '';
  }
}

function cleanISODate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '';
}

function dateLine(label, planned, ticket) {
  return { label, planned, ticket };
}

function ticketDateWarning(ticket, fields, context = {}) {
  const plannedDep = cleanISODate(context.plannedDepDate || context.travelDate);
  const plannedArr = cleanISODate(context.plannedArrDate || context.plannedDepDate || context.travelDate);
  const ticketDep = cleanISODate(fields.depDate);
  const ticketArr = cleanISODate(fields.arrDate);
  const rows = [];
  if (plannedDep && ticketDep && plannedDep !== ticketDep) rows.push(dateLine('Departure day', plannedDep, ticketDep));
  if (plannedArr && ticketArr && plannedArr !== ticketArr) rows.push(dateLine('Arrival day', plannedArr, ticketArr));
  if (!rows.length) return null;
  const kind = context.contextKind === 'schedule' ? 'day plan block' : 'timeline leg';
  return {
    ticketName: ticket.name || 'Ticket',
    kind,
    label: context.blockTitle || context.legLabel || context.routeLabel || '',
    rows,
  };
}

// Shrink a screenshot/photo before sending it for vision analysis — keeps the
// request under the serverless body limit and cuts tokens. The stored ticket
// keeps full resolution; only this copy is downscaled.
function downscaleImage(dataUrl, maxEdge = 1600) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      if (scale >= 1) { resolve(dataUrl); return; }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Ask the serverless reader to parse one ticket (PDF → text+layout, image →
// vision) and hand the fields to onAutofill (which returns the list of fields
// it filled). Returns a status + detail for the pill by the button.
async function extractTicket(ticket, context, onAutofill) {
  let dataUrl = ticket.dataUrl;
  if ((ticket.type || '').startsWith('image/')) dataUrl = await downscaleImage(dataUrl);
  // ~4 MB base64 keeps the request under Vercel's body limit; skip if larger.
  if (!dataUrl || dataUrl.length > 4 * 1024 * 1024) return { status: 'toobig' };
  try {
    const r = await fetch('/api/extract-ticket', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl, ...context }),
    });
    if (r.status === 503) return { status: 'unconfigured' };
    if (!r.ok) return { status: 'error' };
    const { fields } = await r.json();
    if (!fields || fields.matched === false || fields.matched === 'false') return { status: 'nomatch' };
    const warning = ticketDateWarning(ticket, fields, context);
    const filled = onAutofill(fields) || [];
    return filled.length
      ? { status: 'done', detail: filled.join(', '), warning }
      : { status: 'nochange', warning };
  } catch {
    return { status: 'error' };
  }
}

// tone → text + colour for the status pill.
const STATUS = {
  reading: { tone: 'info', text: 'Reading ticket…' },
  done: { tone: 'good', text: 'Filled from ticket' },
  nochange: { tone: 'muted', text: 'Ticket read — those details were already filled in' },
  nomatch: { tone: 'warn', text: "Couldn't match this ticket to this leg — add the details by hand" },
  toobig: { tone: 'warn', text: 'PDF too large to auto-read (keep it under ~3 MB)' },
  error: { tone: 'warn', text: "Couldn't read the ticket automatically" },
  unconfigured: { tone: 'warn', text: 'Auto-fill is off — set ANTHROPIC_API_KEY in Vercel to enable it' },
};
const TONE_CLASS = {
  info: 'bg-fjord-50 text-fjord-700 border-[#1a1714]',
  good: 'bg-emerald-50 text-emerald-700 border-[#1a1714]',
  muted: 'bg-stone-50 text-slate-500 border-[#1a1714]',
  warn: 'bg-amber-50 text-amber-700 border-[#1a1714]',
};
const TONE_ICON = { good: IconCheck, warn: IconWarning, muted: IconTicket };

// Pinch / wheel / double-tap zoom + pan for a ticket image preview. A
// transparent gesture-catcher sits on top to capture touch events. The inner
// element is scaled via CSS transform. (PDFs use a native scrollable <iframe>
// instead, so multi-page documents scroll on their own.)
function PinchZoom({ resetKey, children }) {
  const innerRef = useRef(null);
  const catchRef = useRef(null);
  const s = useRef({ scale: 1, tx: 0, ty: 0, mode: null, d0: 0, s0: 1, m0: null, t0: null, last: null });

  const apply = () => {
    const z = s.current;
    if (innerRef.current) innerRef.current.style.transform = `translate(${z.tx}px, ${z.ty}px) scale(${z.scale})`;
    if (catchRef.current) catchRef.current.style.cursor = z.scale > 1 ? 'grab' : 'default';
  };
  const reset = () => { Object.assign(s.current, { scale: 1, tx: 0, ty: 0, mode: null }); apply(); };
  useEffect(() => { reset(); }, [resetKey]);

  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

  function onTouchStart(e) {
    const z = s.current; const t = e.touches;
    if (t.length === 2) {
      z.mode = 'pinch'; z.d0 = dist(t); z.s0 = z.scale; z.m0 = mid(t); z.tx0 = z.tx; z.ty0 = z.ty;
    } else if (t.length === 1 && z.scale > 1.01) {
      z.mode = 'pan'; z.last = { x: t[0].clientX, y: t[0].clientY };
    } else { z.mode = null; }
  }
  function onTouchMove(e) {
    const z = s.current; const t = e.touches;
    if (z.mode === 'pinch' && t.length === 2) {
      z.scale = Math.min(5, Math.max(1, z.s0 * (dist(t) / (z.d0 || 1))));
      const m = mid(t);
      z.tx = z.tx0 + (m.x - z.m0.x); z.ty = z.ty0 + (m.y - z.m0.y);
      apply();
    } else if (z.mode === 'pan' && t.length === 1) {
      z.tx += t[0].clientX - z.last.x; z.ty += t[0].clientY - z.last.y;
      z.last = { x: t[0].clientX, y: t[0].clientY };
      apply();
    }
  }
  function onTouchEnd(e) {
    const z = s.current;
    if (e.touches.length === 0) { z.mode = null; if (z.scale <= 1.01) reset(); }
    else if (e.touches.length === 1) { z.mode = 'pan'; z.last = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
  }
  function onWheel(e) {
    if (!(e.ctrlKey || e.metaKey)) return; // trackpad pinch arrives as ctrl+wheel
    e.preventDefault();
    const z = s.current;
    z.scale = Math.min(5, Math.max(1, z.scale * (e.deltaY < 0 ? 1.12 : 0.89)));
    if (z.scale <= 1.01) { z.tx = 0; z.ty = 0; }
    apply();
  }
  function onDblClick() {
    const z = s.current;
    if (z.scale > 1.01) reset(); else { z.scale = 2.2; apply(); }
  }

  return html`<div class="relative overflow-hidden bg-[#fff]">
    <div ref=${innerRef} class="will-change-transform" style=${{ transformOrigin: 'center center', transition: 'none' }}>
      ${children}
    </div>
    <div ref=${catchRef} class="absolute inset-0" style=${{ touchAction: 'none' }}
      title="Pinch, scroll-zoom, or double-tap to zoom"
      onTouchStart=${onTouchStart} onTouchMove=${onTouchMove} onTouchEnd=${onTouchEnd}
      onWheel=${onWheel} onDblClick=${onDblClick}></div>
  </div>`;
}

// Render a PDF fit-to-width with pdf.js. The native <iframe> viewer ignores
// #view=FitH on iOS (you end up scrolling sideways), so we rasterize each page
// to a canvas sized to the container width and stack them in a scroll column.
// Falls back to the iframe if pdf.js can't load (e.g. offline).
function PdfView({ url, name }) {
  const hostRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let doc = null;
    (async () => {
      try {
        const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';
        doc = await pdfjs.getDocument(url).promise;
        if (cancelled) return;
        const host = hostRef.current;
        if (!host) return;
        host.innerHTML = '';
        const cssWidth = host.clientWidth || 700;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (cssWidth * dpr) / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.display = 'block';
          if (i > 1) canvas.style.marginTop = '10px';
          host.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; if (doc) { try { doc.destroy(); } catch { /* noop */ } } };
  }, [url]);

  if (failed) {
    return html`<iframe src=${`${url}#view=FitH`} title=${name || 'Ticket PDF'}
      class="block w-full h-[82vh] bg-[#fff]"></iframe>`;
  }
  return html`<div ref=${hostRef} class="w-full max-h-[82vh] overflow-y-auto overflow-x-hidden bg-[#fff] p-1"></div>`;
}

function TicketView({ ticket, onRemove }) {
  const url = useMemo(() => dataUrlToBlobUrl(ticket.dataUrl), [ticket.dataUrl]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const isImg = (ticket.type || '').startsWith('image/');
  const isPdf = (ticket.type || '').includes('pdf') || /\.pdf$/i.test(ticket.name || '');

  return html`<div class="rounded-[3px] border border-[1.5px] border-[#1a1714] bg-white overflow-hidden">
    <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#1a1714]">
      <span class="min-w-0 truncate text-[12px] font-medium text-slate-600" title=${ticket.name}>
        ${ticket.name || 'Ticket'}
      </span>
      <div class="flex items-center gap-1 shrink-0">
        <a href=${url} download=${ticket.name || 'ticket'}
          class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-[2px] text-fjord-700 hover:bg-fjord-50"
          title="Save to this device (so you can open it offline)">
          ⤓ Save
        </a>
        <a href=${url} target="_blank" rel="noopener"
          class="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-[2px] text-fjord-700 hover:bg-fjord-50"
          title="Open in a new tab">
          <${IconExternal} className="w-3.5 h-3.5" /> Open
        </a>
        <button type="button" onClick=${onRemove} title="Remove ticket" aria-label="Remove ticket"
          class="inline-flex items-center px-2 py-1 rounded-[2px] text-rose-500 hover:bg-rose-50">
          <${IconTrash} className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
    ${isImg
      ? html`<${PinchZoom} resetKey=${ticket.id}>
          <img src=${url} alt=${ticket.name || 'Ticket'} class="block w-full max-h-[82vh] object-contain mx-auto" />
        <//>`
      : isPdf
        ? html`<${PdfView} url=${url} name=${ticket.name} />`
        : html`<div class="bg-[#fff] p-5 text-center text-[12px] text-slate-500">
            <a href=${url} target="_blank" rel="noopener" class="text-fjord-700 underline">Open file</a>
          </div>`}
  </div>`;
}

function TicketDateWarningModal({ warning, onClose }) {
  const [shown, setShown] = useState(false);
  const [exiting, setExiting] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => { requestAnimationFrame(() => setShown(true)); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(closeTimer.current);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  function close() {
    if (closeTimer.current) return;
    setExiting(true);
    closeTimer.current = setTimeout(onClose, 280);
  }

  const visible = shown && !exiting;
  const rows = warning?.rows || [];

  return createPortal(html`<div
    class="fixed inset-0 z-[2200] overflow-y-auto welcome-modal-scrim"
    style=${{ opacity: exiting ? 0 : 1, transition: 'opacity 0.28s ease' }}
    onClick=${close}
    role="dialog" aria-modal="true" aria-label="Ticket date warning">
    <div class="min-h-full flex flex-col justify-center px-5"
      style=${{
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
        paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))',
      }}>
      <div class="welcome-modal-panel gg-rim w-full max-w-md mx-auto flex flex-col gap-4 rounded-[3px] p-6 sm:p-7"
        onClick=${(e) => e.stopPropagation()}
        style=${{
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.97)',
          transition: 'transform 0.36s cubic-bezier(0.22,1,0.36,1)',
        }}>
        <div class="text-center">
          <div class="mb-2 flex justify-center text-amber-500" aria-hidden="true"><${IconWarning} className="w-8 h-8" /></div>
          <h2 class="font-display font-bold tracking-tight text-[1.55rem] sm:text-3xl text-slate-800 leading-tight">
            Ticket date mismatch
          </h2>
          <p class="text-[13px] text-slate-500 mt-1.5">
            ${warning?.ticketName || 'This ticket'} does not match this ${warning?.kind || 'planned travel'}.
          </p>
        </div>

        <div class="rounded-[3px] border border-[1.5px] border-[#1a1714] bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-950">
          ${warning?.label && html`<div class="font-semibold mb-1">${warning.label}</div>`}
          Check the planned day before relying on the auto-filled ticket details.
        </div>

        <div class="rounded-[3px] border border-[1.5px] border-[#1a1714] bg-white divide-y divide-[#1a1714]">
          ${rows.map((row) => html`<div key=${row.label} class="grid grid-cols-[1fr_auto] gap-3 px-3.5 py-3">
            <div class="min-w-0">
              <div class="uppercase tracking-wide text-[11px] font-semibold text-slate-500">${row.label}</div>
              <div class="text-sm font-medium text-slate-700 mt-0.5">Planned: ${formatWithWeekday(row.planned)}</div>
            </div>
            <div class="text-right">
              <div class="uppercase tracking-wide text-[11px] font-semibold text-amber-700">Ticket</div>
              <div class="text-sm font-semibold text-amber-900 mt-0.5">${formatWithWeekday(row.ticket)}</div>
            </div>
          </div>`)}
        </div>

        <button onClick=${close}
          class="welcome-cta mt-1 w-full py-3.5 rounded-[2px] bg-[#1a1714] text-[#f4f3ee] text-sm font-semibold active:scale-[0.98] flex items-center justify-center">
          Got it
        </button>
      </div>
    </div>
  </div>`, document.body);
}

export function TicketsModal({ title, tickets, onAdd, onRemove, onClose }) {
  const [shown, setShown] = useState(false);
  const [exiting, setExiting] = useState(false);
  const closeTimer = useRef(null);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => { requestAnimationFrame(() => setShown(true)); }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (panelRef.current) panelRef.current.scrollTop = 0;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    });
    return () => cancelAnimationFrame(id);
  }, []);

  function close() {
    if (closeTimer.current) return;
    setExiting(true);
    closeTimer.current = setTimeout(onClose, 260);
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(closeTimer.current); window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, []);

  const visible = shown && !exiting;

  // Full-screen viewer, portaled to <body> so it sits on top of everything and
  // isn't confined by the (transformed) leg editor it's triggered from. Rises +
  // fades on open, reverses on close.
  return createPortal(html`<div class="fixed inset-0 z-[2000] welcome-modal-scrim tickets-modal-root"
    style=${{ opacity: visible ? 1 : 0, transition: 'opacity 0.24s ease' }}
    role="dialog" aria-modal="true" aria-label="Tickets">
    <div ref=${panelRef} class="welcome-modal-panel gg-rim tickets-modal-panel flex flex-col"
      style=${{
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.985)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.34s cubic-bezier(0.22,1,0.36,1), opacity 0.26s ease',
        transformOrigin: 'center bottom',
      }}>
      <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#1a1714] shrink-0">
        <h2 class="font-display font-bold tracking-tight text-base text-slate-800 flex items-center gap-2 min-w-0">
          <span class="inline-flex items-center" aria-hidden="true"><${IconTicket} className="w-4 h-4" /></span>
          <span class="truncate">${title || 'Tickets'}</span>
        </h2>
        <div class="flex items-center gap-2 shrink-0">
          <button type="button" onClick=${onAdd}
            class="inline-flex items-center gap-1 text-[12px] px-2.5 py-1.5 rounded-[2px] border border-[1.5px] border-[#1a1714] bg-white text-slate-800 font-medium hover:bg-[#1a1714] hover:text-[#f4f3ee] transition">
            <${IconPlus} className="w-3.5 h-3.5" /> Add
          </button>
          <button type="button" onClick=${close} aria-label="Close"
            class="p-1.5 rounded-[2px] text-slate-400 hover:text-slate-600 hover:bg-stone-100 transition">
            <${IconX} className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div ref=${scrollRef} class="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-4 scrollbar-thin tickets-modal-scroll">
        ${tickets.length === 0
          ? html`<p class="text-sm text-slate-500 py-12 text-center">
              No tickets yet. Tap <span class="font-medium text-fjord-700">Add</span> to attach a PDF or photo.
            </p>`
          : html`<div class="max-w-3xl mx-auto space-y-4">
              ${tickets.map((tk) => html`<${TicketView} key=${tk.id} ticket=${tk} onRemove=${() => onRemove(tk.id)} />`)}
            </div>`}
      </div>
    </div>
  </div>`, document.body);
}

// The button shown next to "Mark as booked". With tickets attached it reads
// "View tickets (n)" and opens the viewer; with none it reads "Upload tickets"
// and opens the file picker straight away. When a PDF is uploaded and an
// onAutofill handler is wired, it asks the reader to fill the leg's details.
export function TicketsButton({ tickets = [], onChange, title, context = null, onAutofill = null, onUpload = null }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState('');
  const [dateWarning, setDateWarning] = useState(null);
  const inputRef = useRef(null);
  const statusTimer = useRef(null);
  const btnRef = useRef(null);
  const has = tickets.length > 0;

  function flashStatus(s, d = '') {
    setStatus(s);
    setDetail(d);
    clearTimeout(statusTimer.current);
    // Keep warnings/errors up (they need acting on); fade the happy ones.
    if (s === 'done' || s === 'nochange') {
      statusTimer.current = setTimeout(() => { setStatus(''); setDetail(''); }, 7000);
    }
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const added = [];
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        await confirmDialog({
          title: 'Ticket too large',
          message: `"${f.name}" is ${(f.size / 1048576).toFixed(1)} MB — please attach tickets under 8 MB.`,
          confirmLabel: 'OK',
          cancelLabel: null,
        });
        continue;
      }
      try {
        const dataUrl = await readAsDataUrl(f);
        added.push({
          id: `tk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: f.name, type: f.type || '', size: f.size, dataUrl,
        });
      } catch { /* skip unreadable file */ }
    }
    if (!added.length) return;
    onChange([...tickets, ...added]);
    if (onUpload) onUpload(); // attaching a ticket marks the leg booked

    const parseable = added.filter((t) => (t.type || '').includes('pdf') || (t.type || '').startsWith('image/'));
    const willAutofill = onAutofill && context && parseable.length > 0;
    // When autofilling, stay on the editor so the status pill + filled fields are
    // visible; otherwise pop the viewer to confirm what was attached.
    if (!willAutofill) { setOpen(true); return; }

    flashStatus('reading');
    let last = { status: 'nomatch' };
    let warning = null;
    for (const tk of parseable) {
      last = await extractTicket(tk, context, onAutofill);
      if (last.warning && !warning) warning = last.warning;
      if (last.status === 'done' || last.status === 'unconfigured') break;
    }
    if (warning) setDateWarning(warning);
    flashStatus(last.status, last.detail || '');
    // Reading a ticket and filling the leg is a real win — celebrate it.
    if (last.status === 'done') celebrate(btnRef.current, { count: 120, power: 1.15 });
  }

  const pick = () => inputRef.current && inputRef.current.click();
  const tone = status ? (STATUS[status] || {}).tone || 'muted' : '';

  return html`<${Fragment}>
    <button ref=${btnRef} type="button" onClick=${() => (has ? setOpen(true) : pick())}
      title=${has ? 'View attached tickets' : 'Attach a ticket PDF or photo'}
      class=${`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-[2px] border border-[1.5px] font-medium transition ${has
        ? 'bg-fjord-50 text-fjord-700 border-[#1a1714]'
        : 'bg-white text-slate-500 border-[#1a1714] hover:bg-[#1a1714] hover:text-[#f4f3ee]'}`}>
      <span class="inline-flex items-center" aria-hidden="true"><${IconTicket} className="w-5 h-5" /></span>
      ${has ? `View tickets (${tickets.length})` : 'Upload tickets'}
    </button>
    ${status && html`<span role="status" aria-live="polite"
      class=${`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-[2px] border border-[1.5px] font-medium ${TONE_CLASS[tone] || TONE_CLASS.muted}`}>
      ${status === 'reading'
        ? html`<span class="inline-block w-3 h-3 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden="true"></span>`
        : html`<span aria-hidden="true">${TONE_ICON[tone] || ''}</span>`}
      <span>${(STATUS[status] || {}).text || ''}${status === 'done' && detail ? `: ${detail}` : ''}</span>
    </span>`}
    <input ref=${inputRef} type="file" accept=${ACCEPT} multiple class="hidden"
      onChange=${(e) => { addFiles(e.target.files); e.target.value = ''; }} />
    ${open && html`<${TicketsModal} title=${title} tickets=${tickets} onAdd=${pick}
      onRemove=${(id) => onChange(tickets.filter((t) => t.id !== id))}
      onClose=${() => setOpen(false)} />`}
    ${dateWarning && html`<${TicketDateWarningModal} warning=${dateWarning} onClose=${() => setDateWarning(null)} />`}
  </${Fragment}>`;
}

import { html, useState, Fragment } from '../html.js';
import { bookingGuidance, liveSearchUrl, operatorBookingUrl, legTravelDate, URGENCY } from '../data/booking.js';
import { IconExternal, IconChevronDown, IconChevronRight, IconSearch, IconCalendar, IconTicket } from './icons.js';

const TONE = {
  rose: 'bg-rose-50 text-rose-700 border-rose-300',
  amber: 'bg-amber-50 text-amber-800 border-amber-300',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-300',
};

function opKey(o) {
  return (o?.url || o?.name || '').toLowerCase();
}

function uniqueOperators(list) {
  const seen = new Set();
  return (list || []).filter((o) => {
    const k = opKey(o);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function BookingLinks({ g, compact = false, fromStop, toStop, mode, transport }) {
  const travelDate = legTravelDate(fromStop);
  const live = liveSearchUrl(fromStop, toStop, mode, transport);
  const rec = g.recommend;
  const ops = uniqueOperators(g.operators);
  const featured = rec || (ops.length === 1 ? ops[0] : null);
  const featuredKey = featured ? opKey(featured) : null;
  const alternates = ops.filter((o) => opKey(o) !== featuredKey);
  const ctx = { fromStop, toStop, mode, transport };
  const dateKey = travelDate || 'nodate';

  return html`<div>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <a key=${`live-${dateKey}`} href=${live} target="_blank" rel="noopener"
        class="inline-flex items-center gap-0.5 text-fjord-600 hover:text-fjord-800 font-medium whitespace-nowrap">
        <span class="inline-flex items-center gap-1"><${IconSearch} className="w-3 h-3" /> Check live times & prices</span> <${IconExternal} className="w-2.5 h-2.5 opacity-60" /></a>
      ${featured && html`<${Fragment}>
        <span class="text-slate-300">·</span>
        <a key=${`book-${dateKey}-${featuredKey}`} href=${operatorBookingUrl(featured, ctx) || featured.url} target="_blank" rel="noopener"
          class=${`inline-flex items-center gap-0.5 font-medium whitespace-nowrap ${rec ? 'text-emerald-700 hover:text-emerald-900' : 'text-fjord-600 hover:text-fjord-800'}`}>
          ${rec ? '★ Book at' : 'Book at'} ${featured.name} <${IconExternal} className="w-2.5 h-2.5 opacity-60" /></a>
      </${Fragment}>`}
      ${alternates.length > 0 && html`<${Fragment}>
        <span class="text-slate-300">·</span>
        <span class="text-[10px] text-slate-400">${featured ? 'Also:' : 'Options:'}</span>
        ${alternates.map((o) => html`<a key=${`${dateKey}-${o.url}`} href=${operatorBookingUrl(o, ctx) || o.url} target="_blank" rel="noopener"
          class="text-[10px] text-fjord-600 hover:underline inline-flex items-center gap-0.5">${o.name} <${IconExternal} className="w-2 h-2 opacity-60" /></a>`)}
      </${Fragment}>`}
    </div>
    ${rec && rec.why && !compact && html`<p class="mt-1 text-emerald-700/90 leading-snug text-[10px]">${rec.why}.</p>`}
    ${ops.length > 1 && !rec && g.operatorsNote && html`<p class="mt-1 text-slate-500 leading-snug text-[10px]">${g.operatorsNote}</p>`}
  </div>`;
}

// Booking guidance for a single leg. When embedded=true, lives inside the
// transport edit panel — no separate dropdown.
export function BookingGuide({ fromStop, toStop, mode, transport, embedded = false }) {
  const [open, setOpen] = useState(false);
  if (!fromStop || !toStop || !mode) return null;

  const g = bookingGuidance(fromStop, toStop, mode);
  const u = URGENCY[g.urgency] || URGENCY.recommended;
  const linkProps = { g, fromStop, toStop, mode, transport };

  if (embedded) {
    return html`<div class="text-[11px] pt-2 border-t border-[#1a1714]">
      <div class="flex flex-wrap items-center gap-1.5 mb-1">
        <span class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Booking</span>
        <span class=${`inline-flex items-center px-1.5 py-px rounded-[2px] border border-[1.5px] font-semibold text-[9px] ${TONE[u.tone] || TONE.amber}`}>
          ${u.label}
        </span>
      </div>
      <p class="text-slate-600 leading-snug">${g.headline}.</p>
      ${g.window && html`<p class="text-slate-400 mt-0.5 inline-flex items-center gap-1"><${IconCalendar} className="w-3 h-3" /> ${g.window}</p>`}
      <div class="mt-1.5">
        <${BookingLinks} ...${linkProps} compact=${true} />
      </div>
    </div>`;
  }

  return html`<div class="mt-1.5 text-[11px]">
    <button onClick=${() => setOpen(!open)}
      class="group inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-700 transition-colors">
      ${open
        ? html`<${IconChevronDown} className="w-3 h-3 transition-transform" />`
        : html`<${IconChevronRight} className="w-3 h-3 transition-transform" />`}
      <span class="inline-flex items-center"><${IconTicket} className="w-4 h-4" /></span>
      <span class="font-medium">Booking</span>
      <span class=${`inline-flex items-center px-1.5 py-px rounded-[2px] border border-[1.5px] font-semibold ${TONE[u.tone] || TONE.amber}`}>
        ${u.label}
      </span>
    </button>

    ${open && html`<div class="mt-1.5 ml-1 pl-3 border-l-2 border-[#1a1714] space-y-1.5 animate-fade-in">
      <p class="text-slate-600 font-medium leading-snug">${g.headline}.</p>
      <p class="text-slate-500 leading-relaxed">${g.detail}</p>
      ${g.window && html`<p class="text-slate-400 inline-flex items-center gap-1"><${IconCalendar} className="w-3 h-3" /> ${g.window}</p>`}
      <${BookingLinks} ...${linkProps} />
    </div>`}
  </div>`;
}

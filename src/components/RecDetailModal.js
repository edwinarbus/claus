import { html, useState, useEffect, useRef } from '../html.js';
import { createPortal } from 'react-dom';
import { useWikiImage } from './useWikiImage.js';
import { ItemGlyph } from './ItemGlyph.js';
import { TierBadge, DurationChip, TagChips, HeatFlag, ClosedFlag, heatReasonText } from './ItemBits.js';
import { appleMapsUrl, googleMapsUrl } from '../lib/maps.js';
import { MapsLinks } from './MapsLinks.js';
import { IconX, IconChevronDown, IconChevronRight, IconExternal, IconApple, IconGoogleG } from './icons.js';

function combineDesc(item) {
  const a = (item.blurb || '').trim();
  const b = (item.why || '').trim();
  if (a && b) {
    const al = a.toLowerCase(); const bl = b.toLowerCase();
    if (al.includes(bl)) return a;
    if (bl.includes(al)) return b;
    const sep = /[.!?]$/.test(a) ? ' ' : ' — ';
    return a + sep + b.charAt(0).toUpperCase() + b.slice(1);
  }
  return a || b;
}

function priceStr(n) {
  const v = Number(n) || 0;
  return v > 0 ? '$'.repeat(Math.min(4, v)) : '';
}
function starCount(p) {
  if (typeof p.stars === 'number') return p.stars;
  if (typeof p.michelin === 'number') return p.michelin;
  return 0;
}
function isBib(p) { return p.bib === true || p.michelin === 'bib'; }

function PlaceBadges({ p }) {
  const stars = starCount(p);
  const bib = isBib(p);
  const price = priceStr(p.price);
  if (!stars && !bib && !price && !p.cuisine) return null;
  return html`<span class="inline-flex items-center gap-1.5 flex-wrap align-middle ml-1">
    ${stars > 0 && html`<span class="text-[10px] font-bold text-rose-700">${'★'.repeat(stars)}</span>`}
    ${bib && html`<span class="text-[9px] font-bold uppercase tracking-wide text-rose-700 border border-rose-200 rounded-[2px] px-1 py-px">Bib</span>`}
    ${price && html`<span class="text-[10px] font-semibold text-emerald-700">${price}</span>`}
    ${p.cuisine && html`<span class="text-[10px] text-slate-400">${p.cuisine}</span>`}
  </span>`;
}

function PlacesSection({ places, cityName }) {
  const [open, setOpen] = useState(false);
  if (!places || !places.length) return null;
  const starry = places.filter((p) => starCount(p) > 0 || isBib(p)).length;
  return html`<div class="mt-3 pt-3 border-t border-[#1a1714]">
    <button onClick=${() => setOpen(!open)}
      class="flex items-center gap-1 text-[12px] font-semibold text-slate-600 active:text-slate-900">
      ${open ? html`<${IconChevronDown} className="w-3.5 h-3.5" />` : html`<${IconChevronRight} className="w-3.5 h-3.5" />`}
      Where to try it (${places.length})
      ${starry > 0 && html`<span class="text-[9px] font-bold text-rose-700 ml-1">★ ${starry} starred/Bib</span>`}
    </button>
    ${open && html`<ul class="mt-2 space-y-3">
      ${places.map((p, i) => {
        const site = p.url || p.website || '';
        return html`<li key=${i} class="text-[12px] leading-snug">
          <div class="flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
            <span class="font-semibold text-slate-700">
              ${site
                ? html`<a href=${site} target="_blank" rel="noopener"
                    class="hover:text-fjord-700 hover:underline">${p.name}</a>`
                : p.name}
            </span>
            <${PlaceBadges} p=${p} />
            <${MapsLinks} parts=${[p.name, cityName]}
              linkClass="text-[11px] font-medium text-slate-500 hover:text-fjord-700" />
          </div>
          ${p.blurb && html`<div class="text-slate-500 mt-0.5">${p.blurb}</div>`}
          ${p.vibe && html`<div class="text-slate-400 mt-0.5"><span class="font-semibold text-slate-500">Vibe:</span> ${p.vibe}</div>`}
          ${p.mustTry && html`<div class="text-slate-400 mt-0.5"><span class="font-semibold text-slate-500">Must-try:</span> ${p.mustTry}</div>`}
        </li>`;
      })}
    </ul>`}
  </div>`;
}

// How long the leave animation runs before the modal actually unmounts.
const CLOSE_MS = 300;

// Floating modal: bottom sheet on mobile, centered card on sm+.
// item: the full catalog item object. stopName: city name for map links.
// onPatch (optional): patch the placed slot copy (used to rename dining items).
export function RecDetailModal({ item, stopName, onClose, onPatch }) {
  const { url: img } = useWikiImage(item, true);
  const desc = combineDesc(item);
  const heatWhy = heatReasonText(item);
  const appleUrl = appleMapsUrl(item.name, stopName);
  const googleUrl = googleMapsUrl(item.name, stopName);
  const [draft, setDraft] = useState('');
  const [closing, setClosing] = useState(false);
  const sheetRef = useRef(null);
  const closeTimer = useRef(null);
  // Keep the latest onClose handy for the native touch listeners below.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Play the leave animation, then unmount. Idempotent so backdrop + X + Esc
  // (or a tap during the exit) can't double-fire.
  function requestClose() {
    if (closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => onCloseRef.current(), CLOSE_MS);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // Swipe-down-to-dismiss (touch only): pulling down from the top of the sheet's
  // scroll drags it with the finger; past a threshold it flings closed, else it
  // springs back. Native listeners because React registers touchmove passively,
  // and we must preventDefault to keep the pull from scrolling the sheet.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return undefined;
    const scroller = sheet.querySelector('[data-rec-detail-scroll]') || sheet;
    let startY = 0;
    let dy = 0;
    let engaged = false;
    const onStart = (e) => {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      dy = 0;
      engaged = false;
    };
    const onMove = (e) => {
      if (closeTimer.current) return;
      const y = e.touches[0].clientY - startY;
      if (!engaged) {
        // Only grab the gesture when the sheet is already scrolled to its top
        // and the finger is moving down; otherwise keep re-anchoring so a
        // scroll-up-then-down doesn't jump.
        if (scroller.scrollTop > 0 || y <= 6) {
          if (y < 0) startY = e.touches[0].clientY;
          return;
        }
        engaged = true;
        sheet.style.transition = 'none';
      }
      dy = Math.max(0, y);
      e.preventDefault();
      sheet.style.transform = `translateY(${dy}px)`;
    };
    const onEnd = () => {
      if (!engaged) return;
      engaged = false;
      if (dy > 90) {
        // Continue the motion down and off-screen from wherever the finger let go.
        sheet.style.transition = 'transform 0.26s cubic-bezier(0.32, 0.72, 0, 1)';
        sheet.style.transform = 'translateY(110%)';
        if (!closeTimer.current) closeTimer.current = setTimeout(() => onCloseRef.current(), 240);
      } else {
        sheet.style.transition = 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)';
        sheet.style.transform = '';
      }
    };
    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);
    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // Dining items can be pinned to a specific restaurant — renaming the placed
  // copy and re-pinning the day map. pinByName marks it as a real place so the
  // map geocodes by name (not the generic dish/wiki).
  const canRename = !!onPatch && item.type === 'eat';
  const renamed = !!item.pinByName;
  function applyName(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const firstEdit = renamed ? {} : { origName: item.name, origWiki: item.wiki || '' };
    onPatch({ name: trimmed, pinByName: true, wiki: '', ...firstEdit });
    setDraft('');
  }
  function resetName() {
    onPatch({
      name: item.origName || 'Destination dining (book ahead)',
      wiki: item.origWiki || '',
      pinByName: false,
    });
    setDraft('');
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') requestClose(); }
    document.addEventListener('keydown', onKey);
    // Lock background scroll WITHOUT the page-width jump that hiding the
    // scrollbar would cause: pad the body by the scrollbar's width while locked.
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    document.body.style.overflow = 'hidden';
    if (sbw > 0) document.body.style.paddingRight = `${sbw}px`;
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
    };
  }, [onClose]);

  return createPortal(html`
    <div
      class="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4"
      onClick=${requestClose}>

      <!-- transparent click-catcher (no dim) -->
      <div class="absolute inset-0"></div>

      <!-- sheet / card: floats on a big drop shadow, no overlay. On mobile it
           rises from (and dismisses to) the true bottom edge of the screen. -->
      <div
        ref=${sheetRef}
        class="${closing ? 'rec-card-leave' : 'rec-card-enter'} rec-detail-sheet gg-sheet gg-rim border-[1.5px] border-[#1a1714] relative w-full sm:max-w-md rounded-t-[3px] rounded-b-none sm:rounded-[3px] overflow-hidden"
        onClick=${(e) => e.stopPropagation()}>

        <!-- Hero image -->
        <div class="relative w-full h-44 sm:h-52 bg-stone-100 overflow-hidden rounded-t-[2px] sm:rounded-t-[2px] shrink-0 border-b border-[#1a1714]">
          ${img
            ? html`<div class="thumb-img absolute inset-0 bg-cover bg-center" style=${{ backgroundImage: `url(${img})` }}></div>`
            : html`<div class="absolute inset-0 grid place-items-center text-slate-300"><${ItemGlyph} item=${item} className="w-16 h-16" /></div>`}
          <!-- X button always visible over image (swipe-down also dismisses on touch) -->
          <button
            onClick=${requestClose}
            aria-label="Close"
            class="absolute top-3 right-3 w-12 h-12 rounded-[2px] bg-white text-slate-700 shadow-md border-[1.5px] border-[#1a1714] flex items-center justify-center hover:bg-stone-50 transition">
            <${IconX} className="w-6 h-6" />
          </button>
        </div>

        <!-- Content — pad the bottom past the iOS home indicator so the last
             button is never tucked under it on the mobile bottom sheet. -->
        <div data-rec-detail-scroll class="rec-detail-scroll px-4 pt-3" style=${{ paddingBottom: 'max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))' }}>
          <!-- Name + emoji -->
          <div class="flex items-start gap-2">
            <span class="shrink-0 text-slate-500 mt-0.5"><${ItemGlyph} item=${item} className="w-6 h-6" /></span>
            <h2 class="font-display text-xl font-bold tracking-tight text-slate-800 leading-snug flex-1">${item.name}</h2>
          </div>

          <!-- Badges row -->
          <div class="flex items-center gap-2 flex-wrap mt-1.5">
            <${TierBadge} tier=${item.tier} />
            ${item.durationMin && html`<${DurationChip} min=${item.durationMin} />`}
            ${item.heatSensitive && html`<${HeatFlag} />`}
            <${ClosedFlag} item=${item} />
          </div>

          <!-- Tags -->
          ${item.tags && item.tags.length > 0 && html`
            <div class="mt-1.5"><${TagChips} tags=${item.tags} /></div>`}

          <!-- Restaurant picker (dining items) — sets the name + re-pins the map -->
          ${canRename && html`<div class="mt-3 rounded-[3px] border border-[1.5px] border-[#1a1714] bg-fjord-50 p-3">
            <div class="text-[12px] font-semibold text-slate-700 mb-1.5">
              ${renamed ? 'Your restaurant' : 'Pick your restaurant'}
              <span class="font-normal text-slate-400"> — sets the name & pins the map</span>
            </div>
            ${item.places && item.places.length > 0 && html`<div class="flex flex-wrap gap-1.5 mb-2">
              ${item.places.map((p, i) => {
                const stars = starCount(p);
                const selected = renamed && item.name === p.name;
                return html`<button key=${i} type="button" onClick=${() => applyName(p.name)}
                  data-active=${selected}
                  class="glass-chip inline-flex items-center gap-1">
                  ${p.name}
                  ${stars > 0 && html`<span class=${selected ? 'text-amber-600' : 'text-rose-600'}>${'★'.repeat(stars)}</span>`}
                  ${isBib(p) && html`<span class=${`text-[9px] font-bold uppercase ${selected ? 'text-emerald-700' : 'text-rose-600'}`}>Bib</span>`}
                </button>`;
              })}
            </div>`}
            <form onSubmit=${(e) => { e.preventDefault(); applyName(draft); }} class="flex items-center gap-1.5">
              <input value=${draft} onInput=${(e) => setDraft(e.target.value)}
                placeholder="…or type any restaurant" enterkeyhint="done"
                class="flex-1 min-w-0 text-[13px] px-2.5 py-1.5 rounded-[2px] border border-[1.5px] border-[#1a1714] bg-white outline-none focus:border-fjord-300" />
              <button type="submit" disabled=${!draft.trim()}
                class="shrink-0 text-[12px] font-semibold btn-ink rounded-[2px] px-3 py-1.5 transition disabled:opacity-40">Set</button>
            </form>
            ${renamed && html`<button onClick=${resetName}
              class="mt-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-600">Reset to a destination-dining pick</button>`}
          </div>`}

          <!-- Description -->
          ${desc && html`<p class="mt-2.5 text-sm text-slate-600 leading-relaxed">${desc}</p>`}

          <!-- Heat warning -->
          ${item.heatSensitive && heatWhy && html`
            <p class="mt-2 text-[12px] text-amber-700/90 leading-snug bg-amber-50 border border-[1.5px] border-[#1a1714] rounded-[2px] px-3 py-2">
              <span class="font-semibold">Morning recommended:</span> ${heatWhy}
            </p>`}

          <!-- Places list (food items) -->
          <${PlacesSection} places=${item.places} cityName=${stopName} />

          <!-- Notes (read-only) -->
          ${item.notes && item.notes.trim() && html`
            <div class="mt-3 pt-3 border-t border-[#1a1714] text-[12px] text-slate-500 leading-relaxed whitespace-pre-wrap">${item.notes.trim()}</div>`}

          <!-- Maps links (secondary): Apple + Google, side by side -->
          <div class="mt-3 flex gap-2">
            <a href=${appleUrl} target="_blank" rel="noopener" title="Open in Apple Maps"
              class="flex-1 flex items-center justify-center gap-2 py-2 rounded-[2px] border-[1.5px] border-[#1a1714] bg-white text-[13px] font-semibold text-slate-600 hover:bg-[#1a1714] hover:text-[#f4f3ee] transition">
              <${IconApple} className="map-apple-glyph" /> Maps
            </a>
            <a href=${googleUrl} target="_blank" rel="noopener" title="Open in Google Maps"
              class="flex-1 flex items-center justify-center gap-2 py-2 rounded-[2px] border-[1.5px] border-[#1a1714] bg-white text-[13px] font-semibold text-slate-600 hover:bg-[#1a1714] hover:text-[#f4f3ee] transition">
              <${IconGoogleG} className="map-google-glyph" /> Maps
            </a>
          </div>
        </div>
      </div>
    </div>`, document.body);
}

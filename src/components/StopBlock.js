import { html, useState, useEffect, useLayoutEffect, useRef, memo } from '../html.js';
import { useStore } from '../store/store.js';
import { useStopWeather } from './useWeather.js';
import { useWikiImage } from './useWikiImage.js';
import { WeatherChip } from './WeatherChip.js';
import { StopDetail } from './StopDetail.js';

// The expanded detail is a huge subtree (day planner, maps, rec lists). The
// card shell flips tiny visual states (wide, thumb) right as animations start;
// memoizing keeps those flips from re-rendering the whole mounted panel, which
// cost ~200ms and detached the width animation from the height.
const MemoStopDetail = memo(StopDetail);
import { ChangeCityModal } from './ChangeCityModal.js';
import { formatRangeCompact, nightsBetween, parseISO } from '../lib/dates.js';
import { nightsAdviceFor } from '../data/cityNights.js';
import { FlagGlyph } from './FlagGlyph.js';
import { confirmDialog } from '../lib/confirmDialog.js';
import { isStopPast } from '../store/selectors.js';
import { stopColor } from '../data/palette.js';
import {
  IconChevronDown, IconTrash, IconEdit, IconX, IconBed, IconWarning,
} from './icons.js';

// Ref-count so multiple expanded cards cannot fight over the merged-header flag.
let mergedStopHeadCount = 0;
function setMergedStopHead(active) {
  const root = document.documentElement;
  if (active) {
    mergedStopHeadCount += 1;
    root.setAttribute('data-merged-stop-head', '');
  } else {
    mergedStopHeadCount = Math.max(0, mergedStopHeadCount - 1);
    if (mergedStopHeadCount === 0) {
      root.removeAttribute('data-merged-stop-head');
      root.style.removeProperty('--stop-head-h');
    }
  }
}

function publishStopHeadHeight(head, merged) {
  const h = Math.round(head.getBoundingClientRect().height);
  const root = document.documentElement;
  if (merged) root.style.setProperty('--stop-head-h', `${h}px`);
  else if (!mergedStopHeadCount) root.style.removeProperty('--stop-head-h');
  return h;
}

function readAppBarHeight() {
  return parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--app-bar-h'),
  ) || 56;
}

// First see/do item that has a wiki thumbnail (same logic as map view).
function topImageItem(stop) {
  const all = [...(stop.recs?.see || []), ...(stop.recs?.do || [])];
  return all.find((it) => it.wiki || it.imageUrl) || null;
}

// Distinct booked hotel names across the stop's nights, in order. A multi-night
// stay can switch hotels, so we surface each one (not just the first).
function bookedHotels(stop) {
  const out = [];
  const seen = new Set();
  for (const day of (stop.days || [])) {
    const h = day.slots?.lodging;
    const name = h && h.name && h.name.trim();
    if (name && h.custom && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      out.push(name);
    }
  }
  return out;
}

function timelineDateLabel(startISO, endISO) {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  if (!start || !end) return { line1: '', line2: '', split: false };
  const startLabel = `${start.getMonth() + 1}/${start.getDate()}`;
  if (start.getMonth() === end.getMonth()) {
    return { line1: startLabel, line2: `–${end.getDate()}`, split: true };
  }
  return {
    line1: startLabel,
    line2: `–${end.getMonth() + 1}/${end.getDate()}`,
    split: true,
  };
}

// The width the card's content box reaches once expanded: it goes full-bleed to
// the browser's edges (see `.stop-fullbleed`), i.e. the viewport width minus the
// body's L/R safe-area padding. We pin the detail panel to this final width while
// the card animates wider, so the description text wraps once and never reflows
// mid-transition. Kept in sync with the `.stop-fullbleed` class on the card root.
function fullBleedTargetWidth() {
  if (typeof document === 'undefined') return null;
  const cs = getComputedStyle(document.body);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  // clientWidth excludes the scrollbar, so this is the true on-screen width.
  return document.documentElement.clientWidth - padL - padR;
}

const CARD_ANIM_MS = 400;
const OPEN_ANIM_MS = 440;
const CARD_ANIM_FALLBACK_MS = CARD_ANIM_MS + 80;
const OPEN_ANIM_FALLBACK_MS = OPEN_ANIM_MS + 80;
const IOS_EASE = 'var(--ease-ios)';
const REVEAL_EASE = 'var(--ease-reveal)';
// Snappier start for the card open so it doesn't feel sluggish to begin.
const OPEN_EASE = 'var(--ease-open)';
const THUMB_TRANSITION = `max-width ${CARD_ANIM_MS}ms ${IOS_EASE}, opacity ${CARD_ANIM_MS}ms ${IOS_EASE}, transform ${CARD_ANIM_MS}ms ${IOS_EASE}, border-radius ${CARD_ANIM_MS}ms ${IOS_EASE}`;
// Opening: get the thumbnail out of the way FAST — fade it in 140ms and close
// its width in 240ms (not the full open duration), so it's gone early instead of
// lingering, holding space, and showing the card background behind it mid-expand.
const THUMB_OPEN_TRANSITION = `max-width 240ms ${OPEN_EASE}, opacity 140ms ${OPEN_EASE}, transform 240ms ${OPEN_EASE}, border-radius 240ms ${OPEN_EASE}`;
const HOTEL_TRANSITION = `max-height ${CARD_ANIM_MS}ms ${IOS_EASE}, opacity ${CARD_ANIM_MS}ms ${IOS_EASE}, margin-top ${CARD_ANIM_MS}ms ${IOS_EASE}`;

function pinFullBleedMargins(el) {
  if (!el) return;
  // Bias by half the rail's right-only pad so the card reaches both viewport
  // edges (see `.stop-fullbleed`); these inline values override the CSS while
  // the card is expanded.
  el.style.marginLeft = 'calc(50% - 50vw + (var(--tl-rail-pad, 6px) / 2))';
  el.style.marginRight = 'calc(50% - 50vw - (var(--tl-rail-pad, 6px) / 2))';
  el.style.borderRadius = '0px';
}

function clearFullBleedMargins(el) {
  if (!el) return;
  el.style.marginLeft = '';
  el.style.marginRight = '';
  el.style.borderRadius = '';
}

export function StopBlock({ stop, index, dnd }) {
  const { dispatch, isStopCollapsed, toggleStopCollapse } = useStore();
  const wx = useStopWeather(stop);
  const [editingDates, setEditingDates] = useState(false);
  const [changingCity, setChangingCity] = useState(false);
  const [insert, setInsert] = useState(null);
  const dragging = dnd && dnd.dragId === stop.id;
  const nights = nightsBetween(stop.startDate, stop.endDate);
  const stayAdvice = nightsAdviceFor(stop.cityId, nights);
  const expanded = !isStopCollapsed(stop.id);
  const past = isStopPast(stop);
  const color = stopColor(index);
  const dateRange = formatRangeCompact(stop.startDate, stop.endDate);
  const dateLabel = timelineDateLabel(stop.startDate, stop.endDate);
  const timelineDateRange = dateLabel.split ? `${dateLabel.line1} ${dateLabel.line2}` : dateLabel.line1;

  // Thumbnail: prefer top see/do item image, fall back to city name wiki lookup.
  const imageItem = topImageItem(stop) || { wiki: stop.name };
  const { url: img } = useWikiImage(imageItem, true);
  const hotels = bookedHotels(stop);

  const [showDetail, setShowDetail] = useState(expanded);
  const [animDone, setAnimDone] = useState(true);
  // Visual open/close state for the card chrome (full-bleed margins, header
  // paddings, chevron). It flips one frame AFTER the detail content mounts and
  // lays out, so the widening + height growth start together with clean frames
  // instead of losing their fast phase to the mount's layout cost.
  const [wide, setWide] = useState(expanded);
  // Thumbnail width + visibility animate in lockstep with the panel height and
  // the card's full-bleed margins (same 400ms iOS curve), so open and close
  // each read as one coordinated motion.
  const [thumbWide, setThumbWide] = useState(!expanded);
  const [thumbShown, setThumbShown] = useState(!expanded);
  // True while the panel is collapsing — header stays wide on one clock.
  const [closing, setClosing] = useState(false);
  // True while the panel is growing — header/thumb flip before the height rAF.
  const [opening, setOpening] = useState(false);
  // True once the expanded card's header is pinned beneath the app's top bar.
  const [headStuck, setHeadStuck] = useState(false);
  // Merge chrome only when the header row is physically at its sticky position
  // (not merely when the card top has crossed the app bar on expand-scroll).
  const [headPinned, setHeadPinned] = useState(false);

  // The clip box whose pixel height we animate, and the natural-height content
  // inside it. Measuring `inner` and animating `wrap`'s height (rather than
  // grid-template-rows) lays the panel out once and only clips per frame —
  // that's what holds 60fps on iOS Safari.
  const wrapRef = useRef(null);
  const innerRef = useRef(null);
  // A zero-height marker just above the sticky header: when it scrolls up past
  // the app bar, the header is pinned (drives the shelf shadow).
  const headSentinelRef = useRef(null);
  // The sticky header row itself — measured so the desktop "Day by day" sidebar
  // can pin just below it (via the scoped `--stop-head-h` var) instead of behind.
  const headRowRef = useRef(null);
  const ownsMergeRef = useRef(false);
  // Pending rAFs / timers / listeners to cancel if the toggle is interrupted.
  const pending = useRef([]);
  const clearPending = () => { pending.current.forEach((c) => c()); pending.current = []; };

  // Sticky sentinel + merge only when fully open — not during open/close motion
  // (sticky + collapsing height leaves a gray gap from the card press tint).
  const chromeOpen = wide && animDone;
  // Header paddings + action buttons stay wide for the full open/close motion.
  const headerWide = wide || closing || opening;
  // Hotel line eases in on the same beat as the panel collapses (not after).
  const hotelsRevealed = hotels.length > 0 && !wide && (!showDetail || closing);

  // Only animate when `expanded` actually changes. On first mount (e.g. switching
  // INTO timeline view) the states are already correct, so we just set the static
  // height and skip the open/close sequence.
  const firstRun = useRef(true);
  useLayoutEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (wrapRef.current) wrapRef.current.style.height = expanded ? 'auto' : '0px';
      return;
    }
    clearPending();
    const onceOnHeightEnd = (w, fn, fallbackMs = CARD_ANIM_FALLBACK_MS) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        w.removeEventListener('transitionend', onEnd);
        fn();
      };
      const onEnd = (e) => { if (e.target === w && e.propertyName === 'height') finish(); };
      w.addEventListener('transitionend', onEnd);
      const timer = setTimeout(finish, fallbackMs);
      pending.current.push(() => { w.removeEventListener('transitionend', onEnd); clearTimeout(timer); });
    };

    if (expanded) {
      setClosing(false);
      setOpening(true);
      setAnimDone(false);
      setShowDetail(true);
      setThumbShown(false);
      setThumbWide(false);
      const grow = () => {
        const w = wrapRef.current; const inner = innerRef.current;
        if (!w || !inner) {
          const r = requestAnimationFrame(grow);
          pending.current.push(() => cancelAnimationFrame(r));
          return;
        }
        inner.style.width = `${fullBleedTargetWidth() || w.offsetWidth}px`;
        w.style.height = '0px';
        const cardEl = document.getElementById(`stop-${stop.id}`);
        if (cardEl) pinFullBleedMargins(cardEl);
        setWide(true);
        void w.offsetHeight;
        // Open with the SAME smooth iOS curve as the close (was --ease-open,
        // a snappier ease-out that made the expand feel fast/janky next to the
        // close). Matching eases makes open and close read as one motion.
        w.style.transition = `height ${OPEN_ANIM_MS}ms ${IOS_EASE}`;
        // Let React commit the full-bleed class changes AND lay out the freshly
        // mounted detail subtree (one extra frame) BEFORE the height transition
        // starts, so the open doesn't stutter on that first reflow. Re-measure in
        // the second frame for an accurate, settled target height.
        const r = requestAnimationFrame(() => {
          const r2 = requestAnimationFrame(() => {
            if (wrapRef.current && innerRef.current) {
              wrapRef.current.style.height = `${innerRef.current.offsetHeight}px`;
            }
          });
          pending.current.push(() => cancelAnimationFrame(r2));
        });
        pending.current.push(() => cancelAnimationFrame(r));
        onceOnHeightEnd(w, () => {
          w.style.height = 'auto'; w.style.transition = ''; inner.style.width = '';
          setAnimDone(true);
          clearFullBleedMargins(document.getElementById(`stop-${stop.id}`));
          requestAnimationFrame(() => setOpening(false));
        }, OPEN_ANIM_FALLBACK_MS);
      };
      const r0 = requestAnimationFrame(grow);
      pending.current.push(() => cancelAnimationFrame(r0));
    } else {
      setOpening(false);
      setAnimDone(false);
      setClosing(true);
      setThumbWide(true);
      setThumbShown(true);
      const w = wrapRef.current;
      const inner = innerRef.current;
      const cardEl = document.getElementById(`stop-${stop.id}`);
      const closeDone = () => {
        if (inner) inner.style.width = '';
        setShowDetail(false);
        setAnimDone(true);
        // One frame after the panel hits zero before header chrome compresses.
        requestAnimationFrame(() => setClosing(false));
      };
      if (!w) {
        setWide(false);
        clearFullBleedMargins(cardEl);
        closeDone();
        return;
      }
      // Hold full-bleed geometry inline, then drop the class — same trick as open.
      if (cardEl && wide) pinFullBleedMargins(cardEl);
      setWide(false);
      w.style.transition = '';
      if (inner) inner.style.width = `${inner.offsetWidth}px`;
      w.style.height = `${w.offsetHeight}px`;
      void w.offsetHeight;
      const r = requestAnimationFrame(() => {
        clearFullBleedMargins(cardEl);
        w.style.height = '0px';
      });
      pending.current.push(() => cancelAnimationFrame(r));
      onceOnHeightEnd(w, closeDone);
    }
    return () => clearPending();
  }, [expanded]);

  // Pin detection only while fully open and settled.
  useEffect(() => {
    if (!showDetail || !chromeOpen) {
      setHeadStuck(false);
      setHeadPinned(false);
      return undefined;
    }
    const sentinel = headSentinelRef.current;
    const head = headRowRef.current;
    if (!sentinel || !head || typeof IntersectionObserver === 'undefined') return undefined;

    const update = () => {
      const barH = readAppBarHeight();
      const sentinelRect = sentinel.getBoundingClientRect();
      const headTop = head.getBoundingClientRect().top;
      const pastBar = sentinelRect.bottom <= barH + 1;
      const atPin = headTop <= barH + 2 && headTop >= barH - 12;
      setHeadStuck(pastBar);
      setHeadPinned(pastBar && atPin);
    };

    const io = new IntersectionObserver(() => update(), {
      rootMargin: `-${Math.round(readAppBarHeight()) + 1}px 0px 0px 0px`,
      threshold: 0,
    });
    io.observe(sentinel);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [showDetail, chromeOpen]);

  // Publish header height for merged glass + desktop day-by-day sidebar pin.
  useEffect(() => {
    if (!showDetail || !chromeOpen) return undefined;
    const head = headRowRef.current;
    const card = document.getElementById(`stop-${stop.id}`);
    if (!head || !card || typeof ResizeObserver === 'undefined') return undefined;
    const apply = () => {
      const merged = headStuck && wide;
      const h = publishStopHeadHeight(head, merged);
      card.style.setProperty('--stop-head-h', `${h}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(head);
    return () => ro.disconnect();
  }, [showDetail, headStuck, wide, chromeOpen, stop.id]);

  // When the expanded header pins under the app bar, merge both into one glass
  // pane (CSS reads `html[data-merged-stop-head]` + `.is-merged` on the head).
  useLayoutEffect(() => {
    const want = headStuck && wide && animDone;
    if (want && !ownsMergeRef.current) {
      ownsMergeRef.current = true;
      setMergedStopHead(true);
    } else if (!want && ownsMergeRef.current) {
      ownsMergeRef.current = false;
      setMergedStopHead(false);
    }
    return () => {
      if (ownsMergeRef.current) {
        ownsMergeRef.current = false;
        setMergedStopHead(false);
      }
    };
  }, [headStuck, wide, animDone]);

  function setDates(field, value) {
    const start = field === 'start' ? value : stop.startDate;
    const end = field === 'end' ? value : stop.endDate;
    if (nightsBetween(start, end) < 1) return;
    dispatch({ type: 'SET_STOP_DATES', stopId: stop.id, startDate: start, endDate: end });
  }

  // Toggle + reveal: opening a card mid-screen grows it below the fold, so
  // ease its header up under the sticky bar in the same beat as the expand —
  // you watch the content arrive instead of guessing it appeared.
  function toggleCard() {
    const opening = !expanded;
    toggleStopCollapse(stop.id);
    if (!opening) return;
    requestAnimationFrame(() => {
      const card = document.getElementById(`stop-${stop.id}`);
      if (!card) return;
      const bar = document.querySelector('.app-top-bar');
      const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
      const delta = card.getBoundingClientRect().top - barBottom - 10;
      if (delta > 8) window.scrollBy({ top: delta, behavior: 'smooth' });
    });
  }

  function onHandleDragStart(e) {
    if (!dnd) return;
    dnd.onStart(stop.id, e);
  }
  function onCardDragOver(e) {
    if (!dnd || !dnd.dragId || dnd.dragId === stop.id) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setInsert((e.clientY - r.top) < r.height / 2 ? 'before' : 'after');
    dnd.onOver(stop.id);
  }
  function onCardDragLeave(e) {
    if (!dnd) return;
    if (!e.currentTarget.contains(e.relatedTarget)) { setInsert(null); dnd.onLeave(stop.id); }
  }
  function onCardDrop(e) {
    if (!dnd || !dnd.dragId || dnd.dragId === stop.id) { setInsert(null); return; }
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const after = (e.clientY - r.top) >= r.height / 2;
    dnd.onDrop(stop.id, after);
    setInsert(null);
  }

  return html`
    <div class="tl-row">
      <!-- Col 1 — date range, click to edit the stop's dates. -->
      <button type="button" onClick=${(e) => { e.stopPropagation(); setEditingDates(!editingDates); }}
        title=${`Edit dates: ${dateRange}`} aria-label=${`Dates: ${timelineDateRange}`}
        class="tl-date inset-y-0 flex flex-col justify-center items-end text-right leading-tight uppercase tracking-wide text-[11px] font-semibold text-slate-500 hover:text-fjord-600 tnum">
        <span>${dateLabel.line1}</span>
        ${dateLabel.split && html`<span>${dateLabel.line2}</span>`}
      </button>
      <!-- Col 2 — continuous spine. -->
      <div class="tl-spine" aria-hidden="true">
        <div class="tl-spine-line"></div>
      </div>
    <div id=${`stop-${stop.id}`}
      onDragOver=${onCardDragOver} onDragLeave=${onCardDragLeave} onDrop=${onCardDrop}
      class=${`relative ${!wide ? 'isolate' : ''} bg-white border border-[1.5px] border-[#1a1714] stop-card-interactive ${!animDone || closing || opening ? 'stop-card-animating' : ''} ${opening ? 'stop-card-opening' : ''} ${wide && animDone ? 'overflow-visible' : 'overflow-hidden'} ${wide ? 'stop-fullbleed rounded-none' : `tl-content rounded-[3px]${animDone && !closing && !opening ? ' hover:shadow-[6px_6px_0_0_#1a1714]' : ''}`} ${past ? 'opacity-55 saturate-50 hover:opacity-100 hover:saturate-100' : ''} ${dragging ? 'opacity-40' : ''}`}>
      ${img && !showDetail && html`<div class="stop-ambient" aria-hidden="true" style=${{ backgroundImage: `url(${img})` }}></div>`}
      ${img && !showDetail && html`<div class="stop-frost" aria-hidden="true"></div>`}
      ${insert === 'before' && html`<div class="absolute top-0 left-0 right-0 h-1 bg-[#1a1714] z-20"></div>`}
      ${insert === 'after' && html`<div class="absolute bottom-0 left-0 right-0 h-1 bg-[#1a1714] z-20"></div>`}

      <!-- Stuck sentinel: in-flow line directly above the sticky header row. -->
      ${chromeOpen && html`<div ref=${headSentinelRef} aria-hidden="true" class="h-px w-full shrink-0 pointer-events-none"></div>`}

      <div ref=${headRowRef} class=${`flex items-stretch ${chromeOpen ? `stop-sticky-head ${headStuck ? 'is-merged is-stuck' : 'bg-white'}` : ''}`}>
        <!-- City thumbnail: always in DOM, animates in/out with expand state -->
        <div
          draggable=${!!dnd && !wide}
          onDragStart=${onHandleDragStart}
          onDragEnd=${() => { setInsert(null); dnd && dnd.onEnd(); }}
          onClick=${toggleCard}
          class=${`timeline-thumb relative shrink-0 w-20 sm:w-24 self-stretch overflow-hidden ${wide ? 'pointer-events-none' : dnd ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
          style=${{
            maxWidth: thumbWide ? '10rem' : '0',
            opacity: thumbShown ? 1 : 0,
            transform: thumbShown ? 'scale(1)' : 'scale(1.02)',
            willChange: 'max-width, opacity, transform',
            transition: opening ? THUMB_OPEN_TRANSITION : THUMB_TRANSITION,
          }}
          title="Open city">
          <!-- Color fill is the always-present base; the image eases in on top
               once it resolves, so the swap is a soft fade, never a hard pop. -->
          <div class="absolute inset-0 ${color.chip} opacity-90"></div>
          ${img && html`<div class="timeline-thumb-img absolute inset-0 bg-cover bg-center transition-transform duration-500 hover:scale-105"
                style=${{ backgroundImage: `url(${img})` }}></div>`}
          <span class=${`thumb-index ${color.chip}`} aria-hidden="true">${index + 1}</span>
          <!-- Tap-feedback dimmer: reacts to stop-card-interactive hover/active on the outer card -->
          <div class="thumb-tap-overlay absolute inset-0"></div>
        </div>

        <div class="flex-1 min-w-0 flex flex-col">
          <div class=${`stop-head-band flex items-center ${headerWide ? 'is-wide' : ''} ${(wide || opening) ? 'is-bleed' : ''}`}>
            <!-- Main info -->
            <div
              draggable=${!!dnd && showDetail}
              onDragStart=${onHandleDragStart}
              onDragEnd=${() => { setInsert(null); dnd && dnd.onEnd(); }}
              onClick=${toggleCard}
              class=${`flex-1 min-w-0 ${dnd && showDetail ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
              title=${headerWide ? 'Collapse' : 'Open city'}>

              <!-- Collapsed cards are full-bleed wide on desktop, so lay the
                   header out as a balanced row: city name on the left, stay
                   stats pinned right — no more empty gap before the chevron.
                   Driven by the viewport breakpoint (not the expand state) so
                   the open/close animation never reflows. Stacks on mobile. -->
              <div class="stop-head-grid">
                <div class="shg-name min-w-0">
                  ${headerWide
                    ? html`<button class="shg-city font-display font-bold tracking-tight text-[1.35rem] sm:text-2xl text-slate-900 hover:text-fjord-700 hover:underline leading-tight min-w-0"
                        onClick=${(e) => { e.stopPropagation(); setChangingCity(true); }} title="Change city">${stop.name}</button>`
                    : html`<span class="shg-city font-display font-bold tracking-tight text-[1.35rem] sm:text-2xl text-slate-900 leading-tight min-w-0">${stop.name}</span>`}
                  ${stop.country && html`<span class="shg-country shrink-0 inline-flex items-center gap-1 uppercase tracking-wide text-[10px] sm:text-[11px] font-semibold text-slate-500 whitespace-nowrap"><span>${stop.country}</span><${FlagGlyph} country=${stop.country} className="w-[0.85rem] h-[0.64rem] sm:w-[0.95rem] sm:h-[0.71rem]" /></span>`}
                </div>

                <div class="shg-stats mt-1 sm:mt-0">
                  <div class="flex items-center gap-x-2 gap-y-0.5 text-xs text-slate-800 font-medium flex-wrap sm:justify-end">
                    <span class="uppercase tracking-wide text-[11px] font-semibold whitespace-nowrap"><span class="tnum font-bold">${nights}</span> ${nights === 1 ? 'night' : 'nights'}</span>
                    ${wx.summary && html`<span class="shrink-0 inline-flex items-center"><${WeatherChip} data=${wx.summary} loading=${wx.loading} pill=${false} /></span>`}
                    ${stayAdvice && html`<span
                      class=${`gg-chip gg-chip-sm shrink-0 inline-flex items-center gap-1 ${stayAdvice.level === 'short' ? 'text-amber-700' : 'text-rose-700'}`}
                      title=${stayAdvice.message}>
                      <${IconWarning} className="w-3 h-3 shrink-0" /> ${stayAdvice.level === 'short' ? `${stayAdvice.min}+ nights` : `${stayAdvice.min}–${stayAdvice.max} max`}
                    </span>`}
                    ${past && html`<span class="shrink-0 whitespace-nowrap inline-flex items-center px-1 py-px rounded-[2px] bg-[#1a1714] text-[#f4f3ee] text-[10px] font-semibold uppercase tracking-wide">Past</span>`}
                  </div>
                </div>

                <!-- Booked hotel: always in DOM when present; height/opacity animate
                     in sync with the panel so the card doesn't grow after close. -->
                ${hotels.length > 0 && html`
                  <div
                    class="shg-hotel min-w-0 flex items-start gap-1 text-[11px] text-slate-800 overflow-hidden"
                    style=${{
                      maxHeight: hotelsRevealed ? '2.75rem' : '0px',
                      opacity: hotelsRevealed ? 1 : 0,
                      marginTop: hotelsRevealed ? '0.25rem' : '0px',
                      transition: HOTEL_TRANSITION,
                    }}>
                    <${IconBed} className="w-3.5 h-3.5 shrink-0 text-slate-400 mt-px" />
                    <span class="min-w-0 leading-snug line-clamp-2">${hotels.join(' · ')}</span>
                  </div>`}
              </div>
            </div>

            <!-- Right actions: pencil + trash only when expanded; always show chevron.
                 Weather lives on the line under the city now, so the city headline
                 gets the full width instead of competing with a pill. -->
            <div class=${`stop-head-actions shrink-0 text-slate-300 ${headerWide ? 'is-wide' : ''}`}>
              <div class=${`stop-head-actions__tools flex items-center overflow-hidden ${(wide || opening) ? 'is-wide' : ''}`}>
                <button onClick=${(e) => { e.stopPropagation(); setChangingCity(true); }} title="Change city"
                  class="p-1.5 rounded-[2px] hover:bg-[#1a1714] hover:text-[#f4f3ee] transition-colors">
                  <${IconEdit} className="w-4 h-4" /></button>
                <button onClick=${async () => { if (await confirmDialog({ title: `Remove ${stop.name}?`, message: 'This removes the stop and everything planned there.', confirmLabel: 'Remove', tone: 'destructive' })) dispatch({ type: 'REMOVE_STOP', stopId: stop.id }); }}
                  class="p-1.5 rounded-[2px] hover:bg-rose-600 hover:text-white transition-colors" title="Remove stop">
                  <${IconTrash} className="w-4 h-4" /></button>
              </div>
              <button onClick=${toggleCard}
                class="p-1 rounded-[2px] text-slate-400 hover:text-slate-900 transition-colors"
                title=${headerWide ? 'Collapse' : 'Expand'}>
                <${IconChevronDown} className="stop-chevron w-5 h-5" />
              </button>
            </div>
          </div>

          ${editingDates && html`
            <div class="px-3 sm:px-4 pb-3 -mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 animate-fade-in">
              <label class="flex items-center gap-1.5">Arrive
                <input type="date" value=${stop.startDate}
                  onChange=${(e) => e.target.value && setDates('start', e.target.value)}
                  class="border border-[1.5px] border-[#1a1714] rounded-[2px] px-2 py-1 text-slate-700" />
              </label>
              <label class="flex items-center gap-1.5">Depart
                <input type="date" value=${stop.endDate}
                  onChange=${(e) => e.target.value && setDates('end', e.target.value)}
                  class="border border-[1.5px] border-[#1a1714] rounded-[2px] px-2 py-1 text-slate-700" />
              </label>
              <span class="text-slate-400">Following stops shift to stay back-to-back.</span>
              <button type="button" onClick=${() => setEditingDates(false)}
                title="Save and close" aria-label="Save and close"
                class="ml-auto p-1.5 rounded-[2px] text-slate-400 hover:text-slate-900 hover:bg-stone-100 transition-colors">
                <${IconX} className="w-4 h-4" />
              </button>
            </div>`}

        </div>
      </div>

      <!-- Expanded detail lives OUTSIDE the items-stretch row so the city
           thumbnail's self-stretch height tracks only the header, never the
           growing detail panel (which would visibly stretch the image). -->
      ${showDetail && html`<div ref=${wrapRef} class=${`detail-clip ${animDone ? 'is-open' : ''}`}>
        <div ref=${innerRef}>
          <${MemoStopDetail} stop=${stop} weather=${wx} />
        </div>
      </div>`}

      ${changingCity && html`<${ChangeCityModal} stop=${stop} onClose=${() => setChangingCity(false)} />`}
    </div>
    </div>`;
}

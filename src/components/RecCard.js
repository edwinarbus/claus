import { html, useState, useRef, useEffect } from '../html.js';
import { useStore } from '../store/store.js';
import { isItemPlanned } from '../store/selectors.js';
import { useWikiImage } from './useWikiImage.js';
import { ItemGlyph } from './ItemGlyph.js';
import { TagChips, HeatFlag, TierBadge, DurationChip, ClosedFlag, heatReasonText } from './ItemBits.js';
import { NotesLinksView, NotesLinksEditor } from './NotesLinks.js';
import { AssignMenu } from './AssignMenu.js';
import { MapsLinks } from './MapsLinks.js';
import { startDrag, endDrag, setTiltDragImage } from './dnd.js';
import { TAG_META } from '../data/slots.js';
import { IconPlus, IconEdit, IconTrash, IconExternal, IconChevronDown, IconChevronRight, IconCheck } from './icons.js';

const ALL_TAGS = ['food', 'nature', 'culture', 'landmark'];
// Matches RecPanel's 2xl two-column grid — wide enough to show full rec text.
const RECS_WIDE_MQ = '(min-width: 1536px)';

function useRecsWide() {
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(RECS_WIDE_MQ).matches);
  useEffect(() => {
    const mq = window.matchMedia(RECS_WIDE_MQ);
    const fn = () => setWide(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return wide;
}

// A Wikipedia article only counts if it's a *dedicated* page for the sight — a
// wiki that's just the city's own article (e.g. "Bergen", "Malmö, Sweden") is
// not, so we skip it rather than link to the general city.
function dedicatedWikiUrl(item, stop) {
  const w = (item.wiki || '').trim();
  if (!w) return '';
  const wl = w.toLowerCase();
  const names = [stop && stop.name, stop && stop.cityId]
    .filter(Boolean).map((s) => String(s).toLowerCase());
  if (names.some((n) => wl === n || wl.startsWith(`${n},`))) return '';
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(w)}`;
}

// External reference for a sight: prefer its official site; otherwise a dedicated
// Wikipedia article. No city-level fallback — a plain name beats a generic link.
function sourceFor(item, stop) {
  if (item.sourceUrl) return item.sourceUrl;
  return dedicatedWikiUrl(item, stop);
}

// Best "official website" to hang the title link on: prefer an explicit
// http(s) sourceUrl, else the first place that carries a website/url. No
// Wikipedia fallback here — a plain title beats a non-official link.
function titleUrl(item) {
  if (item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl)) return item.sourceUrl;
  const place = (item.places || []).find((p) => p && (p.url || p.website));
  return place ? (place.url || place.website) : '';
}

// One description instead of two: fold the "why" hook into the blurb so the card
// shows a single, fuller sentence.
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
function isBib(p) {
  return p.bib === true || p.michelin === 'bib';
}

function PlaceBadges({ p }) {
  const stars = starCount(p);
  const bib = isBib(p);
  const price = priceStr(p.price);
  if (!stars && !bib && !price && !p.cuisine) return null;
  return html`<span class="inline-flex items-center gap-1.5 flex-wrap align-middle ml-1">
    ${stars > 0 && html`<span class="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-700"
      title=${`${stars} Michelin ${stars === 1 ? 'star' : 'stars'}`}>${'★'.repeat(stars)}</span>`}
    ${bib && html`<span class="inline-flex items-center text-[9px] font-bold uppercase tracking-wide text-rose-700 border border-[1.5px] border-rose-300 rounded-[2px] px-1 py-px"
      title="Michelin Bib Gourmand">Bib</span>`}
    ${price && html`<span class="text-[10px] font-semibold text-emerald-700" title="Price level">${price}</span>`}
    ${p.cuisine && html`<span class="text-[10px] text-slate-400">${p.cuisine}</span>`}
  </span>`;
}

function PlacesList({ places, cityName }) {
  const [open, setOpen] = useState(false);
  if (!places || !places.length) return null;
  const starry = places.filter((p) => starCount(p) > 0 || isBib(p)).length;
  return html`<div class="mt-2 pt-2 border-t border-stone-100">
    <button onClick=${() => setOpen(!open)}
      class="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900">
      ${open ? html`<${IconChevronDown} className="w-3.5 h-3.5" />` : html`<${IconChevronRight} className="w-3.5 h-3.5" />`}
      Where to try it (${places.length})
      ${starry > 0 && html`<span class="text-[9px] font-bold text-rose-700">★ ${starry} starred/Bib</span>`}
    </button>
    ${open && html`<ul class="mt-1.5 space-y-2.5 animate-fade-in">
      ${places.map((p, i) => {
        const site = p.url || p.website || '';
        return html`<li key=${i} class="text-[11px] leading-snug">
          <div class="flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
            <span class="font-semibold text-slate-700">
              ${site
                ? html`<a href=${site} target="_blank" rel="noopener"
                    class="hover:text-fjord-700 hover:underline decoration-fjord-300 underline-offset-2">${p.name}</a>`
                : p.name}
            </span>
            <${PlaceBadges} p=${p} />
            <${MapsLinks} parts=${[p.name, cityName]}
              linkClass="text-[10px] font-semibold text-slate-500 hover:text-fjord-700 hover:underline" />
          </div>
          ${p.blurb && html`<div class="text-slate-500">${p.blurb}</div>`}
          ${p.vibe && html`<div class="text-slate-400 mt-0.5">
            <span class="font-semibold text-slate-500">Vibe:</span> ${p.vibe}</div>`}
          ${p.mustTry && html`<div class="text-slate-400 mt-0.5">
            <span class="font-semibold text-slate-500">Must-try:</span> ${p.mustTry}</div>`}
        </li>`;
      })}
    </ul>`}
  </div>`;
}

export function RecCard({ stop, bucket, item, avoidHeatPM, onDragState }) {
  const { dispatch } = useStore();
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef(null);
  const [imgEnabled, setImgEnabled] = useState(false);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setImgEnabled(true); return undefined; }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setImgEnabled(true); io.disconnect(); }
    }, { rootMargin: '160px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const { url: img, loading: imgLoading } = useWikiImage(item, imgEnabled);
  const src = sourceFor(item, stop);
  const website = titleUrl(item);
  const desc = combineDesc(item);
  const heatWhy = heatReasonText(item);
  // A sight/activity can only go in the plan once; dining can repeat (you eat
  // every day). EVERY planned item gets the recessed planned look + ✓ chip the
  // moment it lands in a day; only non-reusable ones additionally lock
  // (no dragging, no "Plan" button).
  const isAdded = isItemPlanned(stop, item);
  const wide = useRecsWide();
  const compact = isAdded && !wide;
  const compactClosed = compact && !expanded && !editing;
  const reusable = bucket === 'eat';
  const lockPlanned = !reusable && isAdded;

  const patch = (p) => dispatch({ type: 'UPDATE_ITEM', stopId: stop.id, bucket, itemId: item.id, patch: p });
  // Opening the editor folds the two legacy fields into a single description.
  function openEdit() {
    if (item.why) patch({ blurb: combineDesc(item), why: '' });
    setEditing(true);
  }
  const toggleTag = (t) => {
    const tags = item.tags.includes(t) ? item.tags.filter((x) => x !== t) : [...item.tags, t];
    patch({ tags });
  };

  function onDragStart(e) {
    startDrag(item, { type: 'rec', stopId: stop.id, bucket, itemId: item.id });
    e.dataTransfer.effectAllowed = 'copyMove';
    try { e.dataTransfer.setData('text/plain', item.name); } catch { /* ignore */ }
    setTiltDragImage(e, e.currentTarget);
    setDragging(true);
    onDragState && onDragState(item);
  }
  function onDragEnd() { endDrag(); setDragging(false); onDragState && onDragState(null); }

  return html`
    <div ref=${cardRef} draggable=${!editing && item.type !== 'lodging' && !lockPlanned}
      onDragStart=${onDragStart} onDragEnd=${onDragEnd}
      class="card card-hover group ${dragging ? 'is-dragging' : ''} ${isAdded ? 'rec-planned' : ''} ${editing || lockPlanned ? '' : 'cursor-grab active:cursor-grabbing'}">

      <div class="flex gap-3 p-2.5">
        <div class="relative shrink-0 w-20 h-20 rounded-[2px] overflow-hidden bg-stone-100 border border-[1.5px] border-[#1a1714]">
          ${img
            ? html`<div key=${img} class="img-fade-in h-full w-full bg-cover bg-center transition-transform duration-500 ease-out ${isAdded ? '' : 'group-hover:scale-110'}" style=${{ backgroundImage: `url(${img})` }}></div>`
            : imgLoading
              ? html`<div class="img-skeleton h-full w-full"></div>`
              : html`<div class="h-full w-full grid place-items-center text-slate-300 bg-stone-50 transition-transform duration-500 ease-out ${isAdded ? '' : 'group-hover:scale-110'}"><${ItemGlyph} item=${item} className="w-7 h-7" /></div>`}
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-start gap-1.5">
            <div class="flex-1 min-w-0 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
              <h5 class="font-semibold text-[0.95rem] text-slate-800 leading-tight">
                ${website
                  ? html`<a href=${website} target="_blank" rel="noopener" draggable=${false}
                      onClick=${(e) => e.stopPropagation()}
                      class="hover:text-fjord-700 hover:underline decoration-fjord-300 underline-offset-2">${item.name}</a>`
                  : item.name}
              </h5>
              <${MapsLinks} parts=${[item.name, stop.name]} stop=${true}
                linkClass="text-[10px] font-semibold text-slate-500 hover:text-fjord-700 hover:underline" />
            </div>
            <div class="flex items-center gap-0.5 shrink-0 ${editing ? '' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'} transition">
              ${!lockPlanned && html`<button onClick=${() => setAssigning(!assigning)} title="Add to a day" aria-label="Add to day"
                class="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-[2px] text-fjord-600 hover:bg-fjord-50 transition-transform duration-150 active:scale-90">
                <${IconPlus} className=${`w-4 h-4 transition-transform duration-200 ${assigning ? 'rotate-45' : ''}`} />
                <span class="text-[10px] font-semibold sm:hidden">Plan</span>
              </button>`}
              <button onClick=${() => (editing ? setEditing(false) : openEdit())} title="Edit"
                class="p-1 rounded-[2px] text-slate-400 hover:bg-stone-100"><${IconEdit} className="w-4 h-4" /></button>
              <button onClick=${() => dispatch({ type: 'DELETE_ITEM', stopId: stop.id, bucket, itemId: item.id })} title="Delete"
                class="p-1 rounded-[2px] text-slate-400 hover:bg-rose-50 hover:text-rose-500"><${IconTrash} className="w-4 h-4" /></button>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap mt-1">
            <${TierBadge} tier=${item.tier} />
            ${item.durationMin && html`<${DurationChip} min=${item.durationMin} />`}
            ${item.heatSensitive && html`<${HeatFlag} emphasized=${avoidHeatPM} reason=${heatWhy} />`}
            <${ClosedFlag} item=${item} />
            ${isAdded && html`<span class="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--accent-deep)] bg-[var(--accent-soft)] border border-[var(--line)] rounded-full px-1.5 py-0.5"><${IconCheck} className="w-3 h-3" /> Planned</span>`}
            ${item.custom && html`<span class="badge uppercase">${item.addedBy ? `added by ${item.addedBy}` : 'custom'}</span>`}
          </div>
          ${compact && !editing && html`<button onClick=${() => setExpanded(!expanded)}
            aria-expanded=${expanded} aria-label=${expanded ? 'Hide details' : 'Show details'}
            class="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-fjord-600 hover:text-fjord-800 transition-colors">
            ${expanded
              ? html`<${IconChevronDown} className="w-3 h-3" />`
              : html`<${IconChevronRight} className="w-3 h-3" />`}
            ${expanded ? 'Read less' : 'Read more'}
          </button>`}
        </div>
      </div>

      <div class=${`px-2.5 ${compactClosed ? 'pb-1.5 -mt-1' : 'pb-2.5 -mt-0.5'}`}>

        ${!editing && html`<div class=${compact ? `collapsible ${expanded ? 'collapsible-open' : 'collapsible-closed'}` : ''}>
          <div class=${compact ? 'collapsible-inner' : ''}>
            ${desc && html`<p class="text-xs text-slate-500 leading-relaxed mt-1.5">${desc}</p>`}
            ${item.heatSensitive && heatWhy && html`<p class="text-[11px] text-amber-700/90 leading-snug mt-1.5">
              <span class="font-semibold">Morning recommended:</span> ${heatWhy}
            </p>`}
            <div class="mt-2 flex items-center gap-2 flex-wrap">
              <${TagChips} tags=${item.tags} />
              ${src && html`<a href=${src} target="_blank" rel="noopener"
                class="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-500 hover:underline">
                ${item.sourceUrl ? 'official' : 'Wikipedia'} <${IconExternal} className="w-2.5 h-2.5" /></a>`}
            </div>
            <${PlacesList} places=${item.places} cityName=${stop.name} />
            <${NotesLinksView} item=${item} onClick=${openEdit} />
          </div>
        </div>`}

        ${editing && html`
          <div class="mt-2 space-y-2 animate-fade-in">
            <input value=${item.name} onInput=${(e) => patch({ name: e.target.value })}
              class="w-full text-sm font-medium px-2 py-1 rounded-md border border-stone-200 outline-none focus:border-fjord-300" placeholder="Name" />
            <textarea rows="3" value=${item.blurb} onInput=${(e) => patch({ blurb: e.target.value })}
              class="w-full text-xs px-2 py-1 rounded-md border border-stone-200 outline-none focus:border-fjord-300" placeholder="Description" />
            <div class="flex items-center gap-2">
              <label class="flex items-center gap-1 text-xs text-slate-500">tier
                <select value=${item.tier || 3} onChange=${(e) => patch({ tier: Number(e.target.value) })}
                  class="px-1.5 py-1 rounded-md border border-stone-200 text-xs bg-white">
                  <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option>
                </select></label>
              <label class="flex items-center gap-1 text-xs text-slate-500">mins
                <input type="number" min="0" step="15" value=${item.durationMin || ''} onInput=${(e) => patch({ durationMin: Number(e.target.value) || null })}
                  class="w-16 px-1.5 py-1 rounded-md border border-stone-200 text-xs no-spin" /></label>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              ${ALL_TAGS.map((t) => html`<button key=${t} onClick=${() => toggleTag(t)}
                class=${`text-xs px-1.5 py-0.5 rounded-md border transition ${item.tags.includes(t) ? TAG_META[t].color : 'bg-white border-stone-200 text-slate-400'}`}>${t}</button>`)}
              <label class="flex items-center gap-1 text-xs text-slate-500 ml-1 cursor-pointer">
                <input type="checkbox" checked=${item.heatSensitive} onChange=${(e) => patch({ heatSensitive: e.target.checked })} class="accent-amber-500" /> heat-sensitive
              </label>
            </div>
            <${NotesLinksEditor} item=${item} onPatch=${patch} />
            <button onClick=${() => setEditing(false)}
              class="text-xs font-medium text-fjord-700 bg-fjord-50 hover:bg-fjord-100 rounded-md px-2.5 py-1">Done</button>
          </div>`}

        ${assigning && html`<div><${AssignMenu} stop=${stop} item=${item} onClose=${() => setAssigning(false)} /></div>`}
      </div>
    </div>`;
}

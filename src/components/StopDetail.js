import { html, useState, useEffect } from '../html.js';
import { useStore } from '../store/store.js';
import { RecPanel } from './RecPanel.js';
import { DayPlanner } from './DayPlanner.js';
import { IconExternal, IconUtensils } from './icons.js';
import { UnplannedPanel } from './UnplannedPanel.js';
import { TierBadge } from './ItemBits.js';
import { wikiTravelCityPage } from '../lib/wikitravel.js';
import { endDrag } from './dnd.js';
import { useReveal } from '../lib/useReveal.js';

// While dragging anything, scroll the whole page when the cursor nears the top
// or bottom edge of the viewport. Installed once globally (ref-counted) so
// multiple expanded stops don't compound the scroll speed. This is what lets
// you grab an item from the bottom of the recommendations list and carry it up
// to a day that's currently off-screen.
let acRefs = 0;
let acCleanup = null;
function installAutoScroll() {
  acRefs += 1;
  if (acRefs > 1) return;
  const state = { dir: 0, raf: 0 };
  const step = () => {
    if (!state.dir) { state.raf = 0; return; }
    window.scrollBy(0, state.dir * 18);
    state.raf = requestAnimationFrame(step);
  };
  const setDir = (dir) => {
    state.dir = dir;
    if (dir && !state.raf) state.raf = requestAnimationFrame(step);
  };
  const onOver = (e) => {
    const zone = 90;
    if (e.clientY < zone) setDir(-1);
    else if (e.clientY > window.innerHeight - zone) setDir(1);
    else setDir(0);
  };
  const halt = () => setDir(0);
  document.addEventListener('dragover', onOver, true);
  document.addEventListener('drop', halt, true);
  document.addEventListener('dragend', halt, true);
  acCleanup = () => {
    document.removeEventListener('dragover', onOver, true);
    document.removeEventListener('drop', halt, true);
    document.removeEventListener('dragend', halt, true);
    if (state.raf) cancelAnimationFrame(state.raf);
  };
}
function uninstallAutoScroll() {
  acRefs = Math.max(0, acRefs - 1);
  if (acRefs === 0 && acCleanup) { acCleanup(); acCleanup = null; }
}

export function StopDetail({ stop, weather }) {
  const { hideRecs } = useStore();
  const [draggingItem, setDraggingItem] = useState(null);
  // Discovery content (city blurb, must-try bites, recommendations) and the
  // day maps are driven entirely by the global "Hide recommendations" setting
  // (Settings pane) — there's no per-card toggle. The day plan always shows.
  const recs = useReveal(!hideRecs);
  // Planning hints (day nudges, lodging guide, day maps) follow the same rule.
  const showHints = !hideRecs;
  // City-level WikiTravel page (falls back to the city name for custom stops).
  const wikiCityUrl = wikiTravelCityPage(stop.cityId, stop.name);

  useEffect(() => {
    installAutoScroll();
    return uninstallAutoScroll;
  }, []);

  // Always clear slot drop highlights when a drag ends or is cancelled — the
  // source chip may unmount on a successful cross-slot drop before its dragend.
  useEffect(() => {
    function onDragEnd() {
      endDrag();
      setDraggingItem(null);
    }
    document.addEventListener('dragend', onDragEnd);
    return () => document.removeEventListener('dragend', onDragEnd);
  }, []);

  return html`
    <div class="stop-detail p-3 sm:p-5 rounded-b-[3px] animate-fade-in">
      ${stop.tier && html`<div class="mb-3 min-w-0"><${TierBadge} tier=${stop.tier} /></div>`}
${recs.mounted && (stop.blurb || stop.guideUrl || stop.infatuationUrl || wikiCityUrl) && html`<div class=${`reveal ${recs.shown ? 'is-open' : ''}${recs.settled ? ' is-settled' : ''}`}><div class="stop-detail-blurb mb-5">
        <p class="text-[0.875rem] text-slate-700 leading-relaxed">
          ${stop.blurb}
          ${stop.guideUrl && html` <a href=${stop.guideUrl} target="_blank" rel="noopener"
            class="inline-flex items-center gap-0.5 text-fjord-700 text-xs font-semibold hover:underline ml-1 align-middle">
            Rick Steves <${IconExternal} className="w-3 h-3" /></a>`}
          ${stop.infatuationUrl && html` <a href=${stop.infatuationUrl} target="_blank" rel="noopener"
            class="inline-flex items-center gap-0.5 text-fjord-700 text-xs font-semibold hover:underline ml-1 align-middle">
            Infatuation <${IconExternal} className="w-3 h-3" /></a>`}
          ${wikiCityUrl && html` <a href=${wikiCityUrl} target="_blank" rel="noopener"
            class="inline-flex items-center gap-0.5 text-fjord-700 text-xs font-semibold hover:underline ml-1 align-middle">
            WikiTravel <${IconExternal} className="w-3 h-3" /></a>`}
        </p>
      </div></div>`}

      ${recs.mounted && Array.isArray(stop.delicacies) && stop.delicacies.length > 0 && html`<div class=${`reveal ${recs.shown ? 'is-open' : ''}${recs.settled ? ' is-settled' : ''}`}><div class="stop-detail-delicacies mb-5 -mt-2">
        <div class="section-label mb-2 flex items-center gap-1.5"><${IconUtensils} className="w-3.5 h-3.5 text-slate-400" /> Must-try bites</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5">
          ${stop.delicacies.map((d) => html`<div key=${d.name} class="leading-snug">
            <div class="text-[0.8125rem] font-semibold text-slate-700">${d.name}</div>
            <div class="text-[0.75rem] text-slate-500">${d.note}</div>
          </div>`)}
        </div>
      </div></div>`}

      ${hideRecs
        ? html`
          <!-- During the trip: day plan up top, recommendations collapsed below. -->
          <div class="mb-5">
            <h3 class="section-label mb-2.5">Day by day</h3>
            <${DayPlanner} stop=${stop} weather=${weather} draggingItem=${draggingItem} onDragState=${setDraggingItem} showHints=${showHints} />
          </div>
          ${recs.mounted && html`<div class=${`reveal ${recs.shown ? 'is-open' : ''}${recs.settled ? ' is-settled' : ''}`}><div class="border-t border-[#1a1714] pt-4">
            <div class="section-label mb-2.5">Recommendations
              <span class="section-hint hidden sm:inline">${stop.name} sights & food</span>
            </div>
            <${UnplannedPanel} stop=${stop} />
            <${RecPanel} stop=${stop} onDragState=${setDraggingItem} />
          </div></div>`}`
        : html`
          ${recs.mounted && html`<div class=${`reveal ${recs.shown ? 'is-open' : ''}${recs.settled ? ' is-settled' : ''}`}><div><${UnplannedPanel} stop=${stop} /></div></div>`}
          <div class="grid grid-cols-1 gap-5 items-start lg:grid-cols-2">
            ${recs.mounted && html`<div class=${`reveal ${recs.shown ? 'is-open' : ''}${recs.settled ? ' is-settled' : ''}`}><div>
              <div class="mb-2.5 min-w-0">
                <h3 class="section-label">Recommendations
                  <span class="section-hint hidden sm:inline">ranked by tier · drag → a day, or tap ＋</span>
                </h3>
                <p class="section-hint sm:hidden mt-0.5 mb-0 leading-snug">ranked by tier · drag → a day, or tap ＋</p>
              </div>
              <${RecPanel} stop=${stop} onDragState=${setDraggingItem} />
            </div></div>`}

            <div class="stop-detail-aside">
              <h3 class="section-label mb-2.5">Day by day</h3>
              <${DayPlanner} stop=${stop} weather=${weather} draggingItem=${draggingItem} onDragState=${setDraggingItem} showHints=${showHints} />
            </div>
          </div>`}
    </div>`;
}

import { html, useState, useMemo } from '../html.js';
import { useStore } from '../store/store.js';
import { ALL_CATALOG_ITEMS, SUGGESTION_ITEMS } from '../data/catalog.js';
import { TierBadge } from './ItemBits.js';
import { IconPlus } from './icons.js';

// Add a recommendation with autocomplete — scoped to THIS city only (never
// other cities). It draws from the city's catalog plus a "deep bench" of extra
// lower-tier picks that aren't shown by default, so it surfaces more local
// options. Choosing a known suggestion prefills tier, blurb, time estimate,
// image (wiki), and food places; free text adds a plain custom item.
export function RecAutocomplete({ stop, bucket }) {
  const { dispatch } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const present = useMemo(
    () => new Set((stop.recs[bucket] || []).map((it) => it.sourceId).filter(Boolean)),
    [stop.recs, bucket],
  );

  const suggestions = useMemo(() => {
    if (!stop.cityId) return [];
    const query = q.trim().toLowerCase();
    const pool = [...ALL_CATALOG_ITEMS, ...SUGGESTION_ITEMS]
      .filter((it) => it.type === bucket && it.cityId === stop.cityId && !present.has(it.id));
    const scored = pool
      .filter((it) => !query || it.name.toLowerCase().includes(query))
      .map((it) => ({ it, tier: it.tier || 3 }))
      .sort((a, b) => (a.tier - b.tier) || a.it.name.localeCompare(b.it.name));
    return scored.slice(0, 8).map((x) => x.it);
  }, [q, bucket, present, stop.cityId]);

  function addCatalog(it) {
    dispatch({ type: 'ADD_ITEM', stopId: stop.id, bucket, custom: false, item: { ...it } });
    setQ(''); setOpen(false);
  }
  function addFree() {
    if (!q.trim()) return;
    dispatch({ type: 'ADD_ITEM', stopId: stop.id, bucket, custom: true, item: { name: q.trim(), blurb: '', why: '', tags: [] } });
    setQ(''); setOpen(false);
  }

  return html`<div class="relative mt-1.5">
    <div class="flex items-center gap-1.5">
      <input value=${q}
        onInput=${(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus=${() => setOpen(true)}
        onBlur=${() => setTimeout(() => setOpen(false), 150)}
        onKeyDown=${(e) => e.key === 'Enter' && (suggestions[0] ? addCatalog(suggestions[0]) : addFree())}
        placeholder=${`Add another ${stop.name} pick, or type your own…`}
        class="flex-1 text-xs px-2.5 py-1.5 rounded-[2px] border border-dashed border-[1.5px] border-[#1a1714] outline-none focus:border-fjord-600 focus:border-solid bg-white" />
      <button onMouseDown=${(e) => { e.preventDefault(); addFree(); }} title="Add"
        class="text-fjord-600 hover:bg-fjord-50 border border-[1.5px] border-[#1a1714] rounded-[2px] p-1"><${IconPlus} className="w-4 h-4" /></button>
    </div>
    ${open && suggestions.length > 0 && html`
      <div class="absolute z-30 left-0 right-0 mt-1 gg-menu rounded-[3px] overflow-hidden max-h-72 overflow-y-auto scrollbar-thin gg-pop-in origin-top">
        ${suggestions.map((it) => html`<button key=${it.id}
          onMouseDown=${(e) => { e.preventDefault(); addCatalog(it); }}
          class="w-full text-left px-3 py-2 hover:bg-fjord-50 border-b border-[#1a1714] last:border-0">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-slate-800 flex-1 truncate">${it.name}</span>
            <${TierBadge} tier=${it.tier} />
          </div>
          ${it.blurb && html`<div class="text-[11px] text-slate-400 truncate">${it.blurb}</div>`}
        </button>`)}
      </div>`}
  </div>`;
}

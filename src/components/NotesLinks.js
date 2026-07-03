import { html } from '../html.js';
import { IconNote } from './icons.js';

// Read-only preview of an item's notes. Day-plan chips use the inline form so
// short notes like times are visible without opening the editor.
export function NotesLinksView({ item, onClick, inline = false }) {
  const note = (item.notes || '').trim();
  const hasNotes = !!note;
  if (!hasNotes) return null;
  if (inline) {
    return html`<button onClick=${onClick}
      class="mt-1.5 flex w-full items-start gap-1.5 text-left text-[11px] leading-relaxed text-slate-600 bg-stone-50 hover:bg-stone-100 rounded-[2px] border border-[1.5px] border-[#1a1714] px-2 py-1.5 whitespace-pre-wrap transition-colors"
      title="Edit note">
      <span class="shrink-0 mt-px text-slate-400"><${IconNote} className="w-3 h-3" /></span>
      <span class="min-w-0 flex-1">${note}</span></button>`;
  }
  return html`<div class="flex flex-wrap items-center gap-1.5 mt-1.5">
    <button onClick=${onClick}
      class="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-stone-50 hover:bg-stone-100 border border-[1.5px] border-[#1a1714] rounded-[2px] px-1.5 py-0.5"
      title=${note}>
      <${IconNote} className="w-3 h-3" /> note</button>
  </div>`;
}

// Editor for freeform notes. Calls onPatch({ notes }).
export function NotesLinksEditor({ item, onPatch }) {
  return html`<div class="mt-2">
    <textarea rows="2" placeholder="Notes & tips…"
      class="w-full text-xs text-slate-600 bg-white border border-[1.5px] border-[#1a1714] rounded-[2px] p-2 outline-none focus:border-fjord-600"
      value=${item.notes || ''}
      onChange=${(e) => onPatch({ notes: e.target.value })} />
  </div>`;
}

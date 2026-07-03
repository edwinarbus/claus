import { html } from '../html.js';
import { useStore } from '../store/store.js';
import { IconWarning } from './icons.js';

export function SyncConflictBar() {
  const { syncConflict, acceptRemote, keepLocal, dismissSyncConflict, who } = useStore();
  if (!syncConflict) return null;

  const by = syncConflict.updatedBy;
  const staleLocal = syncConflict.kind === 'stale-local';
  // Defensive: a same-person update isn't a real conflict — don't alarm yourself.
  if (!staleLocal && by && who && by === who) return null;
  const label = staleLocal
    ? 'This device had an older cached copy — the shared trip on the server was loaded instead'
    : (by ? `${by} edited the trip on another device` : 'The shared trip changed on another device');

  return html`<div class="flex flex-wrap items-center gap-2 text-xs rounded-[3px] border-[1.5px] border-amber-300 bg-amber-50 text-amber-900 px-3 py-2.5 mb-3 animate-fade-in">
    <span class="shrink-0 inline-flex items-center text-amber-600" aria-hidden="true"><${IconWarning} className="w-4 h-4" /></span>
    <span class="flex-1 leading-snug min-w-[12rem]">${label}${staleLocal ? '.' : ', and you have unsaved edits here. Which should win?'}</span>
    ${!staleLocal && html`<div class="flex items-center gap-2 shrink-0">
      <button onClick=${acceptRemote}
        class="font-semibold px-2.5 py-1 rounded-[2px] bg-white border-[1.5px] border-[#1a1714] hover:bg-[#1a1714] hover:text-[#f4f3ee] transition">
        Use theirs
      </button>
      <button onClick=${keepLocal}
        class="font-semibold px-2.5 py-1 rounded-[2px] bg-[#1a1714] text-[#f4f3ee] border-[1.5px] border-[#1a1714] hover:bg-fjord-600 hover:border-fjord-600 transition">
        Keep mine
      </button>
    </div>`}
    ${staleLocal && html`<button onClick=${dismissSyncConflict}
      class="font-semibold px-2.5 py-1 rounded-[2px] bg-white border-[1.5px] border-[#1a1714] hover:bg-[#1a1714] hover:text-[#f4f3ee] transition shrink-0">
      Dismiss
    </button>`}
  </div>`;
}

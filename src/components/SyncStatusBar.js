import { html } from '../html.js';
import { useStore } from '../store/store.js';
import { IconX } from './icons.js';

export function SyncStatusBar() {
  const { sync, retrySync } = useStore();
  if (!sync?.on || sync.status !== 'error') return null;

  return html`<div class="flex flex-wrap items-center gap-2 text-xs rounded-[3px] border-[1.5px] border-rose-300 bg-rose-50 text-rose-800 px-3 py-2.5 mb-3 animate-fade-in">
    <span class="shrink-0 inline-flex items-center text-rose-500" aria-hidden="true"><${IconX} className="w-4 h-4" /></span>
    <span class="flex-1 leading-snug">Couldn't save to the shared trip — your changes are safe in this browser.</span>
    <button onClick=${retrySync}
      class="font-semibold px-2.5 py-1 rounded-[2px] bg-white border-[1.5px] border-[#1a1714] hover:bg-[#1a1714] hover:text-[#f4f3ee] transition shrink-0">
      Retry
    </button>
  </div>`;
}

import { html } from '../html.js';
import { useTrip } from '../store/store.js';
import { IconChat } from './icons.js';
import { isKlausMode } from '../lib/klausMode.js';

export function TripChatButton({ compact = false, row = false, onOpen }) {
  const trip = useTrip();
  if (!trip.stops.length || !onOpen) return null;
  const name = isKlausMode(trip) ? 'Klaus' : 'Claus';

  if (compact) {
    return html`<button type="button" onClick=${onOpen}
      title="Chat with ${name}" aria-label="Chat with ${name}"
      class="inline-flex items-center justify-center w-9 h-9 rounded-[2px] border-[1.5px] border-[#1a1714] bg-white text-slate-800 shrink-0 transition hover:bg-[#1a1714] hover:text-[#f4f3ee] active:translate-y-px">
      <${IconChat} className="w-[1.15rem] h-[1.15rem]" />
    </button>`;
  }

  if (row) {
    return html`<button type="button" onClick=${onOpen}
      class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[2px] text-sm font-semibold border-[1.5px] border-[#1a1714] bg-white text-slate-800 hover:bg-[#1a1714] hover:text-[#f4f3ee] transition active:translate-y-px">
      <${IconChat} className="w-4 h-4 shrink-0" />
      <span class="text-left flex-1">${name}</span>
    </button>`;
  }

  return html`<button type="button" onClick=${onOpen}
    title="Chat with ${name}"
    class="inline-flex items-center gap-1.5 rounded-[2px] border-[1.5px] border-[#1a1714] bg-white text-slate-800 hover:bg-[#1a1714] hover:text-[#f4f3ee] transition px-3 py-2 text-sm">
    <${IconChat} className="w-5 h-5" />
    <span class="hidden sm:inline font-semibold">${name}</span>
  </button>`;
}

import { html, useState } from '../html.js';
import { useStore } from '../store/store.js';
import { SYNC_LABEL, syncTime } from '../lib/syncStatus.js';
import { PEOPLE } from '../data/profiles.js';
import { Avatar } from './Avatar.js';
import { IconSliders, IconUndo, IconCheck, IconChevronDown } from './icons.js';
import { TripChatButton } from './TripChatButton.js';
import { brandName } from '../lib/klausMode.js';

function SyncIndicator({ sync, onManualSave }) {
  const [saving, setSaving] = useState(false);
  const info = SYNC_LABEL[sync?.status] || SYNC_LABEL.local;
  const time = sync?.status === 'synced' ? syncTime(sync.at) : '';
  const canSave = sync?.status === 'synced' && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    await onManualSave();
    setSaving(false);
  }

  return html`<button
    onClick=${handleSave}
    disabled=${!canSave}
    title=${canSave ? 'Save a snapshot now' : info.tip}
    class="inline-flex items-center justify-center gap-1.5 h-9 px-2 shrink-0 rounded-[2px] transition ${canSave ? 'border-[1.5px] border-[#1a1714] bg-white hover:bg-[#1a1714] hover:text-[#f4f3ee] cursor-pointer' : 'cursor-default'} disabled:cursor-default">
    <span class=${`w-2.5 h-2.5 rounded-[1px] shrink-0 ${info.dot}`}></span>
    <div class="flex flex-col gap-px leading-none min-w-0">
      <span class=${`text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap ${info.text}`}>${saving ? 'Saving…' : info.label}</span>
      ${time ? html`<span class="text-[8px] text-slate-400 whitespace-nowrap tnum">${time}</span>` : ''}
    </div>
  </button>`;
}

// Who-switcher: circular profile photo + name on a bordered capsule; the menu is
// a flat bordered sheet with both travelers and a checkmark on the active one.
function WhoPill({ who, setWho }) {
  const [open, setOpen] = useState(false);
  return html`<div class="relative shrink-0">
    <button onClick=${() => setOpen(!open)} aria-haspopup="menu" aria-expanded=${open}
      title=${who ? `Planning as ${who}` : 'Who are you?'}
      class="inline-flex items-stretch h-9 rounded-[2px] border-[1.5px] border-[#1a1714] bg-white text-xs font-semibold text-slate-800 overflow-hidden transition active:translate-y-px">
      <${Avatar} name=${who} size="h-full aspect-square" textSize="text-[13px]" square=${true} bordered=${false} className="border-r-[1.5px] border-[#1a1714]" />
      <span class="inline-flex items-center gap-1 pl-2 pr-2 whitespace-nowrap">${who || 'Who are you?'}
        <${IconChevronDown} className=${`w-3 h-3 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </span>
    </button>
    ${open && html`<div class="absolute right-0 mt-1.5 z-30 origin-top-right p-1 w-36 rounded-[3px] border-[1.5px] border-[#1a1714] bg-white shadow-md animate-fade-in" role="menu">
      <div class="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Planning as</div>
      ${PEOPLE.map((p) => html`<button key=${p.name} role="menuitemradio" aria-checked=${who === p.name}
        onClick=${() => { setWho(p.name); setOpen(false); }}
        class=${`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[2px] text-sm transition ${who === p.name ? 'font-semibold bg-[#1a1714] text-[#f4f3ee]' : 'text-slate-600 hover:bg-stone-50'}`}>
        <${Avatar} name=${p.name} size="w-8 h-8" textSize="text-xs" />
        <span class="flex-1 text-left">${p.name}</span>
        ${who === p.name && html`<${IconCheck} className="w-4 h-4 shrink-0" />`}
      </button>`)}
    </div>`}
  </div>`;
}

function HeaderToolbar({ onOpenFilters, onOpenChat, sync, who, setWho, undo, canUndo, saveSnapshotNow }) {
  return html`
    <button onClick=${() => canUndo && undo()} disabled=${!canUndo}
      title=${canUndo ? 'Undo last change' : 'Nothing to undo'} aria-label="Undo last change"
      class="inline-flex items-center justify-center w-9 h-9 rounded-[2px] border-[1.5px] border-[#1a1714] bg-white text-slate-800 transition hover:bg-[#1a1714] hover:text-[#f4f3ee] disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-slate-800 disabled:cursor-default shrink-0">
      <${IconUndo} className="w-[1.15rem] h-[1.15rem]" />
    </button>
    <button onClick=${onOpenFilters} title="Settings" aria-label="Settings"
      class="inline-flex items-center justify-center w-9 h-9 rounded-[2px] border-[1.5px] border-[#1a1714] bg-white text-slate-800 transition hover:bg-[#1a1714] hover:text-[#f4f3ee] shrink-0">
      <${IconSliders} className="w-[1.15rem] h-[1.15rem]" />
    </button>
    <${TripChatButton} compact=${true} onOpen=${onOpenChat} />
    <${SyncIndicator} sync=${sync} onManualSave=${saveSnapshotNow} />
    <${WhoPill} who=${who} setWho=${setWho} />`;
}

// Mobile keeps a single settings entry point; the sync state rides along as a
// small corner dot so status stays glanceable without its own toolbar slot.
function MobileSettingsButton({ onOpenFilters, sync }) {
  const info = SYNC_LABEL[sync?.status] || SYNC_LABEL.local;
  return html`<button onClick=${onOpenFilters}
    title=${`Settings · ${info.label}`} aria-label="Settings"
    class="relative inline-flex items-center justify-center w-9 h-9 rounded-[2px] border-[1.5px] border-[#1a1714] bg-white text-slate-800 transition hover:bg-[#1a1714] hover:text-[#f4f3ee] shrink-0">
    <${IconSliders} className="w-[1.15rem] h-[1.15rem]" />
    <span class=${`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-[1px] ${info.dot}`}></span>
  </button>`;
}

export function Header({ onOpenFilters, onOpenChat, viewToggle = null, mobileControls = null }) {
  const { trip, sync, who, setWho, undo, canUndo, saveSnapshotNow } = useStore();
  const toolbarProps = { onOpenFilters, onOpenChat, sync, who, setWho, undo, canUndo, saveSnapshotNow };

  return html`
    <header class="pt-2 lg:pt-0 mb-0 flex flex-row items-center justify-between gap-2 sm:gap-3 lg:contents">
      <div class="min-w-0 flex-1 lg:flex-none lg:col-start-1 lg:row-start-1">
        <h1 class="font-display font-black tracking-tight text-[1.6rem] min-[360px]:text-[1.85rem] sm:text-[2rem] text-slate-900 leading-tight truncate pb-px">${brandName(trip)}</h1>
      </div>

      ${viewToggle && html`<div class="hidden lg:flex lg:justify-center lg:col-start-2 lg:row-start-1 lg:self-center">
        ${viewToggle}
      </div>`}

      <div class="flex items-center justify-end flex-nowrap gap-1.5 shrink-0 lg:col-start-3 lg:row-start-1">
        ${mobileControls}
        <div class="flex sm:hidden items-center flex-nowrap gap-1.5 shrink-0">
          <${MobileSettingsButton} onOpenFilters=${onOpenFilters} sync=${sync} />
          <${TripChatButton} compact=${true} onOpen=${onOpenChat} />
        </div>
        <div class="hidden sm:flex items-center flex-nowrap gap-1.5">
          <${HeaderToolbar} ...${toolbarProps} />
        </div>
      </div>
    </header>`;
}

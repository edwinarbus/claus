import { html } from '../html.js';
import { IconTimeline, IconCalendar, IconMap } from './icons.js';

const VIEWS = [
  { key: 'timeline', label: 'Timeline', Icon: IconTimeline },
  { key: 'calendar', label: 'Calendar', Icon: IconCalendar },
  { key: 'map',      label: 'Map',      Icon: IconMap },
];

function SegmentedToggle({ view, onChange, showLabels, compact }) {
  return html`
    <div class=${`seg-toggle inline-flex w-full ${compact ? 'h-9' : 'h-10'} box-border rounded-[3px] border-[1.5px] border-[#1a1714] bg-white overflow-hidden divide-x-[1.5px] divide-[#1a1714]`}>
      ${VIEWS.map(({ key, label, Icon }) => {
        const active = view === key;
        return html`
          <button key=${key} type="button" onClick=${() => onChange(key)}
            aria-label=${label}
            aria-current=${active ? 'page' : undefined}
            data-active=${active}
            class=${`flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-full ${compact ? 'px-0' : 'px-2'} text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap transition ${active ? 'bg-[#1a1714] text-[#f4f3ee]' : 'text-slate-600 hover:bg-stone-50'}`}>
            <span class=${`shrink-0 ${compact ? 'w-4 h-4' : 'w-[0.95rem] h-[0.95rem]'}`} aria-hidden="true">
              <${Icon} className="w-full h-full" />
            </span>
            ${showLabels && html`<span>${label}</span>`}
          </button>`;
      })}
    </div>`;
}

export function MobileViewToggle({ view, onChange }) {
  return html`<div class="sm:hidden w-[8.5rem] shrink-0">
    <${SegmentedToggle} view=${view} onChange=${onChange} showLabels=${false} compact=${true} />
  </div>`;
}

export function ViewToggle({ view, onChange, placement = 'stacked' }) {
  const toggle = html`<${SegmentedToggle} view=${view} onChange=${onChange} showLabels=${true} compact=${false} />`;

  if (placement === 'inline') {
    return html`<div class="w-[20.5rem] shrink-0">${toggle}</div>`;
  }

  return html`<div class="hidden sm:block lg:hidden w-full max-w-[20.5rem] mx-auto pt-1.5">${toggle}</div>`;
}

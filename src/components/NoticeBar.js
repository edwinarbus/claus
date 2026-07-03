import { html } from '../html.js';
import { IconCheck, IconLightbulb, IconX } from './icons.js';
import { Avatar } from './Avatar.js';
import { actorOrDefault } from '../lib/actors.js';

const STYLES = {
  good: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  warn: 'bg-amber-50 border-amber-200 text-amber-900',
  bad: 'bg-rose-50 border-rose-200 text-rose-800',
};

export function NoticeBar({ notice, onDismiss }) {
  if (!notice) return null;
  const style = STYLES[notice.level] || STYLES.warn;

  if (notice.kind === 'plan-edit') {
    const actor = actorOrDefault(notice.by);
    return html`<div class=${`flex items-start gap-2.5 text-xs rounded-[3px] border-[1.5px] px-3 py-2.5 mb-3 animate-fade-in ${style}`}>
      <${Avatar} name=${actor} size="w-8 h-8" textSize="text-[10px]" className="shrink-0 mt-0.5" />
      <p class="flex-1 leading-snug min-w-0 pt-1">
        <span class="font-semibold">${actor}</span>
        ${' '}${notice.text}${notice.more > 0 ? html` <span class="opacity-75">(+${notice.more} more)</span>` : ''}
      </p>
      <button onClick=${onDismiss} aria-label="Dismiss" class="shrink-0 opacity-60 hover:opacity-100 p-2 -m-1.5 rounded-[2px]"><${IconX} className="w-3.5 h-3.5" /></button>
    </div>`;
  }

  return html`<div class=${`flex items-start gap-2 text-xs rounded-[3px] border-[1.5px] px-3 py-2 mb-3 animate-fade-in ${style}`}>
    <span class="shrink-0 inline-flex items-center mt-px">${notice.level === "good" ? html`<${IconCheck} className="w-4 h-4" />` : html`<${IconLightbulb} className="w-4 h-4" />`}</span>
    <span class="flex-1 leading-snug">${notice.text}</span>
    <button onClick=${onDismiss} aria-label="Dismiss" class="shrink-0 opacity-60 hover:opacity-100 p-2 -m-1.5 rounded-[2px]"><${IconX} className="w-3.5 h-3.5" /></button>
  </div>`;
}

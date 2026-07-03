// A compact weather chip: icon + temp (°F).
import { html } from '../html.js';
import { WeatherGlyph } from './WeatherGlyph.js';

export function WeatherChip({ data, loading, size = 'sm', showLow = false, pill = false }) {
  // The capsule lives here (not on a wrapper) so nothing renders when there is
  // no data — an empty glass pill would read as a broken control.
  const pillCls = pill ? 'inline-flex items-center min-h-[26px] px-2 border-[1.5px] border-[#1a1714] rounded-[2px] bg-white' : '';
  if (loading) {
    return html`<span class="inline-flex items-center gap-1 text-slate-300 ${pillCls} ${size === 'sm' ? 'text-xs' : 'text-sm'}">
      <span class="w-3 h-3 rounded-[1px] bg-stone-200 animate-pulse"></span>
      <span class="w-7 h-3 rounded-[1px] bg-stone-200 animate-pulse"></span>
    </span>`;
  }
  if (!data) return null;
  const text = size === 'sm' ? 'text-xs' : 'text-sm';
  return html`<span class="inline-flex items-center gap-1 ${pillCls} ${text} font-bold text-slate-900">
    <${WeatherGlyph} code=${data.code} className=${size === 'sm' ? 'w-4 h-4' : 'w-[1.15rem] h-[1.15rem]'} />
    <span class="tnum">${data.tempF}°</span>
    ${showLow && html`<span class="text-slate-500 tnum"> / ${data.lowF}°</span>`}
  </span>`;
}

import { html, useState, useEffect, useRef } from '../html.js';
import { to12Parts, partsTo24 } from '../lib/time.js';

// A 12-hour clock input that stores a 24h "HH:MM" string. You can type a 24h
// hour (13–24 fold to PM/AM immediately) or a 12h hour and tap AM/PM. Typing a
// colon — e.g. "7:07" — splits straight into the minutes box.
export function TimeField({ value = '', onChange, ariaLabel = 'Time' }) {
  const [parts, setParts] = useState(() => to12Parts(value));
  const minRef = useRef(null);
  const lastEmit = useRef(value);

  // Re-seed from the prop only on outside changes (load, reset, the other
  // traveler's sync) — never while we're the one editing, which would yank the
  // field mid-keystroke.
  useEffect(() => {
    if (value !== lastEmit.current) {
      setParts(to12Parts(value));
      lastEmit.current = value;
    }
  }, [value]);

  function emit(next) {
    setParts(next);
    const v = partsTo24(next.hour, next.minute, next.mer);
    lastEmit.current = v;
    onChange(v);
  }

  // 13–24 fold to a 12h hour + meridiem immediately ("19" -> 7 PM, "24" -> 12 AM).
  // 0–12 are kept as typed so partial entry ("0" before "07") isn't clobbered;
  // blur normalizes a lone "0"/"00" to 12 AM.
  function applyHour(raw, prev) {
    if (raw === '') return { ...prev, hour: '' };
    const n = Number(raw);
    if (Number.isNaN(n)) return prev;
    if (n >= 13 && n <= 24) {
      return { ...prev, hour: n === 24 ? '12' : String(n - 12), mer: n === 24 ? 'AM' : 'PM' };
    }
    return { ...prev, hour: raw };
  }

  function onHour(e) {
    const raw = e.target.value.replace(/[^\d:]/g, '');
    if (raw.includes(':')) {
      const [h, m] = raw.split(':');
      const next = applyHour(h.slice(0, 2), parts);
      next.minute = (m || '').replace(/\D/g, '').slice(0, 2);
      emit(next);
      if (minRef.current) minRef.current.focus();
      return;
    }
    emit(applyHour(raw.slice(0, 2), parts));
  }

  function onHourBlur() {
    if (parts.hour !== '' && Number(parts.hour) === 0) emit({ ...parts, hour: '12', mer: 'AM' });
  }

  function onMinute(e) {
    let raw = e.target.value.replace(/\D/g, '').slice(0, 2);
    if (raw !== '' && Number(raw) > 59) raw = '59';
    emit({ ...parts, minute: raw });
  }

  function onMinuteBlur() {
    if (parts.minute.length === 1) emit({ ...parts, minute: parts.minute.padStart(2, '0') });
  }

  const box = 'tf-time-num px-1.5 py-1 rounded-[2px] border-[1.5px] border-[#1a1714] bg-white outline-none focus:border-[#1a1714] text-[10px] text-center tnum font-semibold text-slate-900';

  return html`<div class="inline-flex flex-wrap items-center gap-1" role="group" aria-label=${ariaLabel}>
    <div class="inline-flex items-center gap-1">
      <input inputmode="numeric" value=${parts.hour} onInput=${onHour} onBlur=${onHourBlur}
        placeholder="--" aria-label=${`${ariaLabel} hour`} class=${`${box} w-9`} />
      <span class="text-slate-500 font-bold text-[10px]" aria-hidden="true">:</span>
      <input ref=${minRef} inputmode="numeric" value=${parts.minute} onInput=${onMinute} onBlur=${onMinuteBlur}
        placeholder="--" aria-label=${`${ariaLabel} minutes`} class=${`${box} w-9`} />
    </div>
    <div class="glass-segment glass-segment--inline glass-segment--xs">
      <div class="glass-segment__track">
        ${['AM', 'PM'].map((m) => html`<button key=${m} type="button" onClick=${() => emit({ ...parts, mer: m })}
          data-active=${parts.mer === m} aria-pressed=${parts.mer === m}
          class="glass-segment__item">${m}</button>`)}
      </div>
    </div>
  </div>`;
}

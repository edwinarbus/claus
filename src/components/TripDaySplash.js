import { html, useState, useEffect, useRef } from '../html.js';
import { getRangeWeather, severeWeatherAlert } from '../data/weather.js';
import { getLocalAlerts, ALERT_KIND_ICON } from '../data/alerts.js';
import {
  IconWarning, IconCheck, IconBed, IconJacket, IconTicket,
  IconSunrise, IconSun, IconMoon, IconUtensils, IconHeat, IconCold,
} from './icons.js';
import { WeatherGlyph } from './WeatherGlyph.js';
import {
  greetingForNow, buildDayOverview, periodWeather, wearAdvice, plannedSightNames, daySummary,
} from '../lib/tripDay.js';

// Alert-kind glyph keys → icon components.
const ALERT_GLYPH = { warning: IconWarning, ticket: IconTicket };
// Day-overview highlight keys → icon components.
const HIGHLIGHT_GLYPH = {
  morning: IconSunrise, afternoon: IconSun, evening: IconMoon, meal: IconUtensils,
};

// Live "local conditions" strip: a checking state on open, then either compact
// disruption headlines, a weather heads-up, or a quiet all-clear line. News
// comes from the cached /api/alerts proxy; when it's empty or unavailable we
// fall back to the always-reliable weather signal, so the old "couldn't check"
// dead end never shows.
function LocalConditions({ city, dateISO, weather, sights = [] }) {
  const [state, setState] = useState({ loading: true, alerts: [] });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, alerts: [] });
    // The day's planned sights ride along so the news check also covers
    // closures/events at the exact places on today's plan.
    getLocalAlerts(city, dateISO, { sights })
      .then((r) => alive && setState({ loading: false, alerts: r.alerts }))
      .catch(() => alive && setState({ loading: false, alerts: [] }));
    return () => { alive = false; };
    // `sights` is deliberately not a dependency: it's a fresh array each render,
    // and the check should run once per city+day (results are cached anyway).
  }, [city, dateISO]);

  if (state.loading) {
    return html`<div class="flex items-center justify-center gap-2 text-[12px] text-slate-500 py-1">
      <span class="w-3.5 h-3.5 rounded-full border-2 border-stone-300 border-t-fjord-600 animate-spin"></span>
      <span>Checking ${city} for travel disruptions…</span>
    </div>`;
  }

  if (state.alerts.length > 0) {
    return html`<div class="rounded-[2px] border-[1.5px] border-[#1a1714] bg-amber-50 px-3 py-1.5">
      <div class="text-[11px] font-semibold uppercase tracking-wide text-amber-700 mb-0.5 inline-flex items-center gap-1"><${IconWarning} className="w-3 h-3" /> Heads up in ${city} today</div>
      <div class="flex flex-col gap-0.5">
        ${state.alerts.map((a, i) => {
          const AlertIcon = ALERT_GLYPH[ALERT_KIND_ICON[a.kind]] || IconWarning;
          return html`<a key=${i} href=${a.url} target="_blank" rel="noopener"
          class="flex items-center gap-2 text-[12px] text-amber-900 leading-snug hover:underline">
          <span class="shrink-0 inline-flex items-center text-amber-600" aria-hidden="true"><${AlertIcon} className="w-3.5 h-3.5" /></span>
          <span class="min-w-0 truncate">${a.title}</span>
        </a>`;
        })}
      </div>
    </div>`;
  }

  // No news disruptions (or news unavailable) → reliable weather fallback.
  const wxAlert = severeWeatherAlert(weather);
  if (wxAlert) {
    return html`<div class="rounded-[2px] border-[1.5px] border-[#1a1714] bg-amber-50 px-3 py-1.5">
      <div class="text-[11px] font-semibold uppercase tracking-wide text-amber-700 mb-0.5 inline-flex items-center gap-1"><${IconWarning} className="w-3 h-3" /> Heads up in ${city} today</div>
      <div class="flex items-center gap-2 text-[12px] text-amber-900 leading-snug">
        <span class="shrink-0 inline-flex items-center text-amber-600" aria-hidden="true">
          ${wxAlert.glyph === 'heat'
            ? html`<${IconHeat} className="w-3.5 h-3.5" />`
            : wxAlert.glyph === 'cold'
              ? html`<${IconCold} className="w-3.5 h-3.5" />`
              : html`<${WeatherGlyph} code=${wxAlert.code} className="w-4 h-4" />`}
        </span>
        <span class="min-w-0">${wxAlert.title}</span>
      </div>
    </div>`;
  }

  return html`<div class="flex items-center justify-center gap-1.5 text-[12px] font-semibold text-fjord-700 py-0.5">
    <span class="inline-flex items-center text-fjord-600" aria-hidden="true"><${IconCheck} className="w-4 h-4" /></span>
    <span>No major disruptions reported in ${city} today.</span>
  </div>`;
}

// Welcome on a real trip day — a centered glass modal that floats over the live
// timeline. The timeline frosts through the blurred scrim behind the panel.
export function TripDaySplash({ stop, day, who, onContinue }) {
  const [wx, setWx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [openHour] = useState(() => new Date().getHours());
  const closeTimer = useRef(null);

  useEffect(() => { requestAnimationFrame(() => setShown(true)); }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getRangeWeather(stop.lat, stop.lng, [day.date])
      .then((byDate) => { if (alive) { setWx(byDate[day.date] || null); setLoading(false); } })
      .catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [stop.lat, stop.lng, day.date]);

  useEffect(() => {
    let alive = true;
    setSummaryLoading(true);
    setAiSummary(null);
    fetch(`/api/welcome-brief?date=${encodeURIComponent(day.date)}&hour=${encodeURIComponent(openHour)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('welcome_brief_failed'))))
      .then((data) => {
        if (!alive) return;
        if (data.source === 'anthropic' && data.summary) setAiSummary(data.summary);
      })
      .catch(() => { /* show unavailable state */ })
      .finally(() => alive && setSummaryLoading(false));
    return () => { alive = false; };
  }, [day.date, openHour]);

  const overview = buildDayOverview(stop, day, { hour: openHour });
  const periods = periodWeather(wx);
  const wear = wearAdvice(wx, stop, day.date);
  const greet = greetingForNow(who);

  // Play the leave animation, then hand off. Idempotent so the CTA, the backdrop
  // tap, and Esc can't double-fire.
  function handleContinue() {
    if (closeTimer.current) return;
    setExiting(true);
    closeTimer.current = setTimeout(onContinue, 320);
  }

  // Dismiss on Escape and lock background scroll while the modal is open, like
  // the app's other overlays.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleContinue(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(closeTimer.current);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const visible = shown && !exiting;

  return html`<div
    class="fixed inset-0 z-[2000] overflow-y-auto welcome-modal-scrim"
    style=${{ opacity: exiting ? 0 : 1, transition: 'opacity 0.32s ease' }}
    onClick=${handleContinue}
    role="dialog" aria-modal="true">
    <div class="min-h-full flex flex-col justify-center px-5"
      style=${{
        paddingTop: 'max(1.5rem, calc(env(safe-area-inset-top, 0px) + 1rem))',
        paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))',
      }}>
      <div class="w-full max-w-md mx-auto flex flex-col gap-4 rounded-[3px] border-[1.5px] border-[#1a1714] bg-stone-50 shadow-md p-6 sm:p-7"
        onClick=${(e) => e.stopPropagation()}
        style=${{
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.97)',
          transition: 'transform 0.42s cubic-bezier(0.22,1,0.36,1)',
        }}>

        <!-- Greeting -->
        <div class="text-center">
          <h1 class="font-display text-[1.85rem] sm:text-[2.35rem] font-black tracking-tight text-slate-900 leading-[0.98] [text-wrap:balance]">${greet}</h1>
          <p class="uppercase tracking-wide text-[11px] font-semibold text-slate-500 mt-2">Day ${overview.dayNumber} · ${overview.dateLabel} · ${overview.city}</p>
        </div>

        <!-- Claude-written summary when available; otherwise a warm local one
             built from the day's plan + weather (never a bare error line). -->
        ${summaryLoading
          ? html`<p class="text-center text-[14px] leading-relaxed text-slate-400 animate-pulse min-h-[3.25rem]">Writing today's brief…</p>`
          : html`<p class="text-center text-[14px] leading-relaxed text-slate-700">${aiSummary || daySummary(stop, day, wx)}</p>`}

        <!-- Live local conditions -->
        <${LocalConditions} city=${overview.city} dateISO=${day.date} weather=${wx}
          sights=${plannedSightNames(day, { hour: openHour })} />

        <!-- Planned sights — one-line bullets -->
        ${overview.highlights.length > 0 && html`
          <div class="rounded-[3px] border-[1.5px] border-[#1a1714] bg-white divide-y divide-[#1a1714]">
            ${overview.highlights.map((h, i) => {
              const HiIcon = HIGHLIGHT_GLYPH[h.iconKey] || IconSun;
              return html`<div key=${i} class="flex items-center gap-2.5 px-3.5 py-2.5">
              <span class="shrink-0 inline-flex items-center text-slate-900" aria-hidden="true"><${HiIcon} className="w-4 h-4" /></span>
              <span class="min-w-0 text-sm text-slate-800 leading-snug line-clamp-1">${h.text}</span>
            </div>`;
            })}
            ${overview.lodgingLine && html`<div class="flex items-center gap-2.5 px-3.5 py-2.5 bg-stone-50">
              <span class="shrink-0 inline-flex items-center text-slate-900" aria-hidden="true"><${IconBed} className="w-4 h-4" /></span>
              <span class="min-w-0 text-sm text-slate-700 leading-snug line-clamp-1">${overview.lodgingLine}</span>
            </div>`}
          </div>`}

        <!-- Weather by period -->
        <div class="grid grid-cols-3 gap-2">
          ${loading
            ? [0, 1, 2].map((i) => html`<div key=${i} class="rounded-[3px] border-[1.5px] border-[#1a1714] bg-white py-3 animate-pulse">
                <div class="h-2 w-10 bg-stone-200 rounded-[1px] mx-auto mb-1.5"></div>
                <div class="h-4 w-7 bg-stone-200 rounded-[1px] mx-auto"></div>
              </div>`)
            : (periods || []).map((p) => html`<div key=${p.label}
                class="rounded-[3px] border-[1.5px] border-[#1a1714] bg-white py-2.5 text-center">
                <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">${p.label}</div>
                <div class="mt-1 flex justify-center"><${WeatherGlyph} code=${p.code} className="w-7 h-7" /></div>
                <div class="text-sm font-bold tnum text-slate-900 mt-1">${p.temp}°</div>
              </div>`)}
        </div>

        <!-- What to wear -->
        <div class="rounded-[3px] border-[1.5px] border-[#1a1714] bg-fjord-50 px-3.5 py-3 flex items-center gap-3">
          <span class="shrink-0 inline-flex items-center text-fjord-700" aria-hidden="true"><${IconJacket} className="w-5 h-5" /></span>
          <div class="min-w-0 text-[13px] text-slate-800 leading-snug">
            ${(Array.isArray(wear) ? wear : [wear]).map((line, i) => html`
              <div key=${i}>${line}</div>`)}
          </div>
        </div>

        <!-- Continue -->
        <button onClick=${handleContinue}
          class="btn-ink mt-1 w-full py-3.5 rounded-[2px] text-sm font-bold uppercase tracking-wide flex items-center justify-center">
          <span>Start the day</span>
        </button>
      </div>
    </div>
  </div>`;
}

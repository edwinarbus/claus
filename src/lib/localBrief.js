// A locally-built daily brief, in the SAME receipt markdown the Overnight
// Concierge produces — so the briefing receipt is ALWAYS the chat's home screen,
// even before the managed agent is provisioned or when /api/concierge has nothing
// yet. It's lighter than the agent's live-searched brief (no opening hours or
// strike checks), but it's a real, useful day report drawn from the trip data.

import { previewTripDayContext } from './tripDay.js';
import { getRangeWeather, weatherCodeInfo } from '../data/weather.js';
import { CITY_TRANSIT, transitPayShort } from '../data/cityTransit.js';
import { dayClosedConflicts, isClosedOn } from '../data/closures.js';
import { buildChatSuggestions } from './tripChatContext.js';

// Slot → the badge label it prints as (matches the concierge's SLOT format).
const SLOT_LABELS = [
  ['morning', 'MORNING'], ['lunch', 'LUNCH'], ['afternoon', 'AFTERNOON'],
  ['dinner', 'DINNER'], ['evening', 'EVENING'],
];

function slotItems(day, key) {
  const v = day.slots?.[key];
  const arr = Array.isArray(v) ? v : (v ? [v] : []);
  return arr.filter((it) => it && it.type !== 'travel' && it.name);
}

// "SUN, JUL 14" to match the concierge header (noon local, so no TZ rollover).
function headerDate(dateISO) {
  const d = new Date(`${dateISO}T12:00:00`);
  const wd = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  return `${wd}, ${mon} ${d.getDate()}`;
}

export async function buildLocalBrief(trip) {
  const ctx = previewTripDayContext(trip);
  if (!ctx) return null;
  const { stop, day } = ctx;
  const cityId = stop.cityId || stop.id;

  // Weather — best-effort (live within the horizon, else seasonal normals).
  let wxLine = '';
  try {
    const wxMap = await getRangeWeather(stop.lat, stop.lng, [day.date]);
    const wx = wxMap && wxMap[day.date];
    if (wx && Number.isFinite(wx.tempF)) {
      wxLine = `${weatherCodeInfo(wx.code).label} · High ${Math.round(wx.tempF)}°F`;
    }
  } catch { /* weather optional */ }

  const out = [`### ${stop.name.toUpperCase()} — ${headerDate(day.date)}`];
  if (wxLine) out.push(wxLine);

  // Today's plan — one bullet per planned item, labeled by slot.
  const plan = [];
  SLOT_LABELS.forEach(([key, label]) => {
    slotItems(day, key).forEach((it) => {
      if (plan.length >= 6) return;
      const note = isClosedOn(it, day.date) ? ' — check hours, may be closed' : '';
      plan.push(`- **${label}** ${it.name}${note}`);
    });
  });
  if (plan.length) out.push('', '---', '', "### TODAY'S PLAN", ...plan);

  // Getting around — the city's primary mode + how to pay (public transit only).
  const t = CITY_TRANSIT[cityId];
  if (t && t.primary) {
    const around = [`- Around ${stop.name} — **${t.primary}**`];
    const pay = transitPayShort(cityId);
    if (pay) around.push(`- Pay — ${pay}`);
    out.push('', '---', '', '### GETTING AROUND', ...around);
  }

  // Heads up — any planned stop closed on today's weekday, else all clear.
  const heads = dayClosedConflicts(day)
    .slice(0, 3)
    .map(({ item }) => `- ${item.name} is closed today — reschedule it`);
  out.push('', '---', '', '### HEADS UP', ...(heads.length ? heads : ['- All clear today.']));

  const suggestions = (buildChatSuggestions(trip) || [])
    .slice(0, 6)
    .map((title) => ({ title: String(title) }));

  return {
    date: day.date,
    splash: `Your ${stop.name} day — ${plan.length} planned ${plan.length === 1 ? 'stop' : 'stops'}.`,
    brief: out.join('\n'),
    suggestions,
    at: 0,        // no timestamp → never counts as a "new" nightly run
    local: true,  // so the panel surfaces it but never auto-opens on it
  };
}

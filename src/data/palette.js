// Distinct, repeating per-stop color set, shared by the calendar, timeline, and
// map so a given stop reads in the same color everywhere. `hex` mirrors the
// Tailwind `-500` class for non-CSS contexts like Leaflet pins (fjord is a
// custom sage; the rest are stock Tailwind colors).
// Ordered to lead with the Nyhavn-poster primaries — red, yellow, blue, green —
// then orange, violet, teal, indigo, fuchsia. `hex` mirrors each Tailwind -500
// so the Leaflet pins match the UI exactly.
export const STOP_PALETTE = [
  { soft: 'bg-rose-100', edge: 'bg-rose-500', text: 'text-rose-800', chip: 'bg-rose-500', hex: '#f43f5e' },
  { soft: 'bg-amber-100', edge: 'bg-amber-500', text: 'text-amber-800', chip: 'bg-amber-500', hex: '#f59e0b' },
  { soft: 'bg-sky-100', edge: 'bg-sky-500', text: 'text-sky-800', chip: 'bg-sky-500', hex: '#0ea5e9' },
  { soft: 'bg-emerald-100', edge: 'bg-emerald-500', text: 'text-emerald-800', chip: 'bg-emerald-500', hex: '#10b981' },
  { soft: 'bg-orange-100', edge: 'bg-orange-500', text: 'text-orange-800', chip: 'bg-orange-500', hex: '#f97316' },
  { soft: 'bg-violet-100', edge: 'bg-violet-500', text: 'text-violet-800', chip: 'bg-violet-500', hex: '#8b5cf6' },
  { soft: 'bg-teal-100', edge: 'bg-teal-500', text: 'text-teal-800', chip: 'bg-teal-500', hex: '#14b8a6' },
  { soft: 'bg-indigo-100', edge: 'bg-indigo-500', text: 'text-indigo-800', chip: 'bg-indigo-500', hex: '#6366f1' },
  { soft: 'bg-fuchsia-100', edge: 'bg-fuchsia-500', text: 'text-fuchsia-800', chip: 'bg-fuchsia-500', hex: '#d946ef' },
];

export function stopColor(index) {
  return STOP_PALETTE[((index % STOP_PALETTE.length) + STOP_PALETTE.length) % STOP_PALETTE.length];
}

// Mute a vivid -500 hex for the dark basemap: blend toward a warm near-black so
// map pins/markers stop glaring while keeping enough hue to tell stops apart.
// `keep` is the share of the original retained (lower = dimmer).
export function dimForDark(hex, keep = 0.58) {
  const n = parseInt(hex.slice(1), 16);
  const base = 22; // mix toward ~#161616
  const ch = (shift) => {
    const v = (n >> shift) & 255;
    return Math.round(v * keep + base * (1 - keep));
  };
  const r = ch(16); const g = ch(8); const b = ch(0);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

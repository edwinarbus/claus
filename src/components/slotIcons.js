// Single source of truth mapping slot/bucket keys to custom icon components,
// so every place that labels a slot (the day plan, the add-to-slot picker, the
// lodging row, the assign menu) renders the same glyph instead of an emoji.
import { html } from '../html.js';
import {
  IconSunrise, IconSun, IconMoon, IconCoffee, IconUtensils, IconBed,
  IconEye, IconBoot,
} from './icons.js';

export const SLOT_ICON = {
  morning: IconSunrise, afternoon: IconSun, evening: IconMoon,
  breakfast: IconCoffee, lunch: IconUtensils, dinner: IconUtensils, lodging: IconBed,
};

// Per-daypart accent tint for slot headers (icon + label). Mid-tone shades so
// they read on both the cream light theme and the dark blue-gray surfaces.
export const SLOT_TINT = {
  morning: 'text-amber-500', afternoon: 'text-sky-600', evening: 'text-indigo-500',
  breakfast: 'text-orange-500', lunch: 'text-emerald-600', dinner: 'text-rose-500',
  lodging: 'text-violet-500',
};

export const BUCKET_ICON = { see: IconEye, do: IconBoot, eat: IconUtensils };

// Render a slot's glyph by key. Falls back to nothing when the key is unknown.
export function SlotGlyph({ slotKey, className = 'w-3.5 h-3.5' }) {
  const C = SLOT_ICON[slotKey];
  return C ? html`<${C} className=${className} />` : null;
}

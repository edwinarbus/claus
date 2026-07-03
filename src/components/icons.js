// Tiny inline SVG icons. Each takes an optional className.
import { html } from '../html.js';

const svg = (paths, vb = '0 0 24 24') => (props = {}) =>
  html`<svg viewBox=${vb} fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" class=${props.className || 'w-4 h-4'}
    aria-hidden="true">${paths}</svg>`;

export const IconCalendar = svg(html`<rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3M16 3v3" />`);
export const IconMap = svg(html`<path d="M9 4.5 3 7v13l6-2.5 6 2.5 6-2.5V4L15 6.5 9 4.5z" /><path d="M9 4.5v13M15 6.5v13" />`);
export const IconTimeline = svg(html`<circle cx="4.5" cy="6" r="2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="2" fill="currentColor" stroke="none" /><path d="M4.5 8v2M4.5 14v2" /><path d="M9 6h11M9 12h8.5M9 18h10" />`);
export const IconPlus = svg(html`<path d="M12 5v14M5 12h14" />`);
export const IconTrash = svg(html`<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />`);
export const IconChevronDown = svg(html`<path d="m6 9 6 6 6-6" />`);
export const IconChevronRight = svg(html`<path d="m9 6 6 6-6 6" />`);
export const IconChevronUp = svg(html`<path d="m6 15 6-6 6 6" />`);
export const IconX = svg(html`<path d="M6 6l12 12M18 6 6 18" />`);
export const IconEdit = svg(html`<path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M14 6l4 4" />`);
export const IconSliders = svg(html`<path d="M4 6h11M19 6h1M4 12h5M13 12h7M4 18h9M17 18h3" /><circle cx="17" cy="6" r="2" /><circle cx="11" cy="12" r="2" /><circle cx="15" cy="18" r="2" />`);
export const IconNote = svg(html`<path d="M5 4h14v12l-5 5H5z" /><path d="M14 21v-5h5" />`);
export const IconSun = svg(html`<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />`);
export const IconSunrise = svg(html`<path d="M3 18h18" /><path d="M8 18a4 4 0 0 1 8 0" /><path d="M12 3v6M9 6l3-3 3 3" />`);
export const IconSunset = svg(html`<path d="M3 18h18" /><path d="M8 18a4 4 0 0 1 8 0" /><path d="M12 9V3M9 6l3 3 3-3" />`);
export const IconMoon = svg(html`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />`);
export const IconDisplay = svg(html`<rect x="3" y="4.5" width="18" height="12.5" rx="2" /><path d="M8.5 21h7M12 17v4" />`);
export const IconExternal = svg(html`<path d="M14 4h6v6M20 4l-9 9M19 14v5H5V5h5" />`);
export const IconRoute = svg(html`<circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8 7h7a3 3 0 0 1 3 3v5M6 9v5a3 3 0 0 0 3 3h6" />`);
export const IconReset = svg(html`<path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4" />`);
export const IconHistory = svg(html`<path d="M3 12a9 9 0 1 0 2.2-6" /><path d="M3 4v4h4" /><path d="M12 7v5l3 2" />`);
export const IconUndo = svg(html`<path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" />`);
export const IconChat = svg(html`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />`);
export const IconSend = svg(html`<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />`);
export const IconGlobe = svg(html`<circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />`);
export const IconPaperclip = svg(html`<path d="m21.4 11.1-8.5 8.5a6 6 0 0 1-8.5-8.5l8.9-8.9a4 4 0 0 1 5.7 5.7l-8.9 8.9a2 2 0 0 1-2.8-2.8l8.5-8.5" />`);
export const IconCheck = svg(html`<path d="M5 12.5 10 17.5 19.5 7" />`);
export const IconInfo = svg(html`<circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5h.01" />`);
export const IconBell = svg(html`<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" />`);
export const IconGrip = svg(html`<circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none" /><circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none" /><circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none" />`);
export const IconEye = svg(html`<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />`);
export const IconEyeOff = svg(html`<path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" /><path d="M9.9 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a17.2 17.2 0 0 1-3.2 4.1M6.3 6.3A17.1 17.1 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 3.3-.6" />`);
export const IconTicket = svg(html`<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z" /><path d="M13.5 5v14" stroke-dasharray="1.6 2" />`);
export const IconBed = svg(html`<path d="M3 7v12M3 11h15a3 3 0 0 1 3 3v5M3 16h18" /><path d="M6.5 11V9.4a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4V11" />`);
export const IconWarning = svg(html`<path d="M10.3 4 2.5 18a1.6 1.6 0 0 0 1.4 2.4h16.2a1.6 1.6 0 0 0 1.4-2.4L13.7 4a1.6 1.6 0 0 0-2.7 0z" /><path d="M12 9.5v4" /><path d="M12 16.8h.01" />`);
export const IconPin = svg(html`<path d="M12 21s6.5-5.3 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15.7 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.4" />`);
export const IconHeat = svg(html`<path d="M10.5 13.4V5.5a1.7 1.7 0 0 1 3.4 0v7.9a3.6 3.6 0 1 1-3.4 0z" /><circle cx="12.2" cy="16.9" r="1.3" fill="currentColor" stroke="none" />`);
export const IconCold = svg(html`<path d="M12 2.5v19M4.4 7l15.2 10M19.6 7 4.4 17" /><path d="M9.6 4.8 12 7l2.4-2.2M9.6 19.2 12 17l2.4 2.2M5.2 9.4 5.8 12 3.2 13M18.8 9.4 18.2 12l2.6 1M5.2 14.6 7.8 14M18.8 14.6 16.2 14" />`);
export const IconCoffee = svg(html`<path d="M17 8h1.2a3 3 0 0 1 0 6.4H17" /><path d="M3.5 8h13.5v8a4 4 0 0 1-4 4H7.5a4 4 0 0 1-4-4z" /><path d="M7 2.5v2M10.5 2.5v2M14 2.5v2" />`);
export const IconUtensils = svg(html`<path d="M7 3v18M5 3v5.5a2 2 0 0 0 4 0V3" /><path d="M17 3c-1.6 0-2.6 2.1-2.6 5.2 0 2.6 1 4 2.6 4.2V21" />`);
export const IconCompass = svg(html`<circle cx="12" cy="12" r="9" /><path d="M15.6 8.4l-2 5.2-5.2 2 2-5.2z" />`);
export const IconBoot = svg(html`<path d="M8 3v8.5l-3 1.4A3.2 3.2 0 0 0 3.2 16H3v3h15a1.5 1.5 0 0 0 1.5-1.5c0-2.2-1.7-3.4-4-4.1L13 12V3z" /><path d="M3 17h15" />`);
export const IconClock = svg(html`<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />`);
export const IconLightbulb = svg(html`<path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.2 1 2.5h6c0-1.3.3-1.8 1-2.5A6 6 0 0 0 12 3z" />`);
export const IconSearch = svg(html`<circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />`);
export const IconPhone = svg(html`<rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" />`);
export const IconCreditCard = svg(html`<rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 9.5h19M6 14.5h4" />`);
export const IconJacket = svg(html`<path d="M8 3 4 5v6l2 1v9h12v-9l2-1V5l-4-2-4 2-4-2z" /><path d="M12 5v15" />`);

// Brand glyphs for the map deep-links. Apple is a solid silhouette in
// currentColor so it inherits the surrounding link colour; Google keeps its
// four-colour "G" for instant recognition.
export const IconApple = (props = {}) =>
  html`<svg viewBox="0 0 24 24" fill="currentColor" class=${props.className || 'w-4 h-4'} aria-hidden="true" overflow="visible">
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
  </svg>`;

export const IconGoogleG = (props = {}) =>
  html`<svg viewBox="0 0 48 48" class=${props.className || 'w-4 h-4'} aria-hidden="true" overflow="visible">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>`;

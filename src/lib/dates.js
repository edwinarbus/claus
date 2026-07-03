// Date helpers. Dates are stored as 'YYYY-MM-DD' strings and always parsed at
// local noon to dodge timezone off-by-one bugs.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parseISO(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function toISO(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// Whole days from a -> b (b minus a). Same day = 0.
export function daysBetween(aISO, bISO) {
  const a = parseISO(aISO);
  const b = parseISO(bISO);
  return Math.round((b - a) / 86400000);
}

// Inclusive list of date strings from start..end.
export function eachDate(startISO, endISO) {
  if (!startISO || !endISO) return [];
  const out = [];
  let cur = startISO;
  let guard = 0;
  while (daysBetween(cur, endISO) >= 0 && guard < 1000) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard += 1;
  }
  return out;
}

export function nightsBetween(startISO, endISO) {
  return Math.max(0, daysBetween(startISO, endISO));
}

// 'Jul 3'
export function formatShort(iso) {
  const d = parseISO(iso);
  if (!d) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// 'July 3'
export function formatLong(iso) {
  const d = parseISO(iso);
  if (!d) return '';
  return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`;
}

// '7/3'
export function formatNumericDate(iso) {
  const d = parseISO(iso);
  if (!d) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 'Fri, Jul 3'
export function formatWithWeekday(iso) {
  const d = parseISO(iso);
  if (!d) return '';
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// 'Jul 3 – 6'  (or 'Jul 30 – Aug 2' across months)
export function formatRange(startISO, endISO) {
  const a = parseISO(startISO);
  const b = parseISO(endISO);
  if (!a || !b) return '';
  if (a.getMonth() === b.getMonth()) {
    return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${b.getDate()}`;
  }
  return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${MONTHS[b.getMonth()]} ${b.getDate()}`;
}

// Two-line range for the timeline's narrow left date gutter.
// Same month → { line1:'Jul 13', line2:'– 17' }; across → { line1:'Jul 30', line2:'– Aug 2' }.
export function stackedRange(startISO, endISO) {
  const a = parseISO(startISO);
  const b = parseISO(endISO);
  if (!a || !b) return { line1: '', line2: '' };
  const line1 = `${MONTHS[a.getMonth()]} ${a.getDate()}`;
  const line2 = a.getMonth() === b.getMonth()
    ? `– ${b.getDate()}`
    : `– ${MONTHS[b.getMonth()]} ${b.getDate()}`;
  return { line1, line2 };
}

// Compact range for the timeline's left date column: "Jul 13–17" (same month)
// or "Jul 30–Aug 2" (across months). Tighter than formatRange (no spaces).
export function formatRangeCompact(startISO, endISO) {
  const a = parseISO(startISO);
  const b = parseISO(endISO);
  if (!a || !b) return '';
  if (a.getMonth() === b.getMonth()) return `${MONTHS[a.getMonth()]} ${a.getDate()}–${b.getDate()}`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()}–${MONTHS[b.getMonth()]} ${b.getDate()}`;
}

export function monthName(monthIndex) {
  return MONTHS_LONG[monthIndex];
}

export function shortMonth(monthIndex) {
  return MONTHS[monthIndex];
}

export const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Build a calendar matrix (weeks of 7) for a given year/month. Sunday-first.
// Cells outside the month are null.
export function monthMatrix(year, monthIndex) {
  const first = new Date(year, monthIndex, 1, 12);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  // JS getDay is already Sunday-first: 0=Sun..6=Sat.
  const startOffset = first.getDay();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toISO(new Date(year, monthIndex, d, 12)));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function todayISO() {
  return toISO(new Date());
}

// True if the date is strictly before today (already happened).
export function isPastISO(iso) {
  if (!iso) return false;
  return daysBetween(iso, todayISO()) > 0;
}

export function isSameOrAfter(aISO, bISO) {
  return daysBetween(bISO, aISO) >= 0;
}

export function clampISO(iso, minISO, maxISO) {
  if (minISO && daysBetween(iso, minISO) > 0) return minISO;
  if (maxISO && daysBetween(maxISO, iso) > 0) return maxISO;
  return iso;
}

// Day-of-year (1-366), used to look up climatology.
export function dayOfYear(iso) {
  const d = parseISO(iso);
  const start = new Date(d.getFullYear(), 0, 0, 12);
  return Math.round((d - start) / 86400000);
}

const MONTH_NAME_TO_NUM = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function monthNameToNum(name) {
  return MONTH_NAME_TO_NUM[String(name || '').toLowerCase().replace(/\./g, '')] || 0;
}

function namedPartsToISO(month, day, year) {
  const m = monthNameToNum(month);
  const d = Number(day);
  const y = Number(year);
  if (!m || !Number.isFinite(d) || d < 1 || d > 31 || !Number.isFinite(y)) return '';
  return toISO(new Date(y, m - 1, d, 12, 0, 0, 0));
}

// "July 25", "Jul 25", "25 July" (+ optional year) -> YYYY-MM-DD.
export function parseNamedDateInText(text, defaultYear) {
  const s = String(text || '').trim();
  if (!s) return '';
  const year = Number(defaultYear) || new Date().getFullYear();

  const monthFirst = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/);
  if (monthFirst) {
    const iso = namedPartsToISO(monthFirst[1], monthFirst[2], monthFirst[3] || year);
    if (iso) return iso;
  }

  const dayFirst = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})(?:,?\s*(\d{4}))?\b/);
  if (dayFirst) {
    const iso = namedPartsToISO(dayFirst[2], dayFirst[1], dayFirst[3] || year);
    if (iso) return iso;
  }

  return '';
}

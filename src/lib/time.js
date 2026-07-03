// Time-of-day helpers. Clock values are *stored* as 24h "HH:MM" strings — what
// the duration math (minutesBetweenClock) and older saved trips expect — but are
// always *shown* to travelers in 12-hour "7:07 PM" form. Input stays flexible:
// type a 24h hour (up to 24, folded to PM immediately) or a 12h hour plus AM/PM.

export function parseClock(value) {
  if (value == null || value === '') return null;
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, min };
}

// "HH:MM" (24h) -> "7:07 PM". On-the-hour times drop the minutes ("8 AM", not
// "8:00 AM"). Empty/invalid -> ''.
export function format12(value) {
  const p = parseClock(value);
  if (!p) return '';
  const mer = p.h >= 12 ? 'PM' : 'AM';
  let h12 = p.h % 12;
  if (h12 === 0) h12 = 12;
  const min = p.min ? `:${String(p.min).padStart(2, '0')}` : '';
  return `${h12}${min} ${mer}`;
}

// Stored 24h value -> editable 12h parts for the TimeField.
export function to12Parts(value) {
  const p = parseClock(value);
  if (!p) return { hour: '', minute: '', mer: 'AM' };
  const mer = p.h >= 12 ? 'PM' : 'AM';
  let h12 = p.h % 12;
  if (h12 === 0) h12 = 12;
  return { hour: String(h12), minute: String(p.min).padStart(2, '0'), mer };
}

// 12h edit parts -> stored 24h "HH:MM". A blank hour clears the time (returns '')
// so emptying the field removes it rather than defaulting to midnight.
export function partsTo24(hour, minute, mer) {
  if (hour === '' || hour == null) return '';
  let h = Number(hour);
  if (Number.isNaN(h)) return '';
  let m = Number(minute);
  if (Number.isNaN(m)) m = 0;
  h = ((h % 12) + 12) % 12;            // 12 -> 0, 1..11 unchanged
  if (mer === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${String(Math.min(Math.max(m, 0), 59)).padStart(2, '0')}`;
}

// Parse traveler/chat input (24h, 12h, compact) -> stored 24h "HH:MM".
export function parseFlexibleClock(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const as24 = parseClock(raw);
  if (as24) {
    return `${String(as24.h).padStart(2, '0')}:${String(as24.min).padStart(2, '0')}`;
  }

  const dotted = raw.match(/^(\d{1,2})\.(\d{2})$/);
  if (dotted) {
    const h = Number(dotted[1]);
    const min = Number(dotted[2]);
    if (h <= 23 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  const hm12 = raw.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/i);
  if (hm12) {
    const mer = /^p/i.test(hm12[3]) ? 'PM' : 'AM';
    return partsTo24(hm12[1], hm12[2] || '00', mer);
  }

  const compact = raw.match(/^(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)$/i);
  if (compact) {
    const mer = /^p/i.test(compact[2]) ? 'PM' : 'AM';
    return partsTo24(compact[1], '00', mer);
  }

  const hourOnly = raw.match(/^(\d{1,2})\s*(?:h|hr|hrs|hour)?$/i);
  if (hourOnly) {
    const h = Number(hourOnly[1]);
    if (h <= 23) return `${String(h).padStart(2, '0')}:00`;
  }

  return '';
}

// Convert clock literals in free text to 12-hour display ("6 PM", "6:30 PM").
export function formatTimesInText(value) {
  // The am/pm form is matched FIRST and as a whole — otherwise "6:00 PM" had its
  // bare "6:00" grabbed (→ "6 AM") leaving a dangling " PM" ("6 AM PM").
  return String(value || '').replace(
    /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b|\b(\d{1,2})(?::|\.)(\d{2})\b/gi,
    (match) => {
      const stored = parseFlexibleClock(match);
      return stored ? format12(stored) : match;
    },
  );
}

// Scroll the timeline plan to a stop, day, or slot after an edit or deep link.

function safeAreaInsetTop() {
  try {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;'
      + 'height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    return h || 0;
  } catch {
    return 0;
  }
}

function scrollElementIntoPlan(el) {
  if (!el) return false;
  const isDay = el.id?.startsWith('day-');
  const isSlot = el.dataset?.slotKey;
  if (isDay || isSlot) {
    const top = el.getBoundingClientRect().top + window.scrollY - (safeAreaInsetTop() + 15);
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    return true;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

function findPlanTarget({ stopId, date, slotKey }) {
  if (stopId && date && slotKey) {
    const slot = document.querySelector(
      `[data-stop-id="${stopId}"][data-date="${date}"][data-slot-key="${slotKey}"]`,
    );
    if (slot) return slot;
  }
  if (stopId && date) {
    const day = document.getElementById(`day-${stopId}-${date}`);
    if (day) return day;
  }
  if (stopId) return document.getElementById(`stop-${stopId}`);
  return null;
}

/** Scroll to stop / day / slot. Waits for expand + day planner to mount. */
export function scrollToPlanTarget(target, { delay = 320, retryDelay = 300 } = {}) {
  const { stopId, date, slotKey } = target || {};
  if (!stopId) return;
  const attempt = () => scrollElementIntoPlan(findPlanTarget({ stopId, date, slotKey }));
  window.setTimeout(() => {
    const el = findPlanTarget({ stopId, date, slotKey });
    if (el) {
      scrollElementIntoPlan(el);
      return;
    }
    if (retryDelay > 0) window.setTimeout(attempt, retryDelay);
  }, delay);
}

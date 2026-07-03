// Pointer-based touch drag for reordering day-plan items across a day's slots.
//
// HTML5 drag-and-drop never fires on touch, so on touch/pen we drive a custom
// drag: a floating ghost follows the finger, we hit-test slots/items via
// `elementFromPoint` + `data-` attributes, draw an insertion line, autoscroll
// near the viewport edges, and on release dispatch the SAME reducer actions the
// desktop path uses (REORDER_SLOT for same slot, REMOVE + ASSIGN across slots).

const EDGE = 72; // px from the viewport top/bottom that triggers autoscroll
const MAX_SCROLL = 16; // px per frame at the very edge

let active = null;

// Begin a touch drag from a grab handle. payload:
//   item     – the full slot item object (carried into the target slot)
//   source   – { stopId, date, slotKey, itemId }
//   itemEl   – the SlotItem DOM node (cloned for the ghost, faded as the "hole")
//   dispatch – store dispatch
export function beginTouchDrag(e, { item, source, itemEl, dispatch }) {
  if (active || !itemEl) return;
  e.preventDefault();
  e.stopPropagation();

  const rect = itemEl.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;

  const ghost = itemEl.cloneNode(true);
  ghost.classList.add('drag-ghost');
  Object.assign(ghost.style, {
    position: 'fixed', left: '0', top: '0', margin: '0',
    width: `${rect.width}px`, zIndex: '10000', pointerEvents: 'none',
  });
  document.body.appendChild(ghost);

  const line = document.createElement('div');
  line.className = 'touch-drop-line';
  line.style.display = 'none';
  document.body.appendChild(line);

  itemEl.classList.add('is-dragging');
  document.body.classList.add('touch-dragging');

  let curX = e.clientX;
  let curY = e.clientY;
  let target = null; // { stopId, date, slotKey, beforeId }
  let raf = 0;

  function placeGhost() {
    ghost.style.transform =
      `translate(${curX - offsetX}px, ${curY - offsetY}px) rotate(2deg) scale(1.03)`;
  }

  function clearTarget() {
    target = null;
    line.style.display = 'none';
  }

  function updateTarget() {
    ghost.style.display = 'none';
    const under = document.elementFromPoint(curX, curY);
    ghost.style.display = '';
    const slotEl = under && under.closest('[data-droppable-slot]');
    if (!slotEl) return clearTarget();

    const accepts = (slotEl.dataset.accepts || '').split(',');
    if (!accepts.includes(item.type)) return clearTarget();

    const body = slotEl.querySelector('[data-slot-body]') || slotEl;
    const bodyRect = body.getBoundingClientRect();
    const slotRect = slotEl.getBoundingClientRect();
    const itemEls = Array.from(slotEl.querySelectorAll('[data-item-id]'));

    const GAP = 3; // px the line floats off a card edge
    let beforeId = null;
    let lineY = bodyRect.top + 2; // empty slot: sit near the top
    if (itemEls.length) {
      const first = itemEls[0].getBoundingClientRect();
      if (curY < first.top) {
        // Above the first card → drop before it; line hugs its top edge.
        beforeId = itemEls[0].dataset.itemId;
        lineY = first.top - GAP;
      } else {
        // Otherwise the line sits UNDERNEATH the card the finger is over (drop
        // right after it); past the last card it tucks under the last one.
        let chosen = itemEls[itemEls.length - 1];
        for (let i = 0; i < itemEls.length; i++) {
          const r = itemEls[i].getBoundingClientRect();
          if (curY <= r.bottom) {
            chosen = itemEls[i];
            beforeId = itemEls[i + 1] ? itemEls[i + 1].dataset.itemId : null;
            break;
          }
        }
        lineY = chosen.getBoundingClientRect().bottom + GAP;
      }
    }

    target = { stopId: slotEl.dataset.stopId, date: slotEl.dataset.date, slotKey: slotEl.dataset.slotKey, beforeId };
    // Full width of the section (the whole slot), not just the inner item column.
    Object.assign(line.style, {
      display: 'block',
      left: `${slotRect.left}px`,
      width: `${slotRect.width}px`,
      top: `${lineY}px`,
    });
  }

  function tick() {
    let dy = 0;
    if (curY < EDGE) dy = -MAX_SCROLL * (1 - curY / EDGE);
    else if (curY > window.innerHeight - EDGE) {
      dy = MAX_SCROLL * (1 - (window.innerHeight - curY) / EDGE);
    }
    if (dy) { window.scrollBy(0, dy); updateTarget(); }
    raf = requestAnimationFrame(tick);
  }

  function onMove(ev) {
    ev.preventDefault();
    curX = ev.clientX;
    curY = ev.clientY;
    placeGhost();
    updateTarget();
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    ghost.remove();
    line.remove();
    itemEl.classList.remove('is-dragging');
    document.body.classList.remove('touch-dragging');
    active = null;
  }

  function onUp(ev) {
    curX = ev.clientX;
    curY = ev.clientY;
    updateTarget();
    if (target) applyDrop(source, target, item, dispatch);
    cleanup();
  }

  function onCancel() { cleanup(); }

  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  active = { cleanup };

  placeGhost();
  updateTarget();
  raf = requestAnimationFrame(tick);
}

function applyDrop(source, target, item, dispatch) {
  const sameSlot = source.stopId === target.stopId
    && source.date === target.date
    && source.slotKey === target.slotKey;
  if (sameSlot) {
    // Dropping right where it sits is a no-op (and would otherwise confuse the
    // reducer, which removes the item before searching for beforeId).
    if (target.beforeId === source.itemId) return;
    dispatch({ type: 'REORDER_SLOT', stopId: source.stopId, date: source.date, slotKey: source.slotKey, itemId: source.itemId, beforeId: target.beforeId });
    return;
  }
  dispatch({ type: 'REMOVE_FROM_SLOT', stopId: source.stopId, date: source.date, slotKey: source.slotKey, itemId: source.itemId });
  dispatch({ type: 'ASSIGN_TO_SLOT', stopId: target.stopId, date: target.date, slotKey: target.slotKey, item });
}

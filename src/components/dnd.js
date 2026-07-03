// Tiny module-singleton for drag payloads. Works within the single page and
// lets drop targets read the dragged item's type synchronously during dragover
// (which the HTML5 dataTransfer API doesn't reliably expose).

export const drag = { item: null, source: null };

export function startDrag(item, source) {
  drag.item = item;
  drag.source = source || null;
}

export function endDrag() {
  drag.item = null;
  drag.source = null;
}

// Make the floating drag ghost (the thing that follows the cursor) look like the
// card is being physically picked up — tilted, scaled up, deep shadow. HTML5
// drag only snapshots a *copy* of the element at dragstart, so we clone the node,
// tilt the clone, and hand it to setDragImage. The original is left in place and
// styled as a faded placeholder by the caller (.is-dragging). Returns nothing.
export function setTiltDragImage(e, node) {
  const dt = e && e.dataTransfer;
  if (!node || !dt || typeof dt.setDragImage !== 'function') return;
  try {
    const rect = node.getBoundingClientRect();
    const clone = node.cloneNode(true);
    clone.classList.remove('is-dragging');
    clone.classList.add('drag-ghost');
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.margin = '0';
    // Render it for real (so the browser can rasterize it) but off to the side
    // so the user never sees the clone itself — only the captured drag image.
    clone.style.position = 'fixed';
    clone.style.top = '0';
    clone.style.left = '-10000px';
    clone.style.pointerEvents = 'none';
    document.body.appendChild(clone);
    const x = e.clientX != null ? e.clientX - rect.left : rect.width / 2;
    const y = e.clientY != null ? e.clientY - rect.top : rect.height / 2;
    dt.setDragImage(clone, x, y);
    setTimeout(() => clone.remove(), 0);
  } catch { /* setDragImage is best-effort; ignore failures */ }
}

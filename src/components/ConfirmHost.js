import { html, useState, useEffect, useRef } from '../html.js';
import { createPortal } from 'react-dom';
import { registerConfirm } from '../lib/confirmDialog.js';

// Renders the native-style confirm/action sheet driven by confirmDialog(). One
// instance, mounted once near the app root. Mobile: a bottom action sheet that
// slides up over a dimmed scrim; desktop: a centred dialog. Esc / scrim tap /
// Cancel resolve false; the primary button resolves true.
export function ConfirmHost() {
  const [req, setReq] = useState(null);
  const [shown, setShown] = useState(false);
  const closing = useRef(false);

  useEffect(() => {
    registerConfirm((r) => { closing.current = false; setReq(r); });
    return () => registerConfirm(null);
  }, []);

  // Animate in once mounted; lock background scroll while open.
  useEffect(() => {
    if (!req) { setShown(false); return undefined; }
    const raf = requestAnimationFrame(() => setShown(true));
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { cancelAnimationFrame(raf); document.body.style.overflow = prev; };
  }, [req]);

  function resolve(value) {
    if (!req || closing.current) return;
    closing.current = true;
    const done = req.resolve;
    setShown(false);
    setTimeout(() => { setReq(null); done(value); }, 220);
  }

  useEffect(() => {
    if (!req) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') resolve(false);
      if (e.key === 'Enter') resolve(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  if (!req) return null;
  const destructive = req.tone === 'destructive';
  const hasCancel = req.cancelLabel !== null;

  return createPortal(html`<div
    class=${`confirm-scrim ${shown ? 'is-open' : ''}`}
    role="dialog" aria-modal="true"
    onClick=${() => resolve(false)}>
    <div class=${`confirm-sheet gg-rim ${shown ? 'is-open' : ''}`} onClick=${(e) => e.stopPropagation()}>
      <div class="confirm-sheet-body">
        ${req.title && html`<h2 class="confirm-sheet-title">${req.title}</h2>`}
        ${req.message && html`<p class="confirm-sheet-message">${req.message}</p>`}
      </div>
      <div class="confirm-sheet-actions">
        <button type="button" autofocus
          class=${`confirm-btn confirm-btn--primary ${destructive ? 'confirm-btn--destructive' : ''}`}
          onClick=${() => resolve(true)}>${req.confirmLabel || 'OK'}</button>
        ${hasCancel && html`<button type="button" class="confirm-btn confirm-btn--cancel"
          onClick=${() => resolve(false)}>${req.cancelLabel || 'Cancel'}</button>`}
      </div>
    </div>
  </div>`, document.body);
}

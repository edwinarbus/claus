import { html, useState, useEffect, useRef } from '../html.js';
import { BlockSpinner } from './BlockSpinner.js';

const MIN_SHOW_MS = 180;
const FADE_MS = 220;
export const SYNC_LOAD_EXIT_MS = MIN_SHOW_MS + FADE_MS;

// Light veil + centered spinner while remote sync runs; fades out to reveal the
// cached UI underneath (no skeleton, no backdrop-filter animation — those flash).
export function SyncLoadingOverlay({ active }) {
  const [mounted, setMounted] = useState(active);
  const [hiding, setHiding] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active) {
      shownAt.current = Date.now();
      setMounted(true);
      setHiding(false);
      return undefined;
    }
    if (!mounted) return undefined;

    const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - shownAt.current));
    let fadeTimer;
    const hideTimer = setTimeout(() => {
      setHiding(true);
      fadeTimer = setTimeout(() => {
        setMounted(false);
        setHiding(false);
      }, FADE_MS);
    }, wait);

    return () => {
      clearTimeout(hideTimer);
      clearTimeout(fadeTimer);
    };
  }, [active, mounted]);

  if (!mounted) return null;

  return html`<div
    class=${`sync-load-overlay fixed inset-0 z-30 grid place-items-center ${hiding ? 'is-hiding' : ''}`}
    aria-live="polite"
    aria-busy=${!hiding}
    role="status"
    aria-label="Loading trip">
    <div class="sync-load-stack" aria-hidden="true">
      <${BlockSpinner} size="lg" className="sync-load-spinner" />
    </div>
  </div>`;
}

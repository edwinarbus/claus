import { createRoot } from 'react-dom/client';
import { html } from './html.js';
import { TripProvider } from './store/store.js';
import { prefetchRemoteTripRow } from './store/sync.js';
import { App } from './components/App.js';
import { registerServiceWorker } from './lib/push.js';
import { initTheme } from './lib/theme.js';

// Resolve + apply the saved theme and start listening for OS changes. The inline
// <head> script already set the class for first paint; this re-runs the same
// logic to bind the media-query listener and reconcile any race.
initTheme();

// Start the shared-trip fetch before React mounts so the PWA doesn't sit on
// stale localStorage while Supabase + esm.sh warm up.
prefetchRemoteTripRow();

const root = createRoot(document.getElementById('root'));
root.render(html`<${TripProvider}><${App} /><//>`);

// Keep the push service worker registered/current. It handles notifications
// only; fetches stay network-first.
registerServiceWorker();

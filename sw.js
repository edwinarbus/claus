// Scandiplan service worker - exists for Web Push notifications.
// No fetch caching: the app is a no-build static site behind Vercel's CDN and
// stays network-first by design.

const DEFAULT_NOTIFICATION = {
  title: 'Trip reminder',
  body: '',
  tag: 'scandiplan-brief',
  url: './',
};

function stripSourceLabel(text) {
  return String(text || '')
    .replace(/\s*(?:[-–—|•·]\s*)?from\s+Scandiplan\b[:.]?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function readPayload(event) {
  if (!event.data) return DEFAULT_NOTIFICATION;
  try {
    return { ...DEFAULT_NOTIFICATION, ...event.data.json() };
  } catch {
    try {
      const body = event.data.text();
      return { ...DEFAULT_NOTIFICATION, body: body || DEFAULT_NOTIFICATION.body };
    } catch {
      return DEFAULT_NOTIFICATION;
    }
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Payload is JSON from api/morning-brief.js or api/push.js:
// { title, body, url, tag, renotify, editor }.
self.addEventListener('push', (event) => {
  const data = readPayload(event);
  const title = stripSourceLabel(data.title) || DEFAULT_NOTIFICATION.title;
  const body = stripSourceLabel(data.body);
  const options = {
    body,
    tag: data.tag || DEFAULT_NOTIFICATION.tag,
    renotify: data.renotify === true,
    icon: './favicon.png',
    badge: './favicon.png',
    data: { url: data.url || DEFAULT_NOTIFICATION.url },
  };

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const visible = clients.filter((client) => client.visibilityState === 'visible');
      if (data.tag === 'scandiplan-plan-change' && visible.length) {
        visible.forEach((client) => {
          client.postMessage({
            type: 'plan-change',
            title,
            body,
            editor: data.editor || '',
          });
        });
        return undefined;
      }
      return self.registration.showNotification(title, options);
    }),
  );
});

// Tapping the notification focuses the open app or launches it. An already
// open app also gets the notification's deep link via postMessage — focusing
// alone would leave it wherever it was, but a morning-brief tap should land on
// the welcome screen (./?welcome=1, handled in App.js).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.postMessage({ type: 'notification-tap', url });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

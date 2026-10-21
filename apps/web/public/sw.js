// Service worker: lets phones offer "Install app" / "Add to Home screen", and
// shows print alerts (Web Push from the bridge's relay, see apps/device-relay)
// with the page closed. It caches nothing. Every request goes to the network as before, so a new
// deploy's JS and engine always arrive together (a cached engine against new JS
// breaks slicing). Page loads with no network get a short offline note.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><meta name="viewport" content="width=device-width"><title>Cloud Slicer</title>' +
            '<body style="font:16px system-ui;padding:24px;background:#0f1114;color:#e6e8eb">' +
            '<p>Cloud Slicer needs an internet connection. Reconnect and reload.</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        ),
    ),
  );
});

// A print alert: {title, body, image?, tag, printer} (AlertPush in src/device/alert-text.ts).
self.addEventListener('push', (event) => {
  let a;
  try {
    a = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(a.title || 'Cloud Slicer', {
      body: a.body || '',
      tag: a.tag,
      renotify: Boolean(a.tag),
      icon: '/icons/icon-192.png',
      image: a.image,
      data: { printer: a.printer },
    }),
  );
});

// Tapping an alert opens the Device tab on its printer: in an open tab if there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const printer = event.notification.data?.printer ?? '';
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
      if (tab) {
        tab.postMessage({ alert: printer });
        return tab.focus();
      }
      return self.clients.openWindow(`/#alert=${encodeURIComponent(printer)}`);
    })(),
  );
});

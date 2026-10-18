// Service worker: only here so phones offer "Install app" / "Add to Home screen".
// It caches nothing. Every request goes to the network as before, so a new
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

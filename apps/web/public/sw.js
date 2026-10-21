// Service worker: here so phones offer "Install app" / "Add to Home screen",
// and so the installed app shows up in Android's Share menu for model files.
// It caches no part of the app. Every request goes to the network as before,
// so a new deploy's JS and engine always arrive together (a cached engine
// against new JS breaks slicing). Page loads with no network get a short
// offline note.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Files shared to the app (manifest share_target) wait here until the page
// opens them (src/lib/share-target.ts).
const SHARED = 'shared-files';

async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open(SHARED);
  for (const key of await cache.keys()) await cache.delete(key);
  let i = 0;
  for (const file of form.getAll('files')) {
    if (typeof file === 'string') continue;
    await cache.put(
      `/shared-files/${i++}`,
      new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } }),
    );
  }
  return Response.redirect('/?shared=1', 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(receiveShare(event.request).catch(() => Response.redirect('/', 303)));
    return;
  }
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

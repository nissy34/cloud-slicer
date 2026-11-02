// Service worker: here so phones offer "Install app" / "Add to Home screen",
// so the installed app shows up in Android's Share menu for model files, and to
// show print alerts (Web Push from the bridge's relay, see apps/device-relay)
// with the page closed. It caches no part of the app. Every request goes to the
// network as before, so a new deploy's JS and engine always arrive together (a
// cached engine against new JS breaks slicing). Page loads with no network get
// a short offline note. It also lets the Device tab play a timelapse as it
// arrives: the video player asks /timelapse-stream/<id> with a Range, and the
// page that opened it answers from the printer (src/device/timelapse.ts).
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

// One Range of a timelapse, asked of the page that is playing it.
async function timelapseStream(event, id) {
  const client = (event.clientId && (await self.clients.get(event.clientId))) || (await self.clients.matchAll({ type: 'window' }))[0];
  if (!client) return new Response('', { status: 404 });
  const answer = await new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ status: 504, headers: {}, body: new ArrayBuffer(0) }), 60000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data);
    };
    client.postMessage({ timelapseStream: id, range: event.request.headers.get('Range') }, [channel.port2]);
  });
  return new Response(answer.status === 416 || answer.status >= 400 ? null : answer.body, { status: answer.status, headers: answer.headers });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && url.pathname.startsWith('/timelapse-stream/')) {
    event.respondWith(timelapseStream(event, url.pathname.slice('/timelapse-stream/'.length)));
    return;
  }
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

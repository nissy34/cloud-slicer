// The holder for printer pages (the Device tab's "Open page"). A printer's own
// page (paxx12's remote screen, a camera's player page) runs on the relay's
// address, never on Cloud Slicer's, so it can't reach the signed-in site. The
// site frames shell.html?sid=<random> and hands it a MessagePort; the shell
// starts sw.js, whose scope is v/, and frames v/<sid>/<page path>. Every
// request that page makes goes from the service worker to the shell, which
// passes it (with a port for the answer) to the site; the site carries it to
// the bridge and answers on that port with {status, headers, body} or {error}.

/** Headers every holder answer carries: the site is cross-origin isolated, so its frames must opt in. */
export const PAGE_ISOLATION = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export const pageShell = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Printer page</title>
<style>
html, body { margin: 0; height: 100%; background: #000; color: #aaa; font: 14px system-ui, sans-serif; overflow: hidden; }
iframe { border: 0; width: 100%; height: 100%; display: block; }
p { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; text-align: center; padding: 16px; }
</style>
</head>
<body>
<p id="note">Opening the page…</p>
<script>
const sid = new URLSearchParams(location.search).get('sid') || '';
const note = document.getElementById('note');
let site = null;
const fail = (message) => {
  note.textContent = message;
  if (site) site.postMessage({ type: 'error', message });
};
// Requests from the service worker go to the site, with the port the answer comes back on.
const fromWorker = (e) => {
  const d = e.data;
  if (!site || !d || d.type !== 'page-request' || d.sid !== sid || !e.ports[0]) return;
  site.postMessage({ type: 'request', method: d.method, path: d.path, headers: d.headers, body: d.body }, d.body ? [e.ports[0], d.body] : [e.ports[0]]);
};
addEventListener('message', async (e) => {
  const d = e.data;
  if (e.source !== parent || site || !d || d.type !== 'cloud-slicer-page' || !e.ports[0] || !/^[\\w-]{8,64}$/.test(sid)) return;
  site = e.ports[0];
  if (!('serviceWorker' in navigator)) return fail('This browser cannot open printer pages here.');
  try {
    navigator.serviceWorker.onmessage = fromWorker;
    const reg = await navigator.serviceWorker.register('sw.js', { scope: 'v/' });
    const worker = reg.installing || reg.waiting || reg.active;
    if (worker && worker.state !== 'activated')
      await new Promise((ok) => worker.addEventListener('statechange', () => worker.state === 'activated' && ok()));
  } catch {
    return fail('This browser cannot open printer pages here. Try Chrome, Edge or Safari, or turn off strict tracking protection for this site.');
  }
  const path = String(d.path || '/');
  const frame = document.createElement('iframe');
  frame.title = 'Printer page';
  frame.allow = 'fullscreen';
  frame.src = 'v/' + sid + (path.startsWith('/') ? path : '/' + path);
  frame.onload = () => note.remove();
  document.body.append(frame);
  site.postMessage({ type: 'ready' });
});
</script>
</body>
</html>
`;

export const pageWorker = `// Printer pages: hands every request of a framed printer page to the shell that framed it.
const HEADERS = ['accept', 'accept-language', 'content-type', 'if-none-match', 'if-modified-since', 'range'];
const ISOLATION = { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const scope = self.registration.scope;
  if (!e.request.url.startsWith(scope)) return;
  const rest = e.request.url.slice(scope.length);
  const m = /^([\\w-]{8,64})(\\/[^#]*)/.exec(rest);
  if (!m) return;
  e.respondWith(answer(e.request, m[1], m[2]));
});
const plain = (status, text) => new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...ISOLATION } });
async function answer(req, sid, path) {
  const shells = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const shell = shells.find((c) => new URL(c.url).searchParams.get('sid') === sid);
  if (!shell) return plain(502, 'The printer page was closed.');
  const headers = {};
  for (const h of HEADERS) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  const ch = new MessageChannel();
  const reply = new Promise((ok) => {
    ch.port1.onmessage = (e) => ok(e.data);
    setTimeout(() => ok({ error: 'The printer did not answer in time.' }), 30000);
  });
  shell.postMessage({ type: 'page-request', sid, method: req.method, path, headers, body }, body ? [ch.port2, body] : [ch.port2]);
  const a = await reply;
  ch.port1.close();
  if (!a || a.error) return plain(502, (a && a.error) || 'No answer from the printer.');
  const out = new Headers(a.headers || {});
  for (const [k, v] of Object.entries(ISOLATION)) out.set(k, v);
  const moved = out.get('Location');
  if (moved && moved.startsWith('/')) out.set('Location', self.registration.scope + sid + moved);
  const empty = req.method === 'HEAD' || a.status === 204 || a.status === 304 || (a.status >= 100 && a.status < 200);
  return new Response(empty ? null : a.body, { status: a.status < 200 ? 502 : a.status, headers: out });
}
`;

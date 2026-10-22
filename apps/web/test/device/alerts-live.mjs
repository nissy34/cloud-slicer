#!/usr/bin/env node
// Print alerts end to end, with no real printer and no real push service: the
// bridge watches a mock printer (mock-printer.mjs), the relay (wrangler dev with
// PUSH_TEST_ENDPOINTS=1 and a VAPID_KEY) sends Web Push to a pretend push
// service here, and this script decrypts each message as a browser would.
//
//   node test/device/alerts-live.mjs http://127.0.0.1:8796 [--app <bridge app>]
//
// The relay must not want tickets (no RELAY_TICKET_PUBLIC_KEY). It prints on the
// MOCK printer only.
import { createECDH, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeConfig, bridgeProgram, browserKey, startBridge } from './go-bridge.mjs';
import { startMockPrinter } from './mock-printer.mjs';

// The same library the relay uses, from its own install, to read the messages back.
const ece = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../../device-relay/package.json'))('http_ece');

const relay = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(relay)) throw new Error('usage: alerts-live.mjs <relay url>');
const app = process.argv.indexOf('--app') > 0 ? process.argv[process.argv.indexOf('--app') + 1] : null;
const timeout = setTimeout(() => {
  console.error('ALERTS LIVE FAIL: timed out');
  process.exit(1);
}, 240_000);

// A pretend browser push subscription: its own keys, like pushManager.subscribe makes.
const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const auth = randomBytes(16);
const pushes = [];
const push = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      if (!/^vapid t=.+, k=.+/.test(req.headers.authorization ?? '')) throw new Error('no VAPID signature');
      const text = ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth.toString('base64url') }).toString('utf8');
      pushes.push({ path: req.url, urgency: req.headers.urgency, ...JSON.parse(text) });
      res.writeHead(req.url.includes('gone') ? 410 : 201).end();
    } catch (e) {
      console.error(`push service: ${e.message}`);
      res.writeHead(400).end();
    }
  });
});
await new Promise((r) => push.listen(0, '127.0.0.1', r));
const endpoint = `http://127.0.0.1:${push.address().port}/push/${randomBytes(6).toString('hex')}`;
const subscription = { endpoint, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: auth.toString('base64url') } };

const mock = await startMockPrinter({ generic: true });
const cfg = { relay, bridgeId: `ci-alerts-${randomBytes(6).toString('base64url')}`, key: randomBytes(24).toString('base64url'), printers: [{ id: 'voron', name: 'Voron-mock', url: mock.url, apiKey: '' }] };
const bridge = startBridge(app ?? bridgeProgram(), bridgeConfig(cfg), { log: (m) => console.log(`bridge: ${m}`) });

const until = async (what, fn, ms = 60_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what} (pushes so far: ${JSON.stringify(pushes.map((p) => p.title))})`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

/** A pretend Device tab on the printer, making JSON-RPC calls through the relay. */
async function tab() {
  const ws = new WebSocket(`${relay.replace(/^http/, 'ws')}/v1/bridges/${cfg.bridgeId}/client?key=${browserKey(cfg.key)}&printer=voron`);
  const pending = new Map();
  let next = 1;
  let agent = 'offline';
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'notify_bridge_status') agent = m.params[0].agent;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.rej(new Error(m.error.message));
    else p.res(m.result);
  };
  await new Promise((r, j) => ((ws.onopen = r), (ws.onclose = (e) => j(new Error(`closed: ${e.code} ${e.reason}`)))));
  await until('the bridge online', () => agent === 'online', 20_000);
  const call = (method, params) =>
    new Promise((res, rej) => {
      const id = `t${next++}`;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  return { call, close: () => ws.close() };
}

const printOnce = async (t) => {
  await t.call('printer.print.start', { filename: 'calibration_cube.gcode' });
};

try {
  const info = await (await fetch(`${relay}/v1/info`)).json();
  if (!info.push || Buffer.from(info.push, 'base64url').length !== 65) throw new Error(`the relay has no push key: ${JSON.stringify(info)}`);
  console.log('relay offers a push key');
  const t = await tab();

  const refused = await t.call('relay.alerts', { op: 'set', endpoint: 'https://push.example.com/x', keys: subscription.keys, prefs: { events: ['finished'] } }).then(
    () => null,
    (e) => e.message,
  );
  if (!refused) throw new Error('the relay took a push address that is no push service');
  console.log(`a made-up push address is refused: ${refused}`);

  const prefs = { events: ['failed', 'paused', 'error', 'finished', 'started', 'layer1', 'progress'], percents: [50], hours: 0, layer: 10, pictures: true };
  // The browser's clock, for "done about 14:35" in its own time zone.
  const saved = await t.call('relay.alerts', { op: 'set', ...subscription, clock: { timeZone: 'Asia/Jerusalem', hour12: false }, prefs });
  if (saved.prefs?.layer !== 10) throw new Error(`alerts not saved: ${JSON.stringify(saved)}`);
  const got = await t.call('relay.alerts', { op: 'get', endpoint });
  if (JSON.stringify(got.prefs.events) !== JSON.stringify(prefs.events)) throw new Error(`alerts read back wrong: ${JSON.stringify(got)}`);

  await t.call('relay.alerts', { op: 'test', endpoint });
  await until('the test alert', () => pushes.find((p) => p.title === 'Test alert'));
  console.log('test alert arrived, decrypted:', JSON.stringify(pushes.at(-1)));

  // A whole print on the mock (about 30 s): started, first layer, layer 10, 50%, finished with a picture.
  await new Promise((r) => setTimeout(r, 1500));
  await printOnce(t);
  const want = ['Printing calibration_cube', 'First layer done: check it stuck', 'Layer 10 of 50 done', 'calibration_cube 50% done', 'calibration_cube finished'];
  for (const title of want) await until(title, () => pushes.find((p) => p.title === title));
  const finished = pushes.find((p) => p.title === 'calibration_cube finished');
  if (finished.printer !== `${cfg.bridgeId}.voron` || !finished.body.startsWith('Voron-mock')) throw new Error(`finished alert: ${JSON.stringify(finished)}`);
  if (!finished.image) throw new Error('the finished alert has no camera picture');
  // Where the print stands: progress, layer, time left with the clock time, filament (the mock file: 50 layers, 2.7 m, 8 g).
  const half = pushes.find((p) => p.title === 'calibration_cube 50% done');
  if (!/^Voron-mock · layer \d+ of 50\n.*left · done about \d{1,2}:\d{2}( [AP]M)?\nfilament [\d.]+ g of 8 g$/.test(half.body)) throw new Error(`50% alert text: ${JSON.stringify(half.body)}`);
  if (!/^Voron-mock · \d+ min \(estimate 1 h\)\n/.test(finished.body) || !/8 g filament · 50 layers$/.test(finished.body)) throw new Error(`finished alert text: ${JSON.stringify(finished.body)}`);
  const pic = await fetch(finished.image);
  if (!pic.ok || (await pic.arrayBuffer()).byteLength < 50) throw new Error(`the picture can't be fetched (${pic.status})`);
  if (pushes.find((p) => p.title.startsWith('Printing'))?.image) throw new Error('"Printing" carries a picture; only key alerts should');
  console.log(`a whole print: ${want.length} alerts in order, the finished one with a picture`);
  for (const p of [half, finished]) console.log(`  ${p.title}: ${JSON.stringify(p.body)}`);

  const after = await t.call('relay.alerts', { op: 'get', endpoint });
  if (after.prefs.layer !== null) throw new Error(`"after layer N" was not cleared when the print ended: ${JSON.stringify(after)}`);
  console.log('"after layer N" cleared once the print ended');

  // Pause, then cancel.
  const before = pushes.length;
  await printOnce(t);
  await until('started again', () => pushes.slice(before).find((p) => p.title === 'Printing calibration_cube'));
  await t.call('printer.print.pause', {});
  const paused = await until('paused', () => pushes.slice(before).find((p) => p.title === 'Print paused'));
  if (!/^Voron-mock · calibration_cube · \d+% · layer \d+ of 50/.test(paused.body)) throw new Error(`paused alert text: ${JSON.stringify(paused.body)}`);
  if (paused.urgency !== 'high') throw new Error('a pause is not sent as urgent');
  await t.call('printer.print.cancel', {});
  const cancelled = await until('cancelled', () => pushes.slice(before).find((p) => p.title === 'calibration_cube was cancelled'));
  if (!/^Voron-mock · stopped at \d+%, layer \d+ of 50/.test(cancelled.body)) throw new Error(`cancelled alert text: ${JSON.stringify(cancelled.body)}`);
  console.log('pause and cancel alerts arrived, urgent');
  for (const p of [paused, cancelled]) console.log(`  ${p.title}: ${JSON.stringify(p.body)}`);

  // Alerts off: nothing more comes.
  const off = await t.call('relay.alerts', { op: 'set', endpoint, prefs: null });
  if (off.prefs !== null) throw new Error('alerts not turned off');
  const quiet = pushes.length;
  await printOnce(t);
  await new Promise((r) => setTimeout(r, 4000));
  await t.call('printer.print.cancel', {});
  await new Promise((r) => setTimeout(r, 2000));
  if (pushes.length !== quiet) throw new Error(`alerts kept coming after they were turned off: ${JSON.stringify(pushes.slice(quiet))}`);
  console.log('turned off: no more alerts');

  // A browser that dropped its subscription (410) is forgotten.
  const gone = { ...subscription, endpoint: `${endpoint}-gone` };
  await t.call('relay.alerts', { op: 'set', ...gone, prefs });
  const testGone = await t.call('relay.alerts', { op: 'test', endpoint: gone.endpoint }).then(
    () => null,
    (e) => e.message,
  );
  const forgotten = await t.call('relay.alerts', { op: 'get', endpoint: gone.endpoint });
  if (!testGone || forgotten.prefs !== null) throw new Error('a dropped subscription was kept');
  console.log('a dropped browser subscription is forgotten');
  t.close();
  console.log('ALERTS LIVE OK');
} catch (e) {
  console.error(`ALERTS LIVE FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  bridge.stop();
  await mock.close();
  push.close();
  process.exit();
}

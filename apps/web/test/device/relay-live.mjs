#!/usr/bin/env node
// Checks a deployed relay end to end without a browser: a bridge agent here
// serves the mock U1 through the relay, and a pretend browser asks for the
// printer's info and a camera frame. Also checks a wrong key is refused.
//
//   node test/device/relay-live.mjs https://cloud-slicer-relay.awesomestuff.qzz.io [--app <bridge app>]
//
// --app is the bridge program to run (CI passes the one build.sh made); without
// it the bridge is built here with go build.
//
// A relay that wants account tickets: give RELAY_TICKET_PRIVATE_KEY (the JWK
// of the key pair whose public half the relay has) and the pretend browsers
// carry tickets, as the site would sign them. Then it also checks a browser
// without one is refused, the camera cap, and that blocking an account drops it.
//
// Such a relay only lets in bridges that joined an account with a setup code.
// With FAKE_SITE_PORT (the port of the relay's SITE_ORIGIN) this plays the site
// and the bridge spends a real setup code; without it (the deployed relay) the
// bridge joins with a claim signed by the test key, as only "ci-" bridges may.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { importJWK, SignJWT } from 'jose';
import { bridgeConfig, bridgeProgram, browserKey, pairingCode, startBridge } from './go-bridge.mjs';
import { startMockPrinter } from './mock-printer.mjs';

const relay = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(relay)) throw new Error('usage: relay-live.mjs <relay url>');
const mock = await startMockPrinter();
const cfg = { relay, bridgeId: `ci-${randomBytes(9).toString('base64url')}`, key: randomBytes(24).toString('base64url'), printers: [{ id: 'u1', name: 'U1-mock', url: mock.url, apiKey: '' }] };
const app = process.argv.indexOf('--app') > 0 ? process.argv[process.argv.indexOf('--app') + 1] : null;
/** Every pretend-browser socket, closed at the end so a failure can't keep the process alive. */
const open = new Set();
const clientKey = browserKey(cfg.key);
const signer = process.env.RELAY_TICKET_PRIVATE_KEY ? await importJWK(JSON.parse(process.env.RELAY_TICKET_PRIVATE_KEY), 'ES256') : null;
/** What the site signs (apps/web/functions/_lib/relay.ts). */
const sign = (user, claims, seconds = 600) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'ES256' }).setSubject(user).setAudience('cloud-slicer-relay').setIssuedAt().setExpirationTime(`${seconds}s`).sign(signer);
const mint = (user = 'ci-user', claims = {}) => (signer ? sign(user, { b: cfg.bridgeId, cams: 2, ...claims }) : Promise.resolve(''));
const ownerTicket = await mint();
const { accounts } = await (await fetch(`${relay}/v1/info`)).json();

/** The site's side of a setup code (apps/web/functions/_lib/relay.ts claim): this one code, once. */
const SETUP_CODE = 'CK23-4567';
let spent = false;
/** What the relay passed on when the bridge was removed on its computer. */
let released = null;
/** What the relay passed on when a print started or ended (print history). */
const printNews = [];
const site =
  signer && accounts && process.env.FAKE_SITE_PORT
    ? createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        const b = JSON.parse(body || '{}');
        const send = (status, answer) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(answer));
        };
        if (req.url === '/api/relay/release') {
          released = b;
          return send(200, { removed: 1 });
        }
        if (req.url === '/api/relay/print') {
          printNews.push(b);
          return send(200, { ok: true });
        }
        if (req.url !== '/api/relay/claim' || b.code !== SETUP_CODE) return send(404, { error: "That setup code isn't right.", code: 'wrong' });
        if (spent) return send(410, { error: 'This setup code expired or was already used.', code: 'expired' });
        spent = true;
        send(200, { claim: await sign('ci-user', { b: b.bridgeId, claim: true }, 300), name: 'Bridge on CI' });
      })
    : null;
if (site) await new Promise((ok) => site.listen(Number(process.env.FAKE_SITE_PORT), '127.0.0.1', ok));
const claimAt = (bridgeId, body) =>
  fetch(`${relay}/v1/bridges/${bridgeId}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let bridge = { stop() {} };

const socket = (key, printer, role = 'client', ticket = ownerTicket) =>
  new WebSocket(`${relay.replace(/^http/, 'ws')}/v1/bridges/${cfg.bridgeId}/${role}?key=${key}&printer=${printer}${ticket && role === 'client' ? `&ticket=${ticket}` : ''}`);
/** One call through a fresh socket; resolves to the answer message. */
function ask(ticket, call) {
  return new Promise((resolve, reject) => {
    const ws = socket(clientKey, 'u1', 'client', ticket);
    open.add(ws);
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', ...call }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === call.id) resolve({ m, ws });
    };
    ws.onclose = (e) => reject(new Error(`closed: ${e.code} ${e.reason}`));
  });
}
const closeCode = (ws) => new Promise((resolve) => (ws.onclose = (e) => resolve(e)));
const timeout = setTimeout(() => {
  console.error('RELAY LIVE FAIL: timed out');
  process.exit(1);
}, 90_000);

try {
  if (signer && accounts) {
    // Not set up with a code: the relay turns the bridge away.
    const unclaimed = await closeCode(new WebSocket(`${relay.replace(/^http/, 'ws')}/v1/bridges/ci-${randomBytes(9).toString('base64url')}/agent?key=${cfg.key}`));
    if (unclaimed.code !== 4003) throw new Error(`a bridge without a setup code connected (${unclaimed.code})`);
    console.log(`a bridge without a setup code is refused: ${unclaimed.reason}`);
    if (site) {
      const wrong = await claimAt(cfg.bridgeId, { key: cfg.key, code: 'ZZZZ-ZZZZ' });
      if (wrong.status !== 404 || (await wrong.json()).code !== 'wrong') throw new Error(`a wrong setup code: HTTP ${wrong.status}`);
      const ok = await claimAt(cfg.bridgeId, { key: cfg.key, code: SETUP_CODE.toLowerCase(), host: 'ci' });
      if (!ok.ok) throw new Error(`setup code: HTTP ${ok.status} ${await ok.text()}`);
      const again = await claimAt(`ci-${randomBytes(9).toString('base64url')}`, { key: randomBytes(24).toString('base64url'), code: SETUP_CODE });
      if (again.status !== 410) throw new Error(`a used setup code worked again (${again.status})`);
      console.log(`the bridge joined with a setup code (${(await ok.json()).name}); a wrong or used code is refused`);
    } else {
      const ok = await claimAt(cfg.bridgeId, { key: cfg.key, claim: await sign('ci-user', { b: cfg.bridgeId, claim: true }, 300) });
      if (!ok.ok) throw new Error(`test claim: HTTP ${ok.status} ${await ok.text()}`);
      console.log('the bridge joined with a test claim');
    }
    // Once joined, nobody can take the bridge id over with another key.
    const taken = await claimAt(cfg.bridgeId, { key: randomBytes(24).toString('base64url'), claim: await sign('ci-user', { b: cfg.bridgeId, claim: true }, 300) });
    if (taken.ok) throw new Error('another key took over the bridge');
  }
  bridge = startBridge(app ?? bridgeProgram(), bridgeConfig(cfg), { log: (m) => console.log(`bridge: ${m}`) });

  // Wait until the agent has claimed the bridge id.
  for (let i = 0; ; i++) {
    const status = await new Promise((resolve) => {
      const ws = socket(clientKey, '');
      ws.onmessage = (e) => {
        resolve(JSON.parse(e.data).params?.[0]);
        ws.close();
      };
      ws.onclose = () => resolve(null);
    });
    if (status?.agent === 'online') {
      console.log(`bridge online with ${status.printers.map((p) => p.name).join(', ')}`);
      break;
    }
    if (i > 20) throw new Error('the bridge never came online');
    await new Promise((r) => setTimeout(r, 500));
  }

  const results = await new Promise((resolve, reject) => {
    const ws = socket(clientKey, 'u1');
    const got = {};
    open.add(ws);
    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'printer.info' }));
      // Like the real U1, the mock only has a camera frame once the monitor is on.
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'camera.start_monitor', params: {} }));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.error) reject(new Error(m.error.message));
      if (m.id === 2) ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'b1', method: 'bridge.snapshot', params: { url: '/server/files/camera/monitor.jpg' } }));
      if (m.id != null) got[m.id] = m.result;
      if (got[1] && got.b1) {
        ws.close();
        resolve(got);
      }
    };
    ws.onclose = (e) => reject(new Error(`closed: ${e.code} ${e.reason}`));
  });
  if (results[1].hostname !== 'U1-mock') throw new Error(`unexpected printer.info: ${JSON.stringify(results[1])}`);
  if (!Buffer.from(results.b1.data, 'base64').subarray(1, 4).equals(Buffer.from('PNG'))) throw new Error('snapshot is not a PNG');
  console.log('printer.info and a camera frame came back through the relay');

  // A G-code upload in chunks, as the Device tab sends it, and a call the bridge must refuse.
  const gcode = Buffer.from('G28\n' + 'G1 X10 Y10 E1\n'.repeat(30_000));
  const upload = await new Promise((resolve, reject) => {
    const ws = socket(clientKey, 'u1');
    open.add(ws);
    const pending = new Map();
    let next = 1;
    const call = (method, params) =>
      new Promise((res, rej) => {
        const id = next++;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message));
      else p.res(m.result);
    };
    ws.onclose = (e) => reject(new Error(`closed: ${e.code} ${e.reason}`));
    ws.onopen = async () => {
      try {
        const refusedKey = await call('access.get_api_key').then(() => null, (e) => e.message);
        if (!refusedKey) throw new Error('the bridge passed on access.get_api_key');
        const { uploadId } = await call('bridge.upload_begin', { path: 'relay-live.gcode', size: gcode.length });
        for (let offset = 0; offset < gcode.length; offset += 192 * 1024) {
          await call('bridge.upload_chunk', { uploadId, offset, data: gcode.subarray(offset, offset + 192 * 1024).toString('base64') });
        }
        const done = await call('bridge.upload_end', { uploadId });
        const list = await call('server.files.list', { root: 'gcodes' });
        ws.onclose = null;
        ws.close();
        resolve({ done, listed: list.find((f) => f.path === 'relay-live.gcode') });
      } catch (e) {
        reject(e);
      }
    };
  });
  if (upload.done.path !== 'relay-live.gcode' || upload.listed?.size !== gcode.length) throw new Error(`upload went wrong: ${JSON.stringify(upload)}`);
  console.log(`uploaded ${gcode.length} bytes of G-code in chunks; access.* refused`);

  const refused = await closeCode(socket('wrong-key-wrong-key-wrong', 'u1'));
  if (refused.code !== 4003) throw new Error(`a wrong key was not refused (${refused.code})`);
  console.log(`wrong key refused: ${refused.reason}`);
  // The pairing code's key can't take over the bridge, and the secret key isn't a browser key.
  const asAgent = await closeCode(socket(clientKey, '', 'agent'));
  if (asAgent.code !== 4003) throw new Error(`the browser key connected as the agent (${asAgent.code})`);
  console.log(`browser key refused as the agent: ${asAgent.reason}`);
  const secretAsBrowser = await closeCode(socket(cfg.key, 'u1'));
  if (secretAsBrowser.code !== 4003) throw new Error(`the secret key connected as a browser (${secretAsBrowser.code})`);
  console.log(`secret key refused as a browser: ${secretAsBrowser.reason}`);
  console.log(`pairing code format ok (${pairingCode(cfg).length} chars)`);

  if (signer && !accounts) console.log('this relay takes no tickets (it has no ticket key): skipping the account checks');
  if (signer && accounts) {
    const none = await closeCode(socket(clientKey, 'u1', 'client', ''));
    if (none.code !== 4401) throw new Error(`a browser without a ticket was let in (${none.code})`);
    const other = await closeCode(socket(clientKey, 'u1', 'client', await sign('ci-user', { b: 'some-other-bridge', cams: 2 })));
    if (other.code !== 4401) throw new Error(`another bridge's ticket was accepted (${other.code})`);
    const stale = await closeCode(socket(clientKey, 'u1', 'client', await sign('ci-user', { b: cfg.bridgeId }, -10)));
    if (stale.code !== 4401) throw new Error(`an expired ticket was accepted (${stale.code})`);
    console.log(`tickets: none, another bridge's and an expired one refused (${none.reason})`);

    // One camera allowed: a second camera is refused, the first keeps working.
    const one = await mint('ci-cams', { cams: 1 });
    const a = await ask(one, { id: 'c1', method: 'bridge.snapshot', params: { url: '/server/files/camera/monitor.jpg' } });
    a.ws.close();
    const b = await ask(one, { id: 'c2', method: 'bridge.snapshot', params: { url: '/webcam2/snapshot.jpg' } });
    b.ws.close();
    if (a.m.error?.code === -32002 || b.m.error?.code !== -32002) throw new Error(`camera cap: ${JSON.stringify([a.m.error, b.m.error])}`);
    console.log(`camera cap: ${b.m.error.message}`);

    // Blocking an account drops its browsers at once; the bridge's owner is not touched.
    const blocked = await mint('ci-blocked');
    const live = socket(clientKey, 'u1', 'client', blocked);
    open.add(live);
    await new Promise((r, j) => ((live.onmessage = r), (live.onclose = (e) => j(new Error(`closed early: ${e.code}`)))));
    const dropped = closeCode(live);
    const order = await sign('ci-blocked', { revoke: [cfg.bridgeId], blocked: true }, 300);
    const res = await fetch(`${relay}/v1/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${order}` } });
    if (!res.ok) throw new Error(`revoke: HTTP ${res.status}`);
    const forged = await fetch(`${relay}/v1/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${order.slice(0, -4)}AAAA` } });
    if (forged.status !== 403) throw new Error(`a forged revoke was accepted (${forged.status})`);
    if ((await dropped).code !== 4403) throw new Error('the blocked account was not dropped');
    const still = await ask(ownerTicket, { id: 9, method: 'printer.info' });
    still.ws.close();
    if (still.m.result?.hostname !== 'U1-mock') throw new Error('the owner lost the bridge');
    console.log('blocking an account drops it; a forged order is refused; the owner keeps the bridge');

    if (site) {
      // Print history: a print started on the printer itself (its screen), from a file the site tagged,
      // reaches the account with the tag as the bridge read it from the file's start, then how it ended.
      const tag = '; cloud_slicer_print = proj-1/2/0123abcd0123abcd/print-0001';
      mock.files.set('tagged.gcode', { size: 100, modified: Date.now() / 1000, text: `; HEADER_BLOCK_START\n; generated by OrcaSlicer\n; HEADER_BLOCK_END\n${tag}\nG28\n` });
      mock.startPrint('tagged.gcode');
      const waitNews = async (state) => {
        const end = Date.now() + 30_000;
        for (;;) {
          const n = printNews.find((x) => x.state === state && x.file === 'tagged.gcode');
          if (n) return n;
          if (Date.now() > end) throw new Error(`no ${state} news reached the site: ${JSON.stringify(printNews)}`);
          await new Promise((r) => setTimeout(r, 200));
        }
      };
      const started = await waitNews('printing');
      if (started.tag !== tag || started.owner !== 'ci-user' || started.browserKey !== clientKey || started.bridgeId !== cfg.bridgeId || started.printer !== 'u1' || started.printerName !== 'U1-mock' || !started.relay)
        throw new Error(`print start: ${JSON.stringify(started)}`);
      mock.patch({ print_stats: { state: 'complete', print_duration: 42, total_duration: 50 }, virtual_sdcard: { is_active: false, progress: 1 } });
      const ended = await waitNews('complete');
      if (ended.tag !== tag || ended.duration !== 42 || ended.total !== 50) throw new Error(`print end: ${JSON.stringify(ended)}`);
      console.log('print history: a print started on the printer reached the account with its tag, then its end');
    }

    const siteOrder = async (claims) => {
      const r = await fetch(`${relay}/v1/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${await sign('site', { revoke: [cfg.bridgeId], ...claims }, 300)}` } });
      if (!r.ok) throw new Error(`order: HTTP ${r.status}`);
    };
    const openSocket = async (ticket) => {
      const ws = socket(clientKey, 'u1', 'client', ticket);
      open.add(ws);
      await new Promise((r, j) => ((ws.onmessage = r), (ws.onclose = (e) => j(new Error(`closed early: ${e.code}`)))));
      return ws;
    };
    const member = await openSocket(ownerTicket);
    // The owner turns the whole bridge off: everyone goes, nobody gets back in, until it is turned on.
    const memberGone = closeCode(member);
    await siteOrder({ bridgeOff: true });
    if ((await memberGone).code !== 4403) throw new Error('turning the bridge off did not close its browsers');
    const refusedOff = await closeCode(socket(clientKey, 'u1'));
    if (refusedOff.code !== 4403) throw new Error(`a browser got onto a bridge that is off (${refusedOff.code})`);
    await siteOrder({ bridgeOff: false });
    const back = await openSocket(ownerTicket);
    back.close();
    console.log('a bridge turned off and on again');
  }
  if (site) {
    // Removed on its own computer: only with its own key; everyone is told, the account is told, and nobody gets back in.
    const release = (key) =>
      fetch(`${relay}/v1/bridges/${cfg.bridgeId}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    const notMine = await release(randomBytes(24).toString('base64url'));
    if (notMine.status !== 403) throw new Error(`another key removed the bridge (${notMine.status})`);
    const watching = socket(clientKey, 'u1');
    open.add(watching);
    await new Promise((r, j) => ((watching.onmessage = r), (watching.onclose = (e) => j(new Error(`closed early: ${e.code}`)))));
    const told = closeCode(watching);
    const done = await release(cfg.key);
    if (!done.ok) throw new Error(`release: HTTP ${done.status} ${await done.text()}`);
    const answer = await done.json();
    if ((await told).code !== 4410) throw new Error('the open browser was not told the bridge was removed');
    if (!answer.account || released?.bridgeId !== cfg.bridgeId || released.owner !== 'ci-user' || released.browserKey !== clientKey)
      throw new Error(`the site was not told: ${JSON.stringify({ answer, released })}`);
    const after = await closeCode(socket(clientKey, 'u1'));
    if (after.code !== 4410) throw new Error(`a browser got onto a removed bridge (${after.code})`);
    console.log(`a bridge removed on its computer: ${after.reason}`);
  }
  console.log('RELAY LIVE OK');
} catch (e) {
  console.error(`RELAY LIVE FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  for (const ws of open) ws.close();
  bridge.stop();
  site?.close();
  await mock.close();
  // Exit even if a socket or timer is still open: CI waits on this step.
  process.exit();
}

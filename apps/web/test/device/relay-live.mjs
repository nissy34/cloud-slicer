#!/usr/bin/env node
// Checks a deployed relay end to end without a browser: a bridge agent here
// serves the mock U1 through the relay, and a pretend browser asks for the
// printer's info and a camera frame. Also checks a wrong key is refused.
//
//   node test/device/relay-live.mjs https://cloud-slicer-relay.<account>.workers.dev [--app <bridge app>]
//
// With --app, a one-file bridge app (bun build --compile) is the agent instead
// of bridge.mjs in this process.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserKey, pairingCode, runBridge } from '../../../device-bridge/bridge.mjs';
import { startMockPrinter } from './mock-printer.mjs';

const relay = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(relay)) throw new Error('usage: relay-live.mjs <relay url>');
const mock = await startMockPrinter();
const cfg = { relay, bridgeId: `ci-${randomBytes(9).toString('base64url')}`, key: randomBytes(24).toString('base64url'), printers: [{ id: 'u1', name: 'U1-mock', url: mock.url, apiKey: '' }] };
const app = process.argv.indexOf('--app') > 0 ? process.argv[process.argv.indexOf('--app') + 1] : null;
const bridge = app ? startApp(app) : runBridge(cfg, { log: (m) => console.log(`bridge: ${m}`) });

function startApp(path) {
  const config = join(mkdtempSync(join(tmpdir(), 'bridge-app-')), 'bridge.json');
  writeFileSync(config, JSON.stringify(cfg));
  const child = spawn(path, ['run', '--no-browser', '--config', config], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => process.stdout.write(`app: ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`app: ${d}`));
  return { stop: () => child.kill() };
}
/** Every pretend-browser socket, closed at the end so a failure can't keep the process alive. */
const open = new Set();
const clientKey = browserKey(cfg.key);
const socket = (key, printer, role = 'client') => new WebSocket(`${relay.replace(/^http/, 'ws')}/v1/bridges/${cfg.bridgeId}/${role}?key=${key}&printer=${printer}`);
const closeCode = (ws) => new Promise((resolve) => (ws.onclose = (e) => resolve(e)));
const timeout = setTimeout(() => {
  console.error('RELAY LIVE FAIL: timed out');
  process.exit(1);
}, 30_000);

try {
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
  console.log('RELAY LIVE OK');
} catch (e) {
  console.error(`RELAY LIVE FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  for (const ws of open) ws.close();
  bridge.stop();
  await mock.close();
  // Exit even if a socket or timer is still open: CI waits on this step.
  process.exit();
}

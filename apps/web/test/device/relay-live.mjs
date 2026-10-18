#!/usr/bin/env node
// Checks a deployed relay end to end without a browser: a bridge agent here
// serves the mock U1 through the relay, and a pretend browser asks for the
// printer's info and a camera frame. Also checks a wrong key is refused.
//
//   node test/device/relay-live.mjs https://cloud-slicer-relay.<account>.workers.dev
import { randomBytes } from 'node:crypto';
import { pairingCode, runBridge } from '../../../device-bridge/bridge.mjs';
import { startMockPrinter } from './mock-printer.mjs';

const relay = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(relay)) throw new Error('usage: relay-live.mjs <relay url>');
const mock = await startMockPrinter();
const cfg = { relay, bridgeId: `ci-${randomBytes(9).toString('base64url')}`, key: randomBytes(24).toString('base64url'), printers: [{ id: 'u1', name: 'U1-mock', url: mock.url, apiKey: '' }] };
const bridge = runBridge(cfg, { log: (m) => console.log(`bridge: ${m}`) });
/** Every pretend-browser socket, closed at the end so a failure can't keep the process alive. */
const open = new Set();
const socket = (key, printer) => new WebSocket(`${relay.replace(/^http/, 'ws')}/v1/bridges/${cfg.bridgeId}/client?key=${key}&printer=${printer}`);
const timeout = setTimeout(() => {
  console.error('RELAY LIVE FAIL: timed out');
  process.exit(1);
}, 30_000);

try {
  // Wait until the agent has claimed the bridge id.
  for (let i = 0; ; i++) {
    const status = await new Promise((resolve) => {
      const ws = socket(cfg.key, '');
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
    const ws = socket(cfg.key, 'u1');
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

  const refused = await new Promise((resolve) => {
    const ws = socket('wrong-key-wrong-key-wrong', 'u1');
    ws.onclose = (e) => resolve(e);
  });
  if (refused.code !== 4003) throw new Error(`a wrong key was not refused (${refused.code})`);
  console.log(`wrong key refused: ${refused.reason}`);
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

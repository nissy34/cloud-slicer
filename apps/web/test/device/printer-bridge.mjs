#!/usr/bin/env node
// Checks a bridge installed on a printer (install-printer --code, joined to the
// account "ci-user" through fake-site.mjs) from the Device tab's side: it comes
// online through the relay, and "Remove bridge" makes it remove itself, its
// service and its files. The browser carries a ticket, as the site signs it.
//
//   RELAY_TICKET_PRIVATE_KEY=<jwk> node test/device/printer-bridge.mjs <relay url> <printer_data folder> <copy of its bridge.json>
//
// (The bridge's settings are root's only; the job hands over a copy.)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importJWK, SignJWT } from 'jose';
import { browserKey } from './go-bridge.mjs';

const [relayArg, dataDir, settings] = process.argv.slice(2);
if (!relayArg || !dataDir || !settings) throw new Error('usage: printer-bridge.mjs <relay url> <printer_data folder> <bridge.json>');
const relay = relayArg.replace(/\/+$/, '');
const bridgeDir = join(dataDir, 'cloud-slicer-bridge');
// The Go bridge's settings file: bridgeId, key, relay, claimed.
const cfg = JSON.parse(readFileSync(settings, 'utf8'));
const timeout = setTimeout(() => {
  console.error('PRINTER BRIDGE FAIL: timed out');
  process.exit(1);
}, 60_000);

if (cfg.relay !== relay) throw new Error(`the bridge uses relay ${cfg.relay}, not ${relay}`);
if (!cfg.claimed) throw new Error('the bridge is not in an account');
const signer = await importJWK(JSON.parse(process.env.RELAY_TICKET_PRIVATE_KEY), 'ES256');
const ticket = await new SignJWT({ b: cfg.bridgeId, cams: 2 }).setProtectedHeader({ alg: 'ES256' }).setSubject('ci-user').setAudience('cloud-slicer-relay').setIssuedAt().setExpirationTime('600s').sign(signer);
const socket = () => new WebSocket(`${relay.replace(/^http/, 'ws')}/v1/bridges/${cfg.bridgeId}/client?key=${browserKey(cfg.key)}&printer=&ticket=${ticket}`);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

try {
  // Online, and saying it runs on the printer.
  for (let n = 0; ; n++) {
    const status = await new Promise((resolve) => {
      const ws = socket();
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.method === 'notify_bridge_status') {
          resolve(m.params?.[0]);
          ws.close();
        }
      };
      ws.onclose = () => resolve(null);
    });
    // Online but no version yet: the relay has the bridge's socket but not its hello; ask again.
    if (status?.agent === 'online' && status.version) {
      if (status.place !== 'printer') throw new Error(`the bridge doesn't say it runs on the printer: ${JSON.stringify(status)}`);
      console.log(`printer bridge online (build ${status.build}, ${status.printers.length} printers)`);
      break;
    }
    if (n > 40) throw new Error('the printer bridge never came online');
    await sleep(500);
  }
  // Remove bridge, as Printers & bridges does.
  const answer = await new Promise((resolve, reject) => {
    const ws = socket();
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'bridge.uninstall', params: {} }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== 1) return;
      ws.close();
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
    };
    ws.onclose = (e) => reject(new Error(`closed: ${e.code} ${e.reason}`));
  });
  if (!answer?.uninstalling) throw new Error(`unexpected answer: ${JSON.stringify(answer)}`);
  for (let n = 0; existsSync(bridgeDir); n++) {
    if (n > 40) throw new Error('the bridge folder is still there');
    await sleep(500);
  }
  console.log('Remove bridge: the printer bridge removed itself and its files');
  console.log('PRINTER BRIDGE OK');
} catch (e) {
  console.error(`PRINTER BRIDGE FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}

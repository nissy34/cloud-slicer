#!/usr/bin/env node
// Checks a bridge installed on a printer (install-printer) from the Device tab's
// side: its pairing file pairs, it comes online through the relay, and "Remove
// bridge" makes it remove itself, its service and its files.
//
//   node test/device/printer-bridge.mjs <relay url> <printer_data folder>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [relayArg, dataDir] = process.argv.slice(2);
if (!relayArg || !dataDir) throw new Error('usage: printer-bridge.mjs <relay url> <printer_data folder>');
const relay = relayArg.replace(/\/+$/, '');
const pairingFile = join(dataDir, 'config', 'cloud-slicer-bridge-pairing.txt');
const bridgeDir = join(dataDir, 'cloud-slicer-bridge');
const timeout = setTimeout(() => {
  console.error('PRINTER BRIDGE FAIL: timed out');
  process.exit(1);
}, 60_000);

const code = /#pair=([\w-]+)/.exec(readFileSync(pairingFile, 'utf8'))?.[1];
if (!code) throw new Error('no pairing link in the pairing file');
const { r, i, k } = JSON.parse(Buffer.from(code, 'base64url').toString());
if (r !== relay) throw new Error(`the pairing file names relay ${r}, not ${relay}`);
const socket = () => new WebSocket(`${relay.replace(/^http/, 'ws')}/v1/bridges/${i}/client?key=${k}&printer=`);
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
    if (status?.agent === 'online') {
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
  for (let n = 0; existsSync(bridgeDir) || existsSync(pairingFile); n++) {
    if (n > 40) throw new Error('the bridge folder or pairing file is still there');
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

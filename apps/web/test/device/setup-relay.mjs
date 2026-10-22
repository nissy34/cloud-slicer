#!/usr/bin/env node
// A stand-in for Cloud Slicer's relay, for the Windows and Mac app checks
// (device.yml): it takes the setup code CK23-4567 like the real relay does once
// the site has checked it, says another code isn't right, and records a bridge
// leaving its account on uninstall. With a folder it also serves the bridge
// download from it (/download/<file>), as the relay does from R2. Nothing to
// install: plain node.
//
//   node test/device/setup-relay.mjs <port> [download folder]
//
// Each request is printed (claim ok / claim wrong / release), so the job can
// read the log afterwards.
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join } from 'node:path';

const port = Number(process.argv[2]);
const downloads = process.argv[3];
if (!port) throw new Error('usage: setup-relay.mjs <port> [download folder]');
const SETUP_CODE = 'CK23-4567';

const send = (res, status, answer) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(answer));
};

createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const url = new URL(req.url, 'http://relay');
  if (url.pathname === '/v1/info') return send(res, 200, { accounts: true });
  const download = /^\/download\/([\w.-]+)$/.exec(url.pathname);
  if (download && downloads && existsSync(join(downloads, basename(download[1])))) {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    return createReadStream(join(downloads, basename(download[1]))).pipe(res);
  }
  const bridge = /^\/v1\/bridges\/([^/]+)\/(claim|release)$/.exec(url.pathname);
  if (bridge && req.method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (bridge[2] === 'release') {
      console.log(`release ${bridge[1]}`);
      return send(res, 200, { ok: true, account: true });
    }
    // Typed by hand: any case, with or without the dash (as the relay reads it).
    const bare = String(b.code ?? '').replace(/[\s-]+/g, '').toUpperCase();
    if (!b.key || `${bare.slice(0, 4)}-${bare.slice(4)}` !== SETUP_CODE) {
      console.log(`claim wrong ${bridge[1]}`);
      return send(res, 404, { error: "That isn't a setup code. Copy it again from Cloud Slicer.", code: 'wrong' });
    }
    console.log(`claim ok ${bridge[1]} (${b.system ?? '?'}, ${b.place || 'computer'})`);
    return send(res, 200, { ok: true, name: 'Bridge on CI' });
  }
  // The bridge's websocket and anything else: nobody home (the bridge keeps trying).
  send(res, 404, { error: 'Not found' });
}).listen(port, '127.0.0.1', () => console.log(`setup relay on ${port}`));

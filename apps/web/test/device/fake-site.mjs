#!/usr/bin/env node
// Plays Cloud Slicer's side of setup codes for a local relay with accounts (its
// SITE_ORIGIN): the setup code CK23-4567 works, for any number of bridges, and
// the bridge joins the account "ci-user". Used for the bridge installed on a
// printer (device.yml), which only joins with a setup code, like every bridge.
//
//   RELAY_TICKET_PRIVATE_KEY=<jwk> node test/device/fake-site.mjs <port>
//
// relay-live.mjs has its own copy that takes the code once, to check a used code fails.
import { createServer } from 'node:http';
import { importJWK, SignJWT } from 'jose';

const port = Number(process.argv[2]);
if (!port || !process.env.RELAY_TICKET_PRIVATE_KEY) throw new Error('usage: RELAY_TICKET_PRIVATE_KEY=<jwk> fake-site.mjs <port>');
const signer = await importJWK(JSON.parse(process.env.RELAY_TICKET_PRIVATE_KEY), 'ES256');
const SETUP_CODE = 'CK23-4567';

createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const b = JSON.parse(body || '{}');
  const send = (status, answer) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(answer));
  };
  if (req.url === '/api/relay/release') {
    console.log(`release ${b.bridgeId}`);
    return send(200, { removed: 1 });
  }
  if (req.url !== '/api/relay/claim' || b.code !== SETUP_CODE) return send(404, { error: "That setup code isn't right.", code: 'wrong' });
  console.log(`claim ${b.bridgeId} (${b.place || 'computer'})`);
  // What the site signs (apps/web/functions/_lib/relay.ts).
  const claim = await new SignJWT({ b: b.bridgeId, claim: true }).setProtectedHeader({ alg: 'ES256' }).setSubject('ci-user').setAudience('cloud-slicer-relay').setIssuedAt().setExpirationTime('300s').sign(signer);
  send(200, { claim, name: 'Printer bridge on CI' });
}).listen(port, '127.0.0.1', () => console.log(`fake site on ${port}`));

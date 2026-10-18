import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserKey, candidateUrls, mergeDiff, pairingCode, refused } from './bridge.mjs';

test('tries Moonraker on 7125, then the web port', () => {
  assert.deepEqual(candidateUrls('192.168.1.50'), ['http://192.168.1.50:7125', 'http://192.168.1.50']);
  assert.deepEqual(candidateUrls('u1.local:7125'), ['http://u1.local:7125']);
  assert.deepEqual(candidateUrls('https://printer.example.com/'), ['https://printer.example.com']);
});

test('coalesces status diffs field by field', () => {
  const pending = mergeDiff({}, { extruder: { temperature: 20 }, fan: { speed: 0 } });
  mergeDiff(pending, { extruder: { target: 200 }, fan: { speed: 1 } });
  assert.deepEqual(pending, { extruder: { temperature: 20, target: 200 }, fan: { speed: 1 } });
});

test('pairing code carries relay, id and the browser key, never the secret key', () => {
  const code = pairingCode({ relay: 'https://r.example', bridgeId: 'abcdefgh', key: 'k'.repeat(32) });
  const decoded = JSON.parse(Buffer.from(code, 'base64url').toString());
  assert.deepEqual(decoded, { r: 'https://r.example', i: 'abcdefgh', k: browserKey('k'.repeat(32)) });
  assert.notEqual(decoded.k, 'k'.repeat(32));
  assert.match(decoded.k, /^[\w-]{43}$/);
});

test("refuses Moonraker's access.* calls, which would reveal the printer's API key", () => {
  assert.equal(refused('access.get_api_key'), true);
  assert.equal(refused('access.post_user'), true);
  assert.equal(refused('printer.objects.query'), false);
  assert.equal(refused(undefined), false);
});

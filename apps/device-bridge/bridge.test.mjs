import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { autostartPlan, browserKey, candidateUrls, mergeDiff, pairingCode, refused } from './bridge.mjs';

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

test('passes on only what the Device tab uses', () => {
  for (const m of ['access.get_api_key', 'access.post_user', 'machine.sudo.password', 'machine.update.full', 'server.files.move', 'machine.reboot', undefined]) {
    assert.ok(refused(m), `${m} should be refused`);
  }
  for (const m of ['printer.info', 'printer.objects.subscribe', 'printer.gcode.script', 'camera.start_monitor']) assert.equal(refused(m), null);
  assert.equal(refused('server.files.delete_file', { path: 'gcodes/cube.gcode' }), null);
  assert.ok(refused('server.files.delete_file', { path: 'config/printer.cfg' }));
  assert.ok(refused('server.files.delete_file', { path: 'gcodes/../config/printer.cfg' }));
});

test('starting with the computer: Windows uses a per-user Run entry and copies the app out of Downloads', () => {
  const plan = autostartPlan({ platform: 'win32', home: 'C:\\Users\\n', env: { LOCALAPPDATA: 'C:\\Users\\n\\AppData\\Local' }, app: true, exe: 'C:\\Users\\n\\Downloads\\cloud-slicer-bridge.exe' });
  assert.equal(plan.copy.to, join('C:\\Users\\n\\AppData\\Local', 'Cloud Slicer Bridge', 'cloud-slicer-bridge.exe'));
  const [cmd, args] = plan.enable[0];
  assert.equal(cmd, 'reg');
  assert.ok(args.includes('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'));
  const value = args[args.indexOf('/d') + 1];
  // Paths with spaces stay quoted, and the bridge never opens a browser by itself at sign-in.
  // --background: the bridge starts itself again with no window, so it stays out of the taskbar.
  assert.match(value, /^".*Cloud Slicer Bridge.*cloud-slicer-bridge\.exe" "run" "--no-browser" "--background"$/);
  assert.equal(plan.start[0], plan.copy.to);
  assert.deepEqual(plan.start[1], ['run', '--no-browser', '--background']);
});

test('starting with the computer: macOS writes a launch agent that keeps the bridge running', () => {
  const plan = autostartPlan({ platform: 'darwin', home: '/Users/n', app: true, exe: '/Users/n/Downloads/Cloud Slicer Bridge' });
  assert.equal(plan.copy.to, '/Users/n/Library/Application Support/Cloud Slicer Bridge/cloud-slicer-bridge');
  assert.equal(plan.files[0].path, '/Users/n/Library/LaunchAgents/io.qzz.awesomestuff.cloud-slicer-bridge.plist');
  assert.match(plan.files[0].content, /<string>\/Users\/n\/Library\/Application Support\/Cloud Slicer Bridge\/cloud-slicer-bridge<\/string><string>run<\/string><string>--no-browser<\/string>/);
  assert.match(plan.files[0].content, /<key>KeepAlive<\/key><true\/>/);
  assert.ok(plan.enable.some(([c, a]) => c === 'launchctl' && a[0] === 'bootstrap'));
});

test('starting with the computer: Linux (and a Pi) gets a systemd user service that runs without a sign-in', () => {
  const plan = autostartPlan({ platform: 'linux', home: '/home/pi', app: true, exe: '/home/pi/.local/bin/cloud-slicer-bridge', user: 'pi' });
  assert.equal(plan.files[0].path, '/home/pi/.config/systemd/user/cloud-slicer-bridge.service');
  assert.match(plan.files[0].content, /^ExecStart=\/home\/pi\/\.local\/share\/cloud-slicer-bridge\/cloud-slicer-bridge run --no-browser$/m);
  assert.match(plan.files[0].content, /^Restart=always$/m);
  assert.deepEqual(plan.enable.at(-1).slice(0, 2), ['loginctl', ['enable-linger', 'pi']]);
});

test('the Linux app also gets a menu entry with its icon that opens the pairing link', () => {
  const plan = autostartPlan({ platform: 'linux', home: '/home/pi', app: true, exe: '/tmp/x/cloud-slicer-bridge', user: 'pi' });
  const menu = plan.files.find((f) => f.path.endsWith('.desktop'));
  assert.equal(menu.path, '/home/pi/.local/share/applications/cloud-slicer-bridge.desktop');
  assert.match(menu.content, /^Exec=\/home\/pi\/\.local\/share\/cloud-slicer-bridge\/cloud-slicer-bridge pair --open$/m);
  assert.match(menu.content, /^Icon=\/home\/pi\/\.local\/share\/cloud-slicer-bridge\/icon\.png$/m);
  assert.equal(plan.icon, '/home/pi/.local/share/cloud-slicer-bridge/icon.png');
  // Under node there is no icon to show, so no menu entry.
  assert.equal(autostartPlan({ platform: 'linux', home: '/home/pi', app: false, exe: '/usr/bin/node', script: '/tmp/b.mjs', user: 'pi' }).files.length, 1);
});

test('starting with the computer under node: node runs a stable copy of this script', () => {
  const plan = autostartPlan({ platform: 'linux', home: '/home/pi', app: false, exe: '/usr/bin/node', script: '/home/pi/Downloads/cloud-slicer-bridge.mjs', user: 'pi' });
  assert.equal(plan.copy.from, '/home/pi/Downloads/cloud-slicer-bridge.mjs');
  assert.match(plan.files[0].content, /^ExecStart=\/usr\/bin\/node \/home\/pi\/\.local\/share\/cloud-slicer-bridge\/cloud-slicer-bridge\.mjs run --no-browser$/m);
});

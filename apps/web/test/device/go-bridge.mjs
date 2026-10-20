// The real bridge (apps/device-bridge, Go) for the device tests: built once, run
// as its own process on a settings file, with its test hooks for what a network
// search finds and for the Device tab's "Remove bridge".
import { execFileSync, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = join(dirname(fileURLToPath(import.meta.url)), '../../../device-bridge');

/** The key browsers use, derived from the bridge's secret key (pairing.go). */
export const browserKey = (key) => createHmac('sha256', key).update('cloud-slicer browser key').digest('base64url');

/** What #pair= carries: {r: relay, i: bridge id, k: browser key}. */
export const pairingCode = (cfg) => Buffer.from(JSON.stringify({ r: cfg.relay, i: cfg.bridgeId, k: browserKey(cfg.key) })).toString('base64url');

/** The bridge program: CLOUD_SLICER_BRIDGE_BIN (CI builds it with build.sh), else built here with go build. */
export function bridgeProgram() {
  if (process.env.CLOUD_SLICER_BRIDGE_BIN) return process.env.CLOUD_SLICER_BRIDGE_BIN;
  const out = join(mkdtempSync(join(tmpdir(), 'bridge-bin-')), process.platform === 'win32' ? 'cloud-slicer-bridge.exe' : 'cloud-slicer-bridge');
  execFileSync('go', ['build', '-o', out, '.'], { cwd: source, stdio: 'inherit' });
  return out;
}

/**
 * A bridge's settings file, written from `cfg` ({relay, bridgeId, key, printers}),
 * read back as the bridge changes it.
 */
export function bridgeConfig(cfg) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-'));
  const path = join(dir, 'bridge.json');
  writeFileSync(path, JSON.stringify(cfg));
  return {
    dir,
    path,
    printers: () => JSON.parse(readFileSync(path, 'utf8')).printers ?? [],
  };
}

/**
 * Runs the bridge on a settings file. `find` is a file holding what a network
 * search finds (JSON), read on each search; `uninstallMarker` is written when the
 * Device tab removes the bridge, instead of uninstalling anything.
 */
export function startBridge(program, config, { find, uninstallMarker, log = () => {} } = {}) {
  const env = { ...process.env };
  if (find) env.CLOUD_SLICER_BRIDGE_TEST_FIND = find;
  if (uninstallMarker) env.CLOUD_SLICER_BRIDGE_TEST_UNINSTALL = uninstallMarker;
  const child = spawn(program, ['run', '--no-browser', '--config', config.path], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false;
  child.on('exit', () => (exited = true));
  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream.on('data', (d) => {
      const lines = (rest + d).split('\n');
      rest = lines.pop();
      for (const line of lines) log(line);
    });
  }
  return {
    stop: () => child.kill(),
    exited: () => exited,
    uninstalled: () => !!uninstallMarker && existsSync(uninstallMarker),
  };
}

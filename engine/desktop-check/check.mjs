#!/usr/bin/env node
// Checks our engine against the real desktop app of the same version: each
// case below is sliced by the wasm engine, saved as a 3MF project, sliced
// again from that 3MF by desktop's command line, and the two G-code files are
// compared by engine/scripts/compare-gcode.py (what gets printed, with small
// tolerances; never line by line). It also compares the settings our app
// picks for the U1 presets with desktop's own preset files.
//
//   node engine/desktop-check/check.mjs --flavor snapmaker|orca --desktop <AppRun>
//     --out DIR        where the files go (default engine/build/desktop-check/<flavor>)
//     --only NAME      one case
//     --self-test      also check that the comparison catches a real change
//                      (ours with one wall fewer must not match)
//
// ORCA_ENGINE_JS and ORCA_PROFILES pick the engine, as for engine/node/slice.mjs.
// Get desktop with engine/desktop-check/desktop.sh. Exit status 1 on any mismatch.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const fixtures = join(root, 'fixtures');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flavor = opt('--flavor') ?? 'snapmaker';
const desktop = opt('--desktop');
const only = opt('--only');
const selfTest = args.includes('--self-test');
const outDir = resolve(opt('--out') ?? join(root, 'engine/build/desktop-check', flavor));
if (!desktop || !['snapmaker', 'orca'].includes(flavor)) {
  console.error('usage: check.mjs --flavor snapmaker|orca --desktop <path to AppRun> [--out DIR] [--only NAME] [--self-test]');
  process.exit(2);
}
if (flavor === 'orca') {
  process.env.ORCA_ENGINE_JS ??= join(root, 'engine/build/engine-orca/orca-engine.js');
  process.env.ORCA_PROFILES ??= join(root, 'engine/build/profiles-orca/profiles.json');
}
const { DEFAULT_PRINTER, bedSize, call, openEngine } = await import('../node/engine.mjs');

// What the two may differ in on purpose, and why. Anything else is a mismatch.
const EXPECTED_SETTINGS = {
  filename_format: 'our preset bundle puts the plate number in file names (engine/scripts/plate-file-names.mjs)',
  ...(flavor === 'orca' && {
    flush_volumes_matrix: "desktop's command line fills in its own flush volumes when it opens a project; the U1 has a nozzle per filament, so the print is the same",
    extruder_ams_count: "desktop's command line fills this in when it opens a project; it only names the filament holders",
  }),
};

const PROCESS = {
  snapmaker: { fine: '0.12mm Standard @Snapmaker U1 (0.4 nozzle)' },
  orca: { fine: '0.12 Fine @Snapmaker U1 (0.4 nozzle)' },
}[flavor];

// filaments: how many slots of the printer's default filament.
const CASES = [
  { name: 'benchy', model: '3DBenchy.stl' },
  { name: 'benchy-fine', model: '3DBenchy.stl', process: PROCESS.fine },
  { name: 'benchy-supports', model: '3DBenchy.stl', set: { enable_support: '1', support_type: 'normal(auto)' } },
  // Tree supports grow their branches with a lot of floating-point maths, and
  // the browser build rounds a little differently from desktop's: on Benchy
  // one branch ends 0.8 mm further and the interface is 0.6% longer, every run.
  {
    name: 'benchy-tree-supports', model: '3DBenchy.stl', set: { enable_support: '1', support_type: 'tree(auto)' },
    allowed: ['--tol', '2', '--mm', '1.5'],
  },
  { name: 'benchy-ironing', model: '3DBenchy.stl', set: { ironing_type: 'top' } },
  { name: 'benchy-4-colours', model: 'colored_3DBenchy.3mf', filaments: 4 },
  { name: 'cube-2-colours', model: 'calib-cube-10-dual-colour-merged.3mf', filaments: 2 },
  // A plate printed with only a colour mix: desktop drops the prime tower, we
  // keep it (engine/patches/snapmaker/0009), so the tower, its setting, the
  // idle-nozzle temperatures and the time differ. Everything else must match.
  {
    name: 'benchy-colour-mix', model: '3DBenchy.stl', filaments: 2, mix: true, snapmakerOnly: true,
    set: { enable_prime_tower: '1' },
    allowed: ['--skip-type', 'Prime tower', '--ignore-setting', 'enable_prime_tower', '--allow', 'temps', '--allow', 'time', '--allow', 'area'],
    expect: (ours, theirs) => /;TYPE:Prime tower/.test(ours) && !/;TYPE:Prime tower/.test(theirs)
      ? null : 'expected a prime tower in ours and none from desktop (patches/snapmaker/0009)',
  },
].filter((c) => (!only || c.name === only) && !(c.snapmakerOnly && flavor !== 'snapmaker'));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const { engine } = await openEngine();
const results = [];
// The printer's own default process; a selection keeps the last process otherwise.
const DEFAULT_PROCESS = call(engine, 'presetsSelect', JSON.stringify({ printer: DEFAULT_PRINTER })).selection.process;

function select(c) {
  const process = c.process ?? DEFAULT_PROCESS;
  const first = call(engine, 'presetsSelect', JSON.stringify({ printer: DEFAULT_PRINTER, process }));
  const fil = first.selection.filaments[0];
  const sel = call(engine, 'presetsSelect', JSON.stringify({ printer: DEFAULT_PRINTER, process, filaments: Array(c.filaments ?? 1).fill(fil) }));
  if (sel.selection.process !== process) throw new Error(`process "${process}" not found`);
  return sel.selection;
}

function prepare(c, extra = {}) {
  let over = { ...c.set, ...extra };
  if (c.mix) {
    const mix = call(engine, 'mixedFilaments', JSON.stringify({ definitions: '', colours: ['#FF0000', '#0000FF'], op: { kind: 'add', row: { componentA: 1, componentB: 2, mixBPercent: 50, uiMode: 0 } } }));
    over = { ...over, filament_colour: '#FF0000;#0000FF', mixed_filament_definitions: mix.definitions };
  }
  const full = call(engine, 'presetsFullConfig', JSON.stringify(over));
  if (full.errors.length) throw new Error(`config: ${full.errors.join('; ')}`);
  const config = full.config;
  const [w, d] = bedSize(config);
  engine.clearModel();
  engine.FS.writeFile(`/work/${c.model}`, readFileSync(join(fixtures, c.model)));
  call(engine, 'loadModel', `/work/${c.model}`, 0, w, d, false, 0);
  if (c.mix) call(engine, 'setExtruder', 0, -1, 3);
  // The page keeps the prime tower on the bed and saves where it is, as
  // desktop's window does; desktop's command line prints wherever the file says.
  const tower = JSON.parse(engine.wipeTowerJson(JSON.stringify(config), 0, -1));
  if (tower.show) Object.assign(config, { wipe_tower_x: String(tower.x), wipe_tower_y: String(tower.y) });
  return config;
}

function sliceOurs(config, file) {
  const r = JSON.parse(engine.sliceWithConfig(JSON.stringify(config), 0, '/work/out.gcode', null, null, 'check'));
  if (!r.success) throw new Error(`our engine: ${r.error}`);
  writeFileSync(file, engine.FS.readFile(r.gcodePath));
}

function sliceDesktop(dir, project) {
  mkdirSync(dir, { recursive: true });
  const home = join(outDir, '.home');
  mkdirSync(home, { recursive: true });
  const t0 = Date.now();
  const run = spawnSync(desktop, ['--allow-newer-file', '--slice', '0', '--outputdir', dir, project],
    { cwd: dir, env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 15 * 60_000 });
  writeFileSync(join(dir, 'desktop.log'), `${run.stdout ?? ''}${run.stderr ?? ''}`);
  const gcode = join(dir, 'plate_1.gcode');
  if (run.status !== 0 || !existsSync(gcode)) {
    const res = existsSync(join(dir, 'result.json')) ? readFileSync(join(dir, 'result.json'), 'utf8') : '';
    throw new Error(`desktop failed (exit ${run.status ?? run.signal}): ${res || (run.stderr ?? '').slice(-400)}`);
  }
  return { gcode, seconds: (Date.now() - t0) / 1000 };
}

function compare(a, b, extra = []) {
  const ignore = Object.keys(EXPECTED_SETTINGS).flatMap((k) => ['--ignore-setting', k]);
  const run = spawnSync('python3', [join(root, 'engine/scripts/compare-gcode.py'), a, b, ...ignore, ...extra], { encoding: 'utf8' });
  return { ok: run.status === 0, report: run.stdout + run.stderr };
}

for (const c of CASES) {
  const dir = join(outDir, c.name);
  mkdirSync(dir, { recursive: true });
  console.log(`\n=== ${c.name}`);
  try {
    const selection = select(c);
    const config = prepare(c);
    const ours = join(dir, 'ours.gcode');
    sliceOurs(config, ours);
    call(engine, 'saveProject', '/work/project.3mf', JSON.stringify(config), null);
    writeFileSync(join(dir, 'project.3mf'), engine.FS.readFile('/work/project.3mf'));
    const theirs = sliceDesktop(join(dir, 'desktop'), join(dir, 'project.3mf'));
    const cmp = compare(theirs.gcode, ours, c.allowed);
    writeFileSync(join(dir, 'compare.txt'), cmp.report);
    const extra = c.expect?.(readFileSync(ours, 'utf8'), readFileSync(theirs.gcode, 'utf8'));
    console.log(cmp.report.trim());
    if (extra) console.log(`  <-- ${extra}`);
    results.push({ name: c.name, ok: cmp.ok && !extra, note: extra ?? summary(cmp.report), process: selection.process, desktopSeconds: theirs.seconds });
  } catch (e) {
    console.log(`  failed: ${e.message}`);
    results.push({ name: c.name, ok: false, note: e.message });
  }
}

// The comparison must catch a real change: our slice with one wall fewer,
// against desktop's slice of the unchanged project, must not match.
if (selfTest) {
  console.log('\n=== self-test: one wall fewer must not match');
  const c = { name: 'self-test', model: '3DBenchy.stl' };
  const dir = join(outDir, c.name);
  mkdirSync(dir, { recursive: true });
  try {
    select(c);
    const config = prepare(c);
    call(engine, 'saveProject', '/work/project.3mf', JSON.stringify(config), null);
    writeFileSync(join(dir, 'project.3mf'), engine.FS.readFile('/work/project.3mf'));
    const changed = { ...config, wall_loops: String(Number(config.wall_loops) - 1) };
    const ours = join(dir, 'ours.gcode');
    sliceOurs(changed, ours);
    const theirs = sliceDesktop(join(dir, 'desktop'), join(dir, 'project.3mf'));
    const cmp = compare(theirs.gcode, ours);
    console.log(cmp.report.split('\n').filter((l) => l.includes('<--') || l.startsWith('RESULT')).join('\n'));
    results.push({ name: c.name, ok: !cmp.ok, note: cmp.ok ? 'the comparison missed one wall fewer' : `caught: ${summary(cmp.report)}` });
  } catch (e) {
    results.push({ name: c.name, ok: false, note: e.message });
  }
}

// Settings: ours for the presets the cases use, against desktop's own preset
// files (resources/profiles in the app), each resolved through its inherits.
const settingsProblems = checkSettings();
results.push({
  name: 'settings', ok: settingsProblems.length === 0,
  note: settingsProblems.length ? settingsProblems.slice(0, 5).join('; ') : 'same as desktop\'s preset files',
});

function summary(report) {
  const bad = report.split('\n').filter((l) => l.includes('<--')).map((l) => l.replace(/^\s*<-- /, ''));
  if (bad.length) return bad.slice(0, 3).join('; ') + (bad.length > 3 ? ` and ${bad.length - 3} more` : '');
  const total = /^TOTAL\s+([\d.]+)\s+([\d.]+)/m.exec(report);
  return total ? `filament ${total[1]} vs ${total[2]} mm` : 'match';
}

function checkSettings() {
  const profiles = join(dirname(desktop), 'resources/profiles');
  const index = new Map();
  for (const vendor of readdirSync(profiles, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const kind of ['machine', 'process', 'filament']) {
      const walk = (d) => {
        if (!existsSync(d)) return;
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory()) walk(join(d, e.name));
          else if (e.name.endsWith('.json')) {
            const key = `${kind}/${e.name.slice(0, -5)}`;
            // Snapmaker's own files win over another vendor's of the same name.
            if (!index.has(key) || vendor.name === 'Snapmaker') index.set(key, join(d, e.name));
          }
        }
      };
      walk(join(profiles, vendor.name, kind));
    }
  }
  const load = (kind, name, seen = 0) => {
    const file = index.get(`${kind}/${name}`);
    if (!file) throw new Error(`desktop has no ${kind} preset "${name}"`);
    const j = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    if (j.inherits && seen < 20) return { ...load(kind, j.inherits, seen + 1), ...j };
    return j;
  };
  const META = new Set(['name', 'from', 'inherits', 'setting_id', 'instantiation', 'type', 'version', 'filament_id',
    'compatible_printers', 'compatible_printers_condition', 'compatible_prints', 'compatible_prints_condition',
    'print_settings_id', 'printer_settings_id', 'filament_settings_id', 'renamed_from', 'description', 'include']);
  const problems = [];
  const processes = [DEFAULT_PROCESS, PROCESS.fine];
  for (const process of processes) {
    try {
      const sel = select({ process });
      const ours = call(engine, 'presetsFullConfig', '{}').config;
      const theirs = { ...load('machine', sel.printer), ...load('process', sel.process), ...load('filament', sel.filaments[0]) };
      for (const [k, v] of Object.entries(theirs)) {
        if (META.has(k) || EXPECTED_SETTINGS[k] || !(k in ours)) continue;
        if (!sameSetting(v, ours[k])) problems.push(`${sel.process.split(' @')[0]}: ${k} is ${show(v)} on desktop, ${show(ours[k])} ours`);
      }
    } catch (e) {
      problems.push(e.message);
    }
  }
  console.log(`\n=== settings against desktop's preset files: ${problems.length ? problems.join('\n  ') : 'same'}`);
  return problems;
}

// Our config holds Orca's serialized text: lists joined by "," (colours and
// a few others by ";"), strings lists "quoted","like this" with \\ escapes. A
// preset file holds JSON strings and arrays.
function readings(text) {
  const unescape = (t) => t.replace(/\\(.)/g, (_, ch) => (ch === 'n' ? '\n' : ch));
  if (!text.startsWith('"')) return [[text], [unescape(text)], text.split(','), text.split(';')];
  const list = [];
  const re = /"((?:[^"\\]|\\.)*)"(?:,|;|$)/gy;
  let m;
  while ((m = re.exec(text))) list.push(unescape(m[1]));
  return [list];
}
function sameValue(a, b) {
  return a === b || (a !== '' && b !== '' && !Number.isNaN(Number(a)) && Number(a) === Number(b));
}
function sameSetting(theirs, oursText) {
  const want = (Array.isArray(theirs) ? theirs : [theirs]).map(String);
  return readings(String(oursText)).some((list) =>
    (list.length === want.length && list.every((x, i) => sameValue(want[i], x)))
    // One value in the file, repeated for every extruder or filament in ours.
    || (want.length === 1 && list.every((x) => sameValue(want[0], x))));
}
function show(v) {
  return JSON.stringify(Array.isArray(v) ? v.join(';') : v).slice(0, 60);
}

// Report.
const failed = results.filter((r) => !r.ok);
const name = flavor === 'orca' ? 'OrcaSlicer' : 'Snapmaker Orca';
const lines = [
  `### Desktop ${name}: ${failed.length ? `${failed.length} of ${results.length} differ` : `all ${results.length} match`}`,
  '',
  '| Check | Result | Details |',
  '|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.ok ? 'match' : '**differs**'} | ${String(r.note).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`),
  '',
  'On purpose: ' + Object.entries(EXPECTED_SETTINGS).map(([k, why]) => `\`${k}\` (${why})`).join('; ') + '; the colour-mix prime tower (patches/snapmaker/0009).',
];
console.log('\n' + lines.join('\n'));
writeFileSync(join(outDir, 'summary.md'), lines.join('\n') + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n\n');
process.exit(failed.length ? 1 : 0);

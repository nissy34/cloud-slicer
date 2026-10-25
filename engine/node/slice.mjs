#!/usr/bin/env node
// Slice a model with the wasm engine under Node.js, using Snapmaker Orca's own
// presets, like desktop Orca's sidebar.
//
//   node engine/node/slice.mjs <model> <out.gcode> [options]
//     --printer NAME      printer preset (default "Snapmaker U1 (0.4 nozzle)")
//     --process NAME      process preset (default: the printer's default)
//     --filament NAME     filament preset for the next slot; repeat per slot
//     --set KEY=VALUE     override any Orca option; repeatable
//     --plate N           plate to slice (0-based, default 0)
//     --list              print the printer's compatible processes and filaments
//     --config-out FILE   also write the final config as JSON
//
// A printer that takes a .gcode.3mf (Bambu Lab, or its use_3mf on) also gets
// <out.gcode>.3mf.
//
// Needs the engine build (engine/build/engine) and the preset bundle
// (node engine/scripts/bundle-profiles.mjs engine/build/profiles).
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { DEFAULT_PRINTER, bedSize, call, openEngine } from './engine.mjs';

const args = process.argv.slice(2);
const opts = { printer: DEFAULT_PRINTER, filaments: [], set: {}, plate: 0 };
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--printer') opts.printer = args[++i];
  else if (a === '--process') opts.process = args[++i];
  else if (a === '--filament') opts.filaments.push(args[++i]);
  else if (a === '--plate') opts.plate = Number(args[++i]);
  else if (a === '--config-out') opts.configOut = args[++i];
  else if (a === '--list') opts.list = true;
  else if (a === '--set') {
    const [k, ...v] = args[++i].split('=');
    opts.set[k] = v.join('=');
  } else positional.push(a);
}
const [modelArg, outArg] = positional;
if (!opts.list && (!modelArg || !outArg)) {
  console.error('usage: slice.mjs <model> <out.gcode> [--printer N] [--process N] [--filament N]... [--set k=v]... [--plate N]');
  process.exit(2);
}

const t0 = performance.now();
const { engine, presets } = await openEngine();
console.error(`presets: ${JSON.stringify(presets.counts)}`);

const sel = call(engine, 'presetsSelect', JSON.stringify({
  printer: opts.printer,
  ...(opts.process && { process: opts.process }),
  ...(opts.filaments.length && { filaments: opts.filaments }),
}));
if (opts.list) {
  console.log(JSON.stringify({ selection: sel.selection, processes: sel.processes.map((p) => p.name), filaments: sel.filaments.map((f) => f.name) }, null, 2));
  process.exit(0);
}
console.error(`selection: ${JSON.stringify(sel.selection)}`);
if (sel.selection.printer !== opts.printer) {
  console.error(`printer preset "${opts.printer}" not found (is its brand in the preset bundle?)`);
  process.exit(1);
}

const full = call(engine, 'presetsFullConfig', JSON.stringify(opts.set));
if (full.errors.length) console.error(`config errors: ${full.errors.join('; ')}`);
const [bedW, bedD] = bedSize(full.config);
const tInit = performance.now();

const modelPath = `/work/${basename(modelArg)}`;
engine.FS.writeFile(modelPath, readFileSync(modelArg));
const loaded = call(engine, 'loadModel', modelPath, opts.plate, bedW, bedD, false, 0);
const info = JSON.parse(engine.modelInfoJson());
console.error(`model: ${info.objects.length} objects on ${info.plates.length} plate(s)${loaded.isProject ? ' (project)' : ''}`);
const tLoad = performance.now();

let lastStage = '';
const result = JSON.parse(engine.sliceWithConfig(JSON.stringify(full.config), opts.plate, '/work/out.gcode', (pct, stage) => {
  if (stage !== lastStage) {
    console.error(`  [${String(pct).padStart(3)}%] ${stage}`);
    lastStage = stage;
  }
}, null, basename(modelArg).replace(/\.[^.]+$/, '')));
const tSlice = performance.now();
console.error(`result: ${JSON.stringify(result)}`);
if (opts.configOut) writeFileSync(opts.configOut, JSON.stringify(full.config, null, 1));
if (!result.success) process.exit(1);

writeFileSync(outArg, engine.FS.readFile(result.gcodePath));
if (result.gcode3mfPath) writeFileSync(`${outArg}.3mf`, engine.FS.readFile(result.gcode3mfPath));
console.error(
  `timing: init ${(tInit - t0).toFixed(0)}ms, load ${(tLoad - tInit).toFixed(0)}ms, slice ${(tSlice - tLoad).toFixed(0)}ms; ` +
  `rss ${(process.memoryUsage().rss / 2 ** 20).toFixed(0)}MB`);
// Pthread workers keep the event loop alive; exit explicitly.
process.exit(0);

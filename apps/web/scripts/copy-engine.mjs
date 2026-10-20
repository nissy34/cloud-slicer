// Puts everything the engine worker loads into public/engine/, where Vite
// serves it as-is (the worker is a classic script: Emscripten pthreads re-run
// it with importScripts):
//   orca-engine.js / .wasm   the engine build
//   profiles.json, assets/   the Snapmaker Orca system presets (bundle-profiles.mjs)
//   settings-layout.json     desktop Orca's settings pages (extract-settings-layout.mjs)
//   calib/                   calibration test models (resources/calib, plus
//                            engine/calib for the STEP model as STL)
//   handy_models/            the plate menu's handy models (resources/handy_models)
//   fonts/                   the Text tool's bundled fonts (src/lib/fonts.ts)
//
//   ENGINE_DIR  engine build dir (default: ../../engine/build/engine)
//
// Upstream OrcaSlicer, the second engine: when ENGINE_ORCA_DIR (default
// ../../engine/build/engine-orca) holds a build, it goes into public/engine-orca/
// with its own presets and settings pages; the page loads it with ?engine=orca.
//
// Without ENGINE_DIR, and outside CI, it first runs engine/scripts/fetch-engine.mjs,
// which downloads the engine CI built for this checkout's engine sources (seconds)
// unless engine/build/engine already has it. ENGINE_FETCH=0 turns that off.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(web, '../..');
const engineDir = process.env.ENGINE_DIR ?? join(repo, 'engine/build/engine');
const out = join(web, 'public/engine');
if (!process.env.ENGINE_DIR && !process.env.CI && process.env.ENGINE_FETCH !== '0') {
  try {
    execFileSync('node', [join(repo, 'engine/scripts/fetch-engine.mjs'), '--quiet'], { stdio: 'inherit' });
  } catch {
    // fetch-engine said why; carry on with whatever engine build is there.
  }
}
mkdirSync(out, { recursive: true });

const binaries = ['orca-engine.js', 'orca-engine.wasm'].map((f) => join(engineDir, f));
const missing = binaries.filter((f) => !existsSync(f));
if (missing.length) {
  console.warn(`copy-engine: not found, the page will load without an engine:\n  ${missing.join('\n  ')}`);
  console.warn('Download it (node engine/scripts/fetch-engine.mjs), build it (README.md) or set ENGINE_DIR.');
}
for (const src of binaries) if (existsSync(src)) copyFileSync(src, join(out, src.split('/').pop()));

if (existsSync(join(repo, 'engine/orcaslicer/resources/profiles'))) {
  execFileSync('node', [join(repo, 'engine/scripts/bundle-profiles.mjs'), out], { stdio: 'inherit' });
  execFileSync('node', [join(repo, 'engine/scripts/extract-settings-layout.mjs'), join(out, 'settings-layout.json')], { stdio: 'inherit' });
  // The engine reads no STEP files, so that one comes from engine/calib.
  // pass1.3mf is an unused copy of flowrate-test-pass1.3mf; the PA pattern
  // test isn't offered yet.
  const unused = ['pass1.3mf', 'pa_pattern.3mf'];
  rmSync(join(out, 'calib'), { recursive: true, force: true });
  cpSync(join(repo, 'engine/orcaslicer/resources/calib'), join(out, 'calib'), {
    recursive: true,
    filter: (src) => !/\.(step|stp)$/i.test(src) && !unused.includes(basename(src)),
  });
  copyFileSync(join(repo, 'engine/calib/SpeedTestStructure.stl'), join(out, 'calib/volumetric_speed/SpeedTestStructure.stl'));
  // Fetched only when picked from the plate menu's Add handy models.
  rmSync(join(out, 'handy_models'), { recursive: true, force: true });
  cpSync(join(repo, 'engine/orcaslicer/resources/handy_models'), join(out, 'handy_models'), { recursive: true });
} else {
  console.warn('copy-engine: engine/orcaslicer is not checked out; no presets bundled.');
}

// Upstream OrcaSlicer: the same worker and files from its own build and sources.
const orcaDir = process.env.ENGINE_ORCA_DIR ?? join(repo, 'engine/build/engine-orca');
const orcaOut = join(web, 'public/engine-orca');
rmSync(orcaOut, { recursive: true, force: true });
if (existsSync(join(orcaDir, 'orca-engine.wasm')) && existsSync(join(repo, 'engine/orcaslicer-upstream/resources/profiles'))) {
  mkdirSync(orcaOut, { recursive: true });
  for (const f of ['orca-engine.js', 'orca-engine.wasm']) copyFileSync(join(orcaDir, f), join(orcaOut, f));
  copyFileSync(join(out, 'engine-worker.js'), join(orcaOut, 'engine-worker.js'));
  const env = { ...process.env, ENGINE_FLAVOR: 'orca' };
  execFileSync('node', [join(repo, 'engine/scripts/bundle-profiles.mjs'), orcaOut], { stdio: 'inherit', env });
  execFileSync('node', [join(repo, 'engine/scripts/extract-settings-layout.mjs'), join(orcaOut, 'settings-layout.json')], { stdio: 'inherit', env });
  // The same calibration and handy models as Snapmaker Orca: upstream ships some
  // of them only as Draco (.drc) files, which the engine can't read, and the page
  // asks for them by Snapmaker's file names (src/lib/calibration.ts).
  for (const dir of ['calib', 'handy_models']) if (existsSync(join(out, dir))) cpSync(join(out, dir), join(orcaOut, dir), { recursive: true });
}

// The Text tool's bundled fonts, from their npm packages.
const fontSources = {
  'NotoSans-Regular.ttf': ['@expo-google-fonts/noto-sans', '400Regular/NotoSans_400Regular.ttf'],
  'NotoSans-Bold.ttf': ['@expo-google-fonts/noto-sans', '700Bold/NotoSans_700Bold.ttf'],
  'NotoSans-Italic.ttf': ['@expo-google-fonts/noto-sans', '400Regular_Italic/NotoSans_400Regular_Italic.ttf'],
  'NotoSans-BoldItalic.ttf': ['@expo-google-fonts/noto-sans', '700Bold_Italic/NotoSans_700Bold_Italic.ttf'],
  'NotoSerif-Regular.ttf': ['@expo-google-fonts/noto-serif', '400Regular/NotoSerif_400Regular.ttf'],
  'NotoSerif-Bold.ttf': ['@expo-google-fonts/noto-serif', '700Bold/NotoSerif_700Bold.ttf'],
  'NotoSansMono-Regular.ttf': ['@expo-google-fonts/noto-sans-mono', '400Regular/NotoSansMono_400Regular.ttf'],
  'NotoSansHebrew-Regular.ttf': ['@expo-google-fonts/noto-sans-hebrew', '400Regular/NotoSansHebrew_400Regular.ttf'],
  'NotoSansHebrew-Bold.ttf': ['@expo-google-fonts/noto-sans-hebrew', '700Bold/NotoSansHebrew_700Bold.ttf'],
  'Rubik-Regular.ttf': ['@expo-google-fonts/rubik', '400Regular/Rubik_400Regular.ttf'],
  'Rubik-Bold.ttf': ['@expo-google-fonts/rubik', '700Bold/Rubik_700Bold.ttf'],
  'Heebo-Regular.ttf': ['@expo-google-fonts/heebo', '400Regular/Heebo_400Regular.ttf'],
  'Heebo-Bold.ttf': ['@expo-google-fonts/heebo', '700Bold/Heebo_700Bold.ttf'],
  'FrankRuhlLibre-Regular.ttf': ['@expo-google-fonts/frank-ruhl-libre', '400Regular/FrankRuhlLibre_400Regular.ttf'],
  'FrankRuhlLibre-Bold.ttf': ['@expo-google-fonts/frank-ruhl-libre', '700Bold/FrankRuhlLibre_700Bold.ttf'],
};
mkdirSync(join(out, 'fonts'), { recursive: true });
for (const [file, [pkg, path]] of Object.entries(fontSources)) {
  const src = join(web, 'node_modules', pkg, path);
  if (existsSync(src)) copyFileSync(src, join(out, 'fonts', file));
  else console.warn(`copy-engine: font not found: ${src} (npm install first)`);
}
if (existsSync(orcaOut)) cpSync(join(out, 'fonts'), join(orcaOut, 'fonts'), { recursive: true });

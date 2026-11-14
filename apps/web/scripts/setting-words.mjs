// Writes src/i18n/settings/<lang>.json: desktop Orca's own translation of every setting
// text (names, tooltips, units, choices, page and group titles), keyed by its English
// words, for each language desktop ships. The site shows them with settingText()
// (src/i18n/index.ts); docs/architecture/languages.md.
//
//   node scripts/setting-words.mjs [orca-upstream-dir] [snapmaker-orca-dir]
//
// Both default to the engine submodules (engine/orcaslicer-upstream, engine/orcaslicer);
// only localization/i18n, src/libslic3r/PrintConfig.cpp and src/slic3r/GUI/Tab.cpp are read.
// Run again after an engine update. Upstream's translations come first; Snapmaker's fill
// in the settings only it has.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import gettext from 'gettext-parser';

const here = new URL('.', import.meta.url).pathname;
const [upstream = join(here, '../../../engine/orcaslicer-upstream'), snapmaker = join(here, '../../../engine/orcaslicer')] = process.argv.slice(2);
const out = join(here, '../src/i18n/settings');

// Every string the settings come from: the C string literals of the option definitions
// and of desktop's settings pages, with "adjacent" "literals" joined as C++ does.
const C_ESCAPES = { n: '\n', t: '\t', '"': '"', "'": "'", '\\': '\\', r: '\r' };
function literals(file) {
  const src = readFileSync(file, 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.includes('"') ? ' ' : m));
  const found = new Set();
  for (const m of src.matchAll(/"(?:[^"\\\n]|\\.)*"(?:\s*"(?:[^"\\\n]|\\.)*")*/g)) {
    const text = [...m[0].matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((p) => p[1]).join('');
    found.add(text.replace(/\\(.)/g, (_, c) => C_ESCAPES[c] ?? c));
  }
  return found;
}
const sources = (root) => ['src/libslic3r/PrintConfig.cpp', 'src/slic3r/GUI/Tab.cpp'].map((f) => join(root, f)).filter(existsSync);
const english = new Set([upstream, snapmaker].flatMap(sources).flatMap((f) => [...literals(f)]));
if (!english.size) throw new Error('No engine sources found: check out the engine submodules or pass their folders.');

// Orca names its folders pt_BR, zh_CN; the site uses pt-BR, zh-CN.
const site = (dir) => dir.replace('_', '-');
// Obsolete entries ("#~", no longer in the program) are dropped: their "#~|" lines trip the parser.
const withoutObsolete = (po) => po.replace(/^#~.*\n/gm, '');
function translations(root, dir) {
  const folder = join(root, 'localization/i18n', dir);
  if (!existsSync(folder)) return {};
  const po = readdirSync(folder).find((f) => f.endsWith('.po'));
  const words = {};
  for (const ctx of Object.values(gettext.po.parse(withoutObsolete(readFileSync(join(folder, po), 'utf8'))).translations))
    for (const [id, entry] of Object.entries(ctx)) {
      const text = entry.msgstr?.[0];
      if (id && text && english.has(id) && !entry.comments?.flag?.includes('fuzzy') && !(id in words)) words[id] = text;
    }
  return words;
}

mkdirSync(out, { recursive: true });
const dirs = readdirSync(join(upstream, 'localization/i18n'), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'en');
for (const { name } of dirs) {
  const words = { ...translations(snapmaker, name), ...translations(upstream, name) };
  const sorted = Object.fromEntries(Object.entries(words).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(join(out, `${site(name)}.json`), `${JSON.stringify(sorted, null, 0).replace(/","/g, '",\n"')}\n`);
  console.log(`${site(name)}: ${Object.keys(sorted).length} setting texts`);
}

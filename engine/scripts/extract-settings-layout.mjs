#!/usr/bin/env node
// Extracts desktop Orca's settings layout (which options appear on which page
// and group of the Process / Filament / Printer tabs) from the engine's
// src/slic3r/GUI/Tab.cpp, so the web settings panel shows the same pages in
// the same order as desktop.
//
//   node engine/scripts/extract-settings-layout.mjs <out.json>
//
// Output: { print: [{ page, groups: [{ title, options: [key, ...] }] }], filament: [...], printer: [...] }.
// Keys are Orca option keys; per-extruder printer options appear once.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// ENGINE_FLAVOR=orca reads upstream OrcaSlicer's pages instead.
const source = process.env.ENGINE_FLAVOR === 'orca' ? '../orcaslicer-upstream' : '../orcaslicer';
const tabCpp = readFileSync(resolve(here, source, 'src/slic3r/GUI/Tab.cpp'), 'utf8');
const out = process.argv[2];
if (!out) {
  console.error('usage: extract-settings-layout.mjs <out.json>');
  process.exit(2);
}

// Body of `void <cls>::<fn>()`, by brace matching.
function body(cls, fn) {
  const start = tabCpp.search(new RegExp(`\\nvoid ${cls}::${fn}\\([^)]*\\)\\s*\\n?\\{`));
  if (start < 0) return '';
  let i = tabCpp.indexOf('{', start);
  const from = i;
  let depth = 0;
  for (; i < tabCpp.length; i++) {
    if (tabCpp[i] === '{') depth++;
    else if (tabCpp[i] === '}' && --depth === 0) break;
  }
  return tabCpp.slice(from, i);
}

const TOKEN = new RegExp(
  [
    String.raw`add_options_page\(\s*L\("([^"]+)"\)`,  // 1: page
    String.raw`new_optgroup\(\s*L\("([^"]+)"\)`,       // 2: group
    String.raw`append_single_option_line\(\s*"([a-z0-9_]+)"`, // 3: option
    String.raw`get_option\(\s*"([a-z0-9_]+)"`,         // 4: option (line built by hand)
    String.raw`append_option_line\(\s*optgroup\s*,\s*"([a-z0-9_]+)"`, // 5: option
  ].join('|'),
  'g',
);

function layout(source) {
  const pages = [];
  let page = null;
  let group = null;
  for (const line of source.split('\n')) {
    if (/^\s*\/\//.test(line)) continue; // commented-out lines
    for (const m of line.matchAll(TOKEN)) {
      if (m[1]) {
        page = pages.find((p) => p.page === m[1]);
        if (!page) pages.push((page = { page: m[1], groups: [] }));
        group = null;
      } else if (m[2]) {
        if (!page) pages.push((page = { page: 'General', groups: [] }));
        page.groups.push((group = { title: m[2], options: [] }));
      } else {
        const key = m[3] ?? m[4] ?? m[5];
        if (!group) continue;
        if (!group.options.includes(key)) group.options.push(key);
      }
    }
  }
  return pages.map((p) => ({ ...p, groups: p.groups.filter((g) => g.options.length) })).filter((p) => p.groups.length);
}

const result = {
  print: layout(body('TabPrint', 'build')),
  filament: layout(body('TabFilament', 'build')),
  printer: layout(body('TabPrinter', 'build_fff') + body('TabPrinter', 'build_unregular_pages')),
};
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));
for (const [tab, pages] of Object.entries(result)) {
  const n = pages.reduce((a, p) => a + p.groups.reduce((b, g) => b + g.options.length, 0), 0);
  console.log(`${tab}: ${pages.length} pages, ${n} options (${pages.map((p) => p.page).join(', ')})`);
}

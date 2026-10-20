#!/usr/bin/env node
// Extracts desktop Orca's settings layout (which options appear on which page
// and group of the Process / Filament / Printer tabs) from the engine's
// src/slic3r/GUI/Tab.cpp, so the web settings panel shows the same pages in
// the same order as desktop.
//
//   node engine/scripts/extract-settings-layout.mjs <out.json>
//
// Output: { print: [{ page, groups: [{ title, options: [key, ...] }] }], filament: [...], printer: [...] }.
// Keys are Orca option keys. A few pages carry more, for how desktop shows them:
//   extruder: true   desktop's "Extruder 1", "Extruder 2", ... pages: one page per
//                    extruder, each editing that extruder's entry of the options.
//   limits: [key]    options of the Motion ability page with a Normal and a Silent
//                    value (entries 0 and 1); the Silent one shows when silent_mode is on.
//   flavors: [name]  the page shows only for these gcode_flavor values.
//   overrides: true  the filament Setting Overrides page: each option can be left
//                    unset (nil), meaning the printer's own value is used.
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

// Body of `<type> <cls>::<fn>()`, by brace matching.
function body(cls, fn) {
  const start = tabCpp.search(new RegExp(`\\n\\w+ ${cls}::${fn}\\([^)]*\\)\\s*\\n?\\{`));
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
    // 5: TabPrinter::append_option_line, a Normal + Silent line: a key, or "prefix" + a loop variable
    String.raw`append_option_line\(\s*optgroup\s*,\s*((?:"[a-z0-9_]+"\s*\+\s*)?[a-z_"][a-z0-9_"]*)\s*\)`,
    String.raw`add_options_page\(\s*page_name\b`, // 6: the Extruder %d pages (match only)
    String.raw`^\s*"([a-z0-9_]+)",?\s*$`,             // 7: a key alone in a list (the overrides page)
  ].join('|'),
  'g',
);

// String lists a function builds lines from: `std::vector<std::string> axes{ "x", "y" }`
// and `for (const std::string &axis : axes)` loops over them.
function stringLists(source) {
  const lists = {};
  for (const m of source.matchAll(/std::vector<std::string>\s+(\w+)\s*\{([^}]*)\}/g)) lists[m[1]] = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  for (const m of source.matchAll(/for\s*\(\s*const\s+std::string\s*&\s*(\w+)\s*:\s*(\w+)\s*\)/g)) if (lists[m[2]]) lists[m[1]] = lists[m[2]];
  return lists;
}

// The keys a TabPrinter::append_option_line argument names.
function lineKeys(expr, lists) {
  const m = /^(?:"([a-z0-9_]*)"\s*\+\s*)?(?:"([a-z0-9_]+)"|(\w+))$/.exec(expr.trim());
  if (!m) return [];
  if (m[2]) return [(m[1] ?? '') + m[2]];
  return (lists[m[3]] ?? []).map((v) => (m[1] ?? '') + v);
}

function layout(source, { bareKeys = false } = {}) {
  const lists = stringLists(source);
  const pages = [];
  let page = null;
  let group = null;
  const add = (key) => group && !group.options.includes(key) && group.options.push(key);
  // A list's first key can share the line with its `for (... : {`.
  const text = bareKeys ? source.replace(/\{\s*"/g, '{\n"') : source;
  for (const line of text.split('\n')) {
    if (/^\s*\/\//.test(line)) continue; // commented-out lines
    for (const m of line.matchAll(TOKEN)) {
      if (m[1] || m[0].includes('page_name')) {
        const title = m[1] ?? 'Extruder';
        page = pages.find((p) => p.page === title);
        if (!page) pages.push((page = { page: title, ...(m[1] ? {} : { extruder: true }), groups: [] }));
        group = null;
      } else if (m[2]) {
        if (!page) pages.push((page = { page: 'General', groups: [] }));
        page.groups.push((group = { title: m[2], options: [] }));
      } else if (m[5]) {
        for (const key of lineKeys(m[5], lists)) {
          add(key);
          if (page) (page.limits ??= []).includes(key) || page.limits.push(key);
        }
      } else if (m[6]) {
        if (bareKeys) add(m[6]);
      } else {
        add(m[3] ?? m[4]);
      }
    }
  }
  return pages.map((p) => ({ ...p, groups: p.groups.filter((g) => g.options.length) })).filter((p) => p.groups.length);
}

// Filament: the Setting Overrides page is built in the middle of build(), where
// add_filament_overrides_page() is called (after Cooling).
const overrides = layout(body('TabFilament', 'add_filament_overrides_page'), { bareKeys: true }).map((p) => ({ ...p, overrides: true }));
const filamentBuild = body('TabFilament', 'build');
const overridesAt = filamentBuild.indexOf('add_filament_overrides_page()');
const filamentBefore = layout(filamentBuild.slice(0, overridesAt));
const filamentAfter = layout(filamentBuild.slice(overridesAt));
// The page the call sits in goes on after it ("Cooling" in both halves): merge it back.
const filament = [...filamentBefore];
for (const p of filamentAfter) {
  const same = filament.find((q) => q.page === p.page);
  if (same) same.groups.push(...p.groups);
  else filament.push(p);
}
filament.splice(filamentBefore.length, 0, ...overrides);

// Printer: build_fff() makes Basic information, Machine G-code and Notes; then
// build_unregular_pages() inserts Motion ability (build_kinematics_page(), only
// for Marlin, Klipper and RepRap flavors) after the first two, Multimaterial
// before the last two, and the extruder pages after the first three (TabPrinter
// in Tab.cpp), which ends as below.
const fff = layout(body('TabPrinter', 'build_fff'));
const unregular = layout(body('TabPrinter', 'build_unregular_pages'));
const kinematics = layout(body('TabPrinter', 'build_kinematics_page')).map((p) => ({
  ...p,
  flavors: ['marlin', 'marlin2', 'klipper', 'reprapfirmware'], // is_marlin_flavor in build_unregular_pages
}));
const printer = [...fff];
printer.splice(2, 0, ...kinematics);
printer.splice(printer.length - 2, 0, ...unregular.filter((p) => !p.extruder));
printer.splice(3, 0, ...unregular.filter((p) => p.extruder));

const result = {
  print: layout(body('TabPrint', 'build')),
  filament,
  printer,
};
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));
for (const [tab, pages] of Object.entries(result)) {
  const n = pages.reduce((a, p) => a + p.groups.reduce((b, g) => b + g.options.length, 0), 0);
  console.log(`${tab}: ${pages.length} pages, ${n} options (${pages.map((p) => p.page).join(', ')})`);
}

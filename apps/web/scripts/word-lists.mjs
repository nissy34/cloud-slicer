// Writes src/i18n/<lang>.ts for every language folder in src/i18n: each word file listed
// by name (not import.meta.glob) so code shared with Node can bundle it.
// Run after adding or removing a word file: node scripts/word-lists.mjs
// (words.test.ts fails when a list is out of step.) Also says how many words each
// language still lacks; add --list to name them.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/i18n/', import.meta.url).pathname;
const langs = readdirSync(root).filter((d) => d !== 'settings' && statSync(join(root, d)).isDirectory());
const name = (lang) => new Intl.DisplayNames(['en'], { type: 'language' }).of(lang);

for (const lang of langs) {
  const areas = readdirSync(join(root, lang))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
  const head =
    lang === 'en'
      ? `// Every English word file, listed by name (not import.meta.glob) so code shared with
// Node (the AI app add-on, apps/mcp) and Pages Functions can bundle it too.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in en/ is missing here.`
      : `// ${name(lang)}, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in ${lang}/ is missing here.`;
  const v = (a) => `w_${a}`;
  const out = `${head}
${areas.map((a) => `import ${v(a)} from './${lang}/${a}.json';`).join('\n')}

export default Object.assign(
  {},
${areas.map((a) => `  ${v(a)},`).join('\n')}
) as Record<string, unknown>;
`;
  writeFileSync(join(root, `${lang}.ts`), out);
}
console.log(`wrote ${langs.length} lists`);

// How many English words each language still lacks (they show in English).
const flat = (w, pre = '') => Object.entries(w).flatMap(([k, v]) => (typeof v === 'string' ? [pre + k] : flat(v, `${pre}${k}.`)));
const base = (k) => k.replace(/_(zero|one|two|few|many|other)$/, '');
const words = (lang) =>
  new Set(readdirSync(join(root, lang)).filter((f) => f.endsWith('.json')).flatMap((f) => flat(JSON.parse(readFileSync(join(root, lang, f), 'utf8')))).map(base));
const en = words('en');
for (const lang of langs.filter((l) => l !== 'en')) {
  const have = words(lang);
  const missing = [...en].filter((k) => !have.has(k));
  if (missing.length) console.log(`${lang}: ${missing.length} words still English${process.argv.includes('--list') ? `\n  ${missing.join('\n  ')}` : ''}`);
}

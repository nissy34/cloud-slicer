import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '.';

type Words = { [k: string]: string | Words };
const flat = (w: Words, pre = ''): Record<string, string> =>
  Object.fromEntries(Object.entries(w).flatMap(([k, v]) => (typeof v === 'string' ? [[pre + k, v]] : Object.entries(flat(v, `${pre}${k}.`)))));
// The <b>…</b> pieces <Trans> fills in must survive translation.
const tags = (s: string) => [...s.matchAll(/<\/?(\w+)>/g)].map((m) => m[0]).sort();
const vars = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
// i18next plural forms: "files_one", "files_other" are used as t('files', { count }).
const base = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, '');

const ALL = import.meta.glob<Words>(['./*/*.json', '!./settings/*.json'], { eager: true, import: 'default' });
const byLang = (lang: string) => Object.entries(ALL).filter(([p]) => p.startsWith(`./${lang}/`));
const EN = flat(Object.assign({}, ...byLang('en').map(([, w]) => w)));
const IDS: string[] = LANGUAGES.map((l) => l.id);
const OTHERS = Object.fromEntries(IDS.filter((l) => l !== 'en').map((l) => [l, flat(Object.assign({}, ...byLang(l).map(([, w]) => w)))]));
// Each language's list of its word files (en.ts, he.ts, de.ts, …).
const LISTS = import.meta.glob<Record<string, unknown>>(['./*.ts', '!./*.test.ts', '!./index.ts'], { eager: true, import: 'default' });
// Desktop Orca's setting names, one file per language it has (not Hebrew).
const SETTINGS = import.meta.glob<Record<string, string>>('./settings/*.json', { eager: true, import: 'default' });
const CODE = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true });
// Asked for directly: t('topbar.prepare'), i18n.t('topbar.prepare').
const asked = new Set(Object.values(CODE).flatMap((src) => [...src.matchAll(/\bt\(\s*'([\w.]+)'/g)].map((m) => m[1])));
// Or kept in a table first ({ label: 'topbar.prepare' }) and asked for later.
const named = new Set(Object.values(CODE).flatMap((src) => [...src.matchAll(/'([a-z]\w*\.[\w.]+)'/g)].map((m) => m[1])));
const areas = new Set(Object.keys(EN).map((k) => k.split('.')[0]));

describe('words', () => {
  it('every language has a folder and a list naming each of its word files', () => {
    const folders = [...new Set(Object.keys(ALL).map((p) => p.split('/')[1]))].sort();
    expect(folders).toEqual([...IDS].sort());
    for (const lang of IDS) {
      const list = LISTS[`./${lang}.ts`];
      expect(list, `${lang}.ts`).toBeDefined();
      // Each list merges its files' areas.
      expect(Object.keys(list).sort(), `${lang}.ts`).toEqual(byLang(lang).map(([p]) => p.split('/')[2].slice(0, -5)).sort());
    }
  });
  it('each language but English and Hebrew has desktop Orca setting names', () => {
    expect(Object.keys(SETTINGS).map((p) => p.slice(11, -5)).sort()).toEqual(IDS.filter((l) => l !== 'en' && l !== 'he').sort());
    for (const [path, words] of Object.entries(SETTINGS)) expect(Object.keys(words).length, path).toBeGreaterThan(1000);
  });
  it('each file holds only its own area', () => {
    for (const [path, words] of Object.entries(ALL)) {
      const area = path.split('/').pop()!.replace(/\.json$/, '');
      expect(Object.keys(words), path).toEqual([area]);
    }
  });
  it('every word the code asks for is in English', () => {
    const known = new Set(Object.keys(EN).map(base));
    expect([...asked].filter((k) => !known.has(k))).toEqual([]);
  });
  it('every word kept in a table is in English', () => {
    const known = new Set(Object.keys(EN).map(base));
    expect([...named].filter((k) => areas.has(k.split('.')[0]) && !known.has(k))).toEqual([]);
  });
  it('no English word is left unused', () => {
    expect(Object.keys(EN).filter((k) => !asked.has(base(k)) && !named.has(base(k)))).toEqual([]);
  });
  for (const [lang, words] of Object.entries(OTHERS)) {
    it(`${lang} has only words English has, with the same {{blanks}}`, () => {
      const englishBases = new Set(Object.keys(EN).map(base));
      for (const [k, v] of Object.entries(words)) {
        expect(englishBases.has(base(k)), `${lang}: ${k} is not in English`).toBe(true);
        expect(v.trim(), `${lang}: ${k} is empty`).not.toBe('');
        const enText = EN[k] ?? EN[`${base(k)}_other`] ?? '';
        // A plural form may leave the number out ("one file" in words).
        if (base(k) !== k) expect(vars(enText), `${lang}: ${k}`).toEqual(expect.arrayContaining(vars(v)));
        else expect(vars(v), `${lang}: ${k}`).toEqual(vars(enText));
        expect(tags(v), `${lang}: ${k} <tags>`).toEqual(tags(enText));
      }
    });
  }
});

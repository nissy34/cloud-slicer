import { describe, expect, it } from 'vitest';
import en from './en.json';
import he from './he.json';

type Words = { [k: string]: string | Words };
const flat = (w: Words, pre = ''): Record<string, string> =>
  Object.fromEntries(Object.entries(w).flatMap(([k, v]) => (typeof v === 'string' ? [[pre + k, v]] : Object.entries(flat(v, `${pre}${k}.`)))));
const vars = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
// i18next plural forms: "files_one", "files_other" are used as t('files', { count }).
const base = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, '');

const EN = flat(en as Words);
const OTHERS = { he: flat(he as Words) };
const CODE = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true });
// Asked for directly: t('topbar.prepare').
const asked = new Set(Object.values(CODE).flatMap((src) => [...src.matchAll(/\bt\(\s*'([\w.]+)'/g)].map((m) => m[1])));
// Or kept in a table first ({ label: 'topbar.prepare' }) and asked for later.
const named = new Set(Object.values(CODE).flatMap((src) => [...src.matchAll(/'([a-z]\w*\.[\w.]+)'/g)].map((m) => m[1])));

describe('words', () => {
  it('every word the code asks for is in English', () => {
    const known = new Set(Object.keys(EN).map(base));
    expect([...asked].filter((k) => !known.has(k))).toEqual([]);
  });
  it('no English word is left unused', () => {
    expect(Object.keys(EN).filter((k) => !asked.has(base(k)) && !named.has(base(k)))).toEqual([]);
  });
  for (const [lang, words] of Object.entries(OTHERS)) {
    it(`${lang} has only words English has, with the same {{blanks}}`, () => {
      const englishBases = new Set(Object.keys(EN).map(base));
      for (const [k, v] of Object.entries(words)) {
        expect(englishBases.has(base(k)), `${lang}: ${k} is not in en.json`).toBe(true);
        const enText = EN[k] ?? EN[`${base(k)}_other`] ?? '';
        // A plural form may leave the number out ("one file" in words).
        if (base(k) !== k) expect(vars(enText), `${lang}: ${k}`).toEqual(expect.arrayContaining(vars(v)));
        else expect(vars(v), `${lang}: ${k}`).toEqual(vars(enText));
      }
    });
  }
});

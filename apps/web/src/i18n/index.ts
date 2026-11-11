// The site's words in each language (docs/architecture/languages.md).
// One file per area and language: en/<area>.json holds { "<area>": { … } }.
// English is built in; another language's files are fetched only when picked,
// and a word they lack shows in English. Setting names and tooltips are not
// here: they come from the engine in English (option B, 2026-11-11).
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export type Language = 'en' | 'he';

/** Every language the site speaks, named in its own words. */
export const LANGUAGES: { id: Language; name: string; rtl?: boolean }[] = [
  { id: 'en', name: 'English' },
  { id: 'he', name: 'עברית', rtl: true },
];

type Words = Record<string, unknown>;
const join = (files: Record<string, Words>): Words => Object.assign({}, ...Object.values(files));

const EN = join(import.meta.glob<Words>('./en/*.json', { eager: true, import: 'default' }));
// Each other language is one file of its own (he.ts), fetched when picked.
const LOAD: Record<Exclude<Language, 'en'>, () => Promise<{ default: Words }>> = {
  he: () => import('./he'),
};

void i18n.use(initReactI18next).init({
  resources: { en: { translation: EN } },
  lng: 'en',
  fallbackLng: 'en',
  // React already escapes text.
  interpolation: { escapeValue: false },
});

/** Switch the site's words (fetching the language's files the first time). */
export async function loadLanguage(lang: Language): Promise<void> {
  if (lang !== 'en' && !i18n.hasResourceBundle(lang, 'translation')) {
    const words = await LOAD[lang]();
    i18n.addResourceBundle(lang, 'translation', words.default, true, true);
  }
  await i18n.changeLanguage(lang);
}

export { i18n };

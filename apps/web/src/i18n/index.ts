// The site's words in each language (docs/architecture/languages.md).
// English is built in; any other language's file is fetched only when picked,
// and a word it lacks shows in English. Setting names and tooltips are not
// here: they come from the engine in English, like desktop with no translation.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';

export type Language = 'en' | 'he';

/** Every language the site speaks, named in its own words. */
export const LANGUAGES: { id: Language; name: string; rtl?: boolean }[] = [
  { id: 'en', name: 'English' },
  { id: 'he', name: 'עברית', rtl: true },
];

const LOAD: Record<Exclude<Language, 'en'>, () => Promise<{ default: object }>> = {
  he: () => import('./he.json'),
};

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  // React already escapes text.
  interpolation: { escapeValue: false },
});

/** Switch the site's words (fetching the language's file the first time). */
export async function loadLanguage(lang: Language): Promise<void> {
  if (lang !== 'en' && !i18n.hasResourceBundle(lang, 'translation')) {
    const words = await LOAD[lang]();
    i18n.addResourceBundle(lang, 'translation', words.default, true, true);
  }
  await i18n.changeLanguage(lang);
}

export { i18n };

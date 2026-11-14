// The site's words in each language (docs/architecture/languages.md).
// One file per area and language: en/<area>.json holds { "<area>": { … } }.
// English is built in; another language's files are fetched only when picked,
// and a word they lack shows in English. Setting names and tooltips are not
// here: they come from the engine in English (option B, 2026-11-11).
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import EN from './en';

/**
 * Every language the site speaks, named in its own words. Besides English and Hebrew,
 * the ones desktop OrcaSlicer ships (its localization/i18n folder), machine-translated;
 * those also get the setting names desktop shows (settings/<lang>.json, from Orca's own
 * translations; Hebrew keeps them English as desktop has none).
 */
export const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'he', name: 'עברית', rtl: true },
  { id: 'ca', name: 'Català' },
  { id: 'cs', name: 'Čeština' },
  { id: 'de', name: 'Deutsch' },
  { id: 'es', name: 'Español' },
  { id: 'eu', name: 'Euskara' },
  { id: 'fr', name: 'Français' },
  { id: 'hu', name: 'Magyar' },
  { id: 'it', name: 'Italiano' },
  { id: 'ja', name: '日本語' },
  { id: 'ko', name: '한국어' },
  { id: 'lt', name: 'Lietuvių' },
  { id: 'nl', name: 'Nederlands' },
  { id: 'pl', name: 'Polski' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
  { id: 'ru', name: 'Русский' },
  { id: 'sv', name: 'Svenska' },
  { id: 'th', name: 'ไทย' },
  { id: 'tr', name: 'Türkçe' },
  { id: 'uk', name: 'Українська' },
  { id: 'vi', name: 'Tiếng Việt' },
  { id: 'zh-CN', name: '简体中文' },
  { id: 'zh-TW', name: '繁體中文' },
] as const satisfies readonly { id: string; name: string; rtl?: boolean }[];

export type Language = (typeof LANGUAGES)[number]['id'];

type Words = Record<string, unknown>;
type Settings = Record<string, string>;

// Each other language is one file of its own (he.ts, de.ts, …), fetched when picked,
// with desktop Orca's setting names beside it (none for Hebrew).
const LOAD: Record<Exclude<Language, 'en'>, () => Promise<[{ default: Words }, { default: Settings }?]>> = {
  he: () => Promise.all([import('./he')]),
  ca: () => Promise.all([import('./ca'), import('./settings/ca.json')]),
  cs: () => Promise.all([import('./cs'), import('./settings/cs.json')]),
  de: () => Promise.all([import('./de'), import('./settings/de.json')]),
  es: () => Promise.all([import('./es'), import('./settings/es.json')]),
  eu: () => Promise.all([import('./eu'), import('./settings/eu.json')]),
  fr: () => Promise.all([import('./fr'), import('./settings/fr.json')]),
  hu: () => Promise.all([import('./hu'), import('./settings/hu.json')]),
  it: () => Promise.all([import('./it'), import('./settings/it.json')]),
  ja: () => Promise.all([import('./ja'), import('./settings/ja.json')]),
  ko: () => Promise.all([import('./ko'), import('./settings/ko.json')]),
  lt: () => Promise.all([import('./lt'), import('./settings/lt.json')]),
  nl: () => Promise.all([import('./nl'), import('./settings/nl.json')]),
  pl: () => Promise.all([import('./pl'), import('./settings/pl.json')]),
  'pt-BR': () => Promise.all([import('./pt-BR'), import('./settings/pt-BR.json')]),
  ru: () => Promise.all([import('./ru'), import('./settings/ru.json')]),
  sv: () => Promise.all([import('./sv'), import('./settings/sv.json')]),
  th: () => Promise.all([import('./th'), import('./settings/th.json')]),
  tr: () => Promise.all([import('./tr'), import('./settings/tr.json')]),
  uk: () => Promise.all([import('./uk'), import('./settings/uk.json')]),
  vi: () => Promise.all([import('./vi'), import('./settings/vi.json')]),
  'zh-CN': () => Promise.all([import('./zh-CN'), import('./settings/zh-CN.json')]),
  'zh-TW': () => Promise.all([import('./zh-TW'), import('./settings/zh-TW.json')]),
};

/** Desktop Orca's own translation of each setting text, by its English words. */
const SETTINGS = new Map<string, Settings>();

void i18n.use(initReactI18next).init({
  resources: { en: { translation: EN } },
  lng: 'en',
  fallbackLng: 'en',
  // English is built in, so it is ready at once (the AI app add-on reads words while it starts).
  initAsync: false,
  // React already escapes text.
  interpolation: { escapeValue: false },
});

/** Switch the site's words (fetching the language's files the first time). */
export async function loadLanguage(lang: Language): Promise<void> {
  if (lang !== 'en' && !i18n.hasResourceBundle(lang, 'translation')) {
    const [words, settings] = await LOAD[lang]();
    i18n.addResourceBundle(lang, 'translation', words.default, true, true);
    if (settings) SETTINGS.set(lang, settings.default);
  }
  await i18n.changeLanguage(lang);
}

/**
 * A setting's words (name, tooltip, unit, choice, page or group title) as desktop Orca
 * shows them in the current language, from Orca's own translations; English when it has
 * none. Desktop's numbered pages ("Extruder 2") keep their number.
 */
export function settingText(english: string): string {
  const words = SETTINGS.get(i18n.language);
  if (!words || !english) return english;
  const found = words[english];
  if (found) return found;
  const numbered = /^(.*\S) (\d+)$/.exec(english);
  return numbered && words[numbered[1]] ? `${words[numbered[1]]} ${numbered[2]}` : english;
}

export { i18n };

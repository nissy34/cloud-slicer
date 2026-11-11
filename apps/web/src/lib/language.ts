// The site's language. The choice is System (follow the browser's languages),
// or one language. Like the theme (lib/theme.ts) it is kept in this browser, so
// the page starts in the right language and direction before the account
// loads (see index.html), and in the account's settings as 'language', so it
// follows the user to their other devices. Hebrew turns the page right to left.
import { create } from 'zustand';
import { LANGUAGES, loadLanguage, type Language } from '../i18n';

export type LanguageChoice = 'system' | Language;

export const LANGUAGE_KEY = 'cloud-slicer:language';
export const LANGUAGE_SETTING = 'language';

export function isLanguageChoice(v: unknown): v is LanguageChoice {
  return v === 'system' || LANGUAGES.some((l) => l.id === v);
}

/** The first of the browser's languages the site speaks, else English. */
export function browserLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    // Old browsers still say "iw" for Hebrew.
    const base = tag.toLowerCase().split('-')[0].replace(/^iw$/, 'he');
    const hit = LANGUAGES.find((l) => l.id === base);
    if (hit) return hit.id;
  }
  return 'en';
}

export function resolveLanguage(choice: LanguageChoice, preferred: readonly string[]): Language {
  return choice === 'system' ? browserLanguage(preferred) : choice;
}

export const isRtl = (lang: Language) => !!LANGUAGES.find((l) => l.id === lang)?.rtl;

function loadChoice(): LanguageChoice {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY);
    return isLanguageChoice(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

const preferred = (): readonly string[] => (typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);

interface LanguageState {
  choice: LanguageChoice;
}

export const useLanguageStore = create<LanguageState>(() => ({ choice: loadChoice() }));

function apply({ choice }: LanguageState) {
  const lang = resolveLanguage(choice, preferred());
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
  }
  loadLanguage(lang).catch(() => {});
}
apply(useLanguageStore.getState());
useLanguageStore.subscribe(apply);
if (typeof window !== 'undefined') window.addEventListener('languagechange', () => apply(useLanguageStore.getState()));

/** Change the language in this browser only (e.g. when the account's copy arrives). */
export function setLocalLanguage(choice: LanguageChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(LANGUAGE_KEY);
    else localStorage.setItem(LANGUAGE_KEY, choice);
  } catch {
    // storage unavailable: kept until the tab closes
  }
  useLanguageStore.setState({ choice });
}

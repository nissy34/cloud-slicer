// The site's language: English unless picked otherwise (owner's call: never
// guessed from the browser). Like the theme (lib/theme.ts) it is kept in this browser, so
// the page starts in the right language and direction before the account
// loads (see index.html), and in the account's settings as 'language', so it
// follows the user to their other devices. Hebrew turns the page right to left.
import { create } from 'zustand';
import { LANGUAGES, loadLanguage, type Language } from '../i18n';

export type LanguageChoice = Language;

export const LANGUAGE_KEY = 'cloud-slicer:language';
export const LANGUAGE_SETTING = 'language';

export function isLanguageChoice(v: unknown): v is LanguageChoice {
  return LANGUAGES.some((l) => l.id === v);
}

export const isRtl = (lang: Language) => LANGUAGES.some((l) => l.id === lang && 'rtl' in l && l.rtl);

function loadChoice(): LanguageChoice {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY);
    return isLanguageChoice(v) ? v : 'en';
  } catch {
    return 'en';
  }
}

interface LanguageState {
  choice: LanguageChoice;
}

export const useLanguageStore = create<LanguageState>(() => ({ choice: loadChoice() }));

function apply({ choice }: LanguageState) {
  const lang = choice;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
  }
  loadLanguage(lang).catch(() => {});
}
apply(useLanguageStore.getState());
useLanguageStore.subscribe(apply);

/** Change the language in this browser only (e.g. when the account's copy arrives). */
export function setLocalLanguage(choice: LanguageChoice) {
  try {
    if (choice === 'en') localStorage.removeItem(LANGUAGE_KEY);
    else localStorage.setItem(LANGUAGE_KEY, choice);
  } catch {
    // storage unavailable: kept until the tab closes
  }
  useLanguageStore.setState({ choice });
}

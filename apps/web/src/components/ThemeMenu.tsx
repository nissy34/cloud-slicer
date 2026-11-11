import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { saveUserSetting, useUserSetting } from '../state/account';
import { isThemeChoice, setLocalTheme, THEME_SETTING, useTheme, useThemeStore, type ThemeChoice } from '../lib/theme';
import { isLanguageChoice, LANGUAGE_SETTING, setLocalLanguage, useLanguageStore, type LanguageChoice } from '../lib/language';
import { LANGUAGES } from '../i18n';
import { Check, Moon, Sun } from 'lucide-react';
import { Menu } from './Menu';

const CHOICES: { id: ThemeChoice; label: 'theme.system' | 'theme.light' | 'theme.dark'; hint?: 'theme.systemHint' }[] = [
  { id: 'system', label: 'theme.system', hint: 'theme.systemHint' },
  { id: 'light', label: 'theme.light' },
  { id: 'dark', label: 'theme.dark' },
];

/**
 * Top bar button to pick System / Light / Dark, with the language under it.
 * The language follows the browser unless picked here, so it sits in this menu
 * rather than on a button of its own (docs/architecture/languages.md).
 */
export function ThemeMenu() {
  const { t } = useTranslation();
  const choice = useThemeStore((s) => s.choice);
  const language = useLanguageStore((s) => s.choice);
  const theme = useTheme();
  const saved = useUserSetting<unknown>(THEME_SETTING);
  const savedLanguage = useUserSetting<unknown>(LANGUAGE_SETTING);
  // The account's choice (from another device, or after sign-in) wins.
  useEffect(() => {
    if (isThemeChoice(saved)) setLocalTheme(saved);
  }, [saved]);
  useEffect(() => {
    if (isLanguageChoice(savedLanguage)) setLocalLanguage(savedLanguage);
  }, [savedLanguage]);

  const pick = (next: ThemeChoice) => {
    setLocalTheme(next);
    // Offline or signed-out saves still apply here; the account copy is a bonus.
    saveUserSetting(THEME_SETTING, next).catch(() => {});
  };
  const pickLanguage = (next: LanguageChoice) => {
    setLocalLanguage(next);
    saveUserSetting(LANGUAGE_SETTING, next).catch(() => {});
  };
  const languages: { id: LanguageChoice; label: string }[] = [{ id: 'system', label: t('language.system') }, ...LANGUAGES.map((l) => ({ id: l.id, label: l.name }))];
  const current = CHOICES.find((c) => c.id === choice);

  return (
    <Menu
      label={t('theme.menu')}
      placement="bottom-end"
      button={(props) => (
        <button {...props} className="ghost icon-button" aria-label={t('theme.current', { choice: current ? t(current.label) : '' })} title={t('theme.menu')}>
          {theme === 'dark' ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
        </button>
      )}
    >
      {(close) => (
        <>
          {CHOICES.map((c) => (
            <button
              key={c.id}
              role="menuitemradio"
              aria-checked={choice === c.id}
              className="menu-item"
              onClick={() => {
                close();
                pick(c.id);
              }}
            >
              <Check className="menu-check" size={16} aria-hidden style={{ visibility: choice === c.id ? 'visible' : 'hidden' }} />
              <span>{t(c.label)}</span>
              {c.hint && <span className="menu-hint">{t(c.hint)}</span>}
            </button>
          ))}
          <hr />
          <div className="menu-label" id="language-heading">
            {t('language.heading')}
          </div>
          <div role="group" aria-labelledby="language-heading">
            {languages.map((l) => (
              <button
                key={l.id}
                role="menuitemradio"
                aria-checked={language === l.id}
                className="menu-item"
                data-testid={`language-${l.id}`}
                onClick={() => {
                  close();
                  pickLanguage(l.id);
                }}
              >
                <Check className="menu-check" size={16} aria-hidden style={{ visibility: language === l.id ? 'visible' : 'hidden' }} />
                <span lang={l.id === 'system' ? undefined : l.id}>{l.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Menu>
  );
}

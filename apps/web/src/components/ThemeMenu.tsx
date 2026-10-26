import { useEffect } from 'react';
import { saveUserSetting, useUserSetting } from '../state/account';
import { isThemeChoice, setLocalTheme, THEME_SETTING, useTheme, useThemeStore, type ThemeChoice } from '../lib/theme';
import { Check, Moon, Sun } from 'lucide-react';
import { Menu } from './Menu';

const CHOICES: { id: ThemeChoice; label: string; hint: string }[] = [
  { id: 'system', label: 'System', hint: 'Match this device' },
  { id: 'light', label: 'Light', hint: '' },
  { id: 'dark', label: 'Dark', hint: '' },
];

/** Top bar button to pick System / Light / Dark. */
export function ThemeMenu() {
  const choice = useThemeStore((s) => s.choice);
  const theme = useTheme();
  const saved = useUserSetting<unknown>(THEME_SETTING);
  // The account's choice (from another device, or after sign-in) wins.
  useEffect(() => {
    if (isThemeChoice(saved)) setLocalTheme(saved);
  }, [saved]);

  const pick = (next: ThemeChoice) => {
    setLocalTheme(next);
    // Offline or signed-out saves still apply here; the account copy is a bonus.
    saveUserSetting(THEME_SETTING, next).catch(() => {});
  };

  return (
    <Menu
      label="Theme"
      placement="bottom-end"
      button={(props) => (
        <button {...props} className="ghost icon-button" aria-label={`Theme: ${CHOICES.find((c) => c.id === choice)?.label}`} title="Theme">
          {theme === 'dark' ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
        </button>
      )}
    >
      {(close) =>
        CHOICES.map((c) => (
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
            <span>{c.label}</span>
            {c.hint && <span className="menu-hint">{c.hint}</span>}
          </button>
        ))
      }
    </Menu>
  );
}

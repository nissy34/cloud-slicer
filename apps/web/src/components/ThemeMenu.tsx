import { useEffect, useRef, useState } from 'react';
import { saveUserSetting, useUserSetting } from '../state/account';
import { isThemeChoice, setLocalTheme, THEME_SETTING, useTheme, useThemeStore, type ThemeChoice } from '../lib/theme';
import { Moon, Sun } from 'lucide-react';

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
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // The account's choice (from another device, or after sign-in) wins.
  useEffect(() => {
    if (isThemeChoice(saved)) setLocalTheme(saved);
  }, [saved]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const pick = (next: ThemeChoice) => {
    setOpen(false);
    setLocalTheme(next);
    // Offline or signed-out saves still apply here; the account copy is a bonus.
    saveUserSetting(THEME_SETTING, next).catch(() => {});
  };

  return (
    <div className="theme-menu" ref={root}>
      <button
        className="ghost icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${CHOICES.find((c) => c.id === choice)?.label}`}
        title="Theme"
        onClick={() => setOpen(!open)}
      >
        {theme === 'dark' ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
      </button>
      {open && (
        <div className="theme-pop" role="menu" aria-label="Theme">
          {CHOICES.map((c) => (
            <button key={c.id} role="menuitemradio" aria-checked={choice === c.id} className={choice === c.id ? 'theme-item active' : 'theme-item'} onClick={() => pick(c.id)}>
              <span>{c.label}</span>
              {c.hint && <span className="theme-hint">{c.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

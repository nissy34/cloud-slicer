import { useEffect, useRef, useState } from 'react';
import { saveUserSetting, useUserSetting } from '../state/account';
import { isThemeChoice, setLocalTheme, THEME_SETTING, useTheme, useThemeStore, type ThemeChoice } from '../lib/theme';

const CHOICES: { id: ThemeChoice; label: string; hint: string }[] = [
  { id: 'system', label: 'System', hint: 'Match this device' },
  { id: 'light', label: 'Light', hint: '' },
  { id: 'dark', label: 'Dark', hint: '' },
];

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

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
        {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
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

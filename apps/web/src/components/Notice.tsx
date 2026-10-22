import type { ReactNode } from 'react';

/** How long good news stays (problems stay until closed). */
export const NOTICE_MS = 5000;

/** One message card: an icon or picture, what happened, its buttons, and ✕ when it can just go away. */
export function Notice({
  tone = 'info',
  icon,
  title,
  text,
  actions,
  onClose,
  testId,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'error';
  /** Defaults to a sign for the tone. */
  icon?: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  testId?: string;
}) {
  const sign = icon ?? (tone === 'ok' ? '✓' : tone === 'info' ? 'i' : '!');
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'} data-testid={testId}>
      <div className="notice-main">
        <span className="notice-icon" aria-hidden>
          {sign}
        </span>
        <div className="notice-text">
          <b>{title}</b>
          {text && <span>{text}</span>}
        </div>
        {onClose && (
          <button className="win-close" aria-label="Close message" onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      {actions && <div className="notice-actions">{actions}</div>}
    </div>
  );
}


import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

/**
 * The app's one pop-up window: a title with ✕, what it says or holds, and its
 * buttons along the bottom with the main one last. Only ✕, its own buttons and
 * Escape close it, so a stray tap outside never loses what's in it. Built on
 * <dialog>: a window opened over another sits on top and takes Escape first.
 * A phone gets the same centred window (styles/windows.css).
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  head,
  wide,
  className,
  role,
  testId,
  describedBy,
}: {
  title: ReactNode;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  /** Beside the title, before ✕ (the settings windows' Advanced switch). */
  head?: ReactNode;
  wide?: boolean;
  className?: string;
  /** 'alertdialog' for a question that interrupts. */
  role?: 'dialog' | 'alertdialog';
  testId?: string;
  describedBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    // showModal() moves focus to the first button (✕); keep it on an autoFocus field or button
    // inside, else on the window itself, so ✕ doesn't open with a focus ring.
    const focused = document.activeElement;
    d.showModal();
    if (focused instanceof HTMLElement && d.contains(focused)) focused.focus();
    else d.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={`win${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`}
      role={role === 'alertdialog' ? role : undefined}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="win-body">
        <header className="win-head">
          <h2 id={titleId}>{title}</h2>
          {head}
          <IconButton icon={X} label="Close" aria-label="Close window" onClick={onClose} />
        </header>
        <div className="win-content">{children}</div>
        {footer && <footer className="win-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

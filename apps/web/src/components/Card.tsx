import type { ReactNode } from 'react';

/** One card: a bold title in normal case, its actions on the right (Quiet or icon buttons), then the content. */
export function Card({
  title,
  actions,
  className,
  children,
  testId,
  label,
}: {
  /** Usually words; the Device tab passes a fold button. */
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
  testId?: string;
  /** What a screen reader calls the card when the title is not plain words. */
  label?: string;
}) {
  return (
    <section className={['card', className].filter(Boolean).join(' ')} aria-label={label ?? (typeof title === 'string' ? title : undefined)} data-testid={testId}>
      <header className="card-head">
        <h2>{title}</h2>
        {actions && <div className="card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

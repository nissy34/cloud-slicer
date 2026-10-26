import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** One empty place: an icon, one sentence, at most one main button, centred where the content would be. */
export function Empty({
  icon: Icon,
  title,
  text,
  action,
  children,
  className,
  testId,
}: {
  icon: LucideIcon;
  /** Only for a whole screen (Device with no printers). */
  title?: ReactNode;
  text: ReactNode;
  /** The one main button. */
  action?: ReactNode;
  /** Quieter things under it. */
  children?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={['empty-place', className].filter(Boolean).join(' ')} data-testid={testId}>
      <Icon className="empty-place-icon" size={title ? 40 : 28} strokeWidth={1.5} aria-hidden />
      {title && <h1>{title}</h1>}
      <p>{text}</p>
      {action}
      {children}
    </div>
  );
}

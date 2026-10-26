import { forwardRef, type ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: LucideIcon;
  /** What it does, for the tooltip and screen readers. */
  label: string;
  danger?: boolean;
};

/**
 * The app's one icon button: square, the same height as the other buttons, a
 * Lucide icon and always a tooltip (docs/architecture/design-system.md).
 */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton({ icon: Icon, label, danger, className, title, 'aria-label': ariaLabel, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className={['icon-btn', danger && 'danger', className].filter(Boolean).join(' ')} aria-label={ariaLabel ?? label} title={title ?? label} {...rest}>
      <Icon size={16} aria-hidden />
    </button>
  );
});

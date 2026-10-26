import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Menu } from './Menu';

/**
 * The ⓘ after a one-line hint (docs/architecture/design-system.md): the rest
 * of the explanation, shown on hover or a tap, so a card keeps one line of words.
 */
export function InfoTip({ label = 'More about this', children }: { label?: string; children: ReactNode }) {
  return (
    <Menu
      label={label}
      role="dialog"
      hover
      inline
      placement="top"
      className="info-pop"
      button={(props) => (
        <button {...props} type="button" className="info-tip" aria-label={label}>
          <Info size={14} aria-hidden />
        </button>
      )}
    >
      {children}
    </Menu>
  );
}

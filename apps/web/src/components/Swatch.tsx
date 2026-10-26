import type { ReactNode } from 'react';
import { textOn } from '../lib/mixing';

type Props = {
  colour?: string;
  /** The filament's number, drawn inside in black or white, whichever reads. */
  number?: ReactNode;
  /** sm: a dot in a list or menu; md: with its number; lg: the filament list. */
  size?: 'sm' | 'md' | 'lg';
  /** No filament loaded: striped. */
  empty?: boolean;
  title?: string;
  className?: string;
};

/** The app's one filament swatch: a rounded square in the filament's colour (docs/architecture/design-system.md). */
export function Swatch({ colour = '#888888', number, size = 'md', empty, title, className }: Props) {
  return (
    <span className={['swatch', size, empty && 'unloaded', className].filter(Boolean).join(' ')} style={empty ? undefined : { background: colour, color: textOn(colour) }} title={title} aria-hidden>
      {number}
    </span>
  );
}

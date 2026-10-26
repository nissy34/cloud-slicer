import { useState, type ReactNode } from 'react';
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  offset,
  safePolygon,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
  useRole,
  type Placement,
} from '@floating-ui/react';

type Props = {
  /** What the menu is, for screen readers ("Project"). */
  label: string;
  /** The button that opens it: spread `props` on it (they carry its ref, click and aria). */
  button: (props: Record<string, unknown>, open: boolean) => ReactNode;
  /** The rows (`.menu-item` buttons, `<hr />`, `.menu-note`); a function gets `close`. */
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
  /** `menu` for a list of actions; `dialog` for a pop-over card with fields (`.pop`). */
  role?: 'menu' | 'dialog';
  className?: string;
  /** Set both to open or close it from outside (a keyboard shortcut, a finished step). */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  /** Also open on a mouse hover (the ⓘ help), not only a click or tap. */
  hover?: boolean;
  /** Sits inside a line of text: a `span`, so it can go in a `<p>`. */
  inline?: boolean;
};

/**
 * One menu or pop-over (docs/architecture/design-system.md): opened by its button,
 * placed by Floating UI so it never runs off the screen, closed by Escape or a tap
 * outside. Rows are the shared `.menu-item` look, also used by the object menu and the
 * Picker.
 */
export function Menu({ label, button, children, placement = 'bottom-start', role = 'menu', className, open: openProp, onOpenChange, hover, inline }: Props) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(160, availableHeight)}px`;
        },
      }),
    ],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useHover(context, { enabled: !!hover, mouseOnly: true, delay: { open: 300 }, handleClose: safePolygon() }),
    useDismiss(context),
    useRole(context, { role }),
  ]);
  const Box = inline ? 'span' : 'div';
  const close = () => setOpen(false);
  return (
    <>
      {button({ ref: refs.setReference, ...getReferenceProps() }, open)}
      {open && (
        <FloatingFocusManager context={context} modal={false} initialFocus={role === 'menu' ? -1 : refs.floating}>
          <Box
            ref={refs.setFloating}
            className={[role === 'menu' ? 'menu' : 'pop', className].filter(Boolean).join(' ')}
            style={floatingStyles}
            aria-label={label}
            {...getFloatingProps()}
          >
            {typeof children === 'function' ? children(close) : children}
          </Box>
        </FloatingFocusManager>
      )}
    </>
  );
}

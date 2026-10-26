import { useRef, useState } from 'react';
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from '@floating-ui/react';
import { Check, ChevronDown } from 'lucide-react';

/** A choice in the list; the current one is bold with a ✓. */
export type PickerOption = { value: string; label: string; swatch?: string };
/** An action under the choices, after a line. Its words end in "…" when a window follows. */
export type PickerAction = { id: string; label: string; testId?: string };

type Props = {
  /** What is being picked, for screen readers ("Printer"). */
  label: string;
  value: string | null;
  options: PickerOption[];
  onChange(value: string): void;
  actions?: PickerAction[];
  onAction?(id: string): void;
  /** Extra class for the button, to size its words where it sits. */
  className?: string;
  testId?: string;
};

/**
 * The app's picker (docs/architecture/design-system.md): a button showing the current
 * choice, opening a list drawn in the theme, never the browser's own list, so a line and
 * actions can sit under the choices. Floating UI places it, keeps it on screen, and gives
 * arrow keys, Escape and closing on a tap outside.
 */
export function Picker({ label, value, options, onChange, actions = [], onAction, className, testId }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const current = options.find((o) => o.value === value);
  const selectedIndex = current ? options.indexOf(current) : null;

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
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
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'listbox' }),
    useListNavigation(context, { listRef: rows, activeIndex: active, selectedIndex, onNavigate: setActive, loop: true }),
  ]);

  const pick = (run: () => void) => {
    setOpen(false);
    run();
  };

  return (
    <>
      <button type="button" ref={refs.setReference} className={['picker', className].filter(Boolean).join(' ')} aria-label={label} data-testid={testId} {...getReferenceProps()}>
        {current?.swatch && <span className="picker-swatch" style={{ background: current.swatch }} />}
        <span className="picker-value">{current?.label ?? ''}</span>
        <ChevronDown className="picker-arrow" size={16} aria-hidden />
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div ref={refs.setFloating} className="picker-list" style={floatingStyles} aria-label={label} {...getFloatingProps()}>
              {options.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  ref={(el) => {
                    rows.current[i] = el;
                  }}
                  role="option"
                  aria-selected={o.value === value}
                  tabIndex={active === i ? 0 : -1}
                  className="menu-item"
                  {...getItemProps({ onClick: () => pick(() => onChange(o.value)) })}
                >
                  {o.swatch && <span className="picker-swatch" style={{ background: o.swatch }} />}
                  <span className="picker-label">{o.label}</span>
                  {o.value === value && <Check className="menu-check" size={16} aria-hidden />}
                </button>
              ))}
              {actions.length > 0 && <hr />}
              {actions.map((a, j) => {
                const i = options.length + j;
                return (
                  <button
                    key={a.id}
                    type="button"
                    ref={(el) => {
                      rows.current[i] = el;
                    }}
                    role="option"
                    aria-selected={false}
                    tabIndex={active === i ? 0 : -1}
                    className="menu-item picker-action"
                    data-testid={a.testId}
                    {...getItemProps({ onClick: () => pick(() => onAction?.(a.id)) })}
                  >
                    <span className="picker-label">{a.label}</span>
                  </button>
                );
              })}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

import { Fragment, useRef, useState, type ReactNode } from 'react';
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
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';

/** A choice in the list; the current one is bold with a ✓. Choices with the same `group`
 * sit together under its name (keep them in order); `hint` sits at the row's end. */
export type PickerOption = { value: string; label: string; swatch?: string; group?: string; hint?: ReactNode; disabled?: boolean };
/** An action under the choices, after a line, in the normal text colour with its icon in
 * front. Its words end in "…" when a window follows. */
export type PickerAction = { id: string; label: string; icon?: LucideIcon; testId?: string; disabled?: boolean };

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
  disabled?: boolean;
  /** Drawn as a field (a box like the other inputs), for a picker among fields. */
  field?: boolean;
  title?: string;
  /** What the button says when the value isn't one of the choices. */
  placeholder?: string;
};

/**
 * The app's picker (docs/architecture/design-system.md): a button showing the current
 * choice, opening a list drawn in the theme, never the browser's own list, so a line and
 * actions can sit under the choices. Floating UI places it, keeps it on screen, and gives
 * arrow keys, Escape and closing on a tap outside.
 */
export function Picker({ label, value, options, onChange, actions = [], onAction, className, testId, disabled, field, title, placeholder }: Props) {
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
        apply({ availableHeight, elements, rects }) {
          elements.floating.style.maxHeight = `${Math.max(160, availableHeight)}px`;
          // At least as wide as its button, like a dropdown.
          elements.floating.style.minWidth = `${rects.reference.width}px`;
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
      <button
        type="button"
        ref={refs.setReference}
        className={['picker', field && 'field-picker', className].filter(Boolean).join(' ')}
        aria-label={label}
        data-testid={testId}
        data-value={value ?? ''}
        disabled={disabled}
        title={title}
        {...getReferenceProps()}
      >
        {current?.swatch && <span className="picker-swatch" style={{ background: current.swatch }} />}
        <span className="picker-value">{current?.label ?? placeholder ?? ''}</span>
        <ChevronDown className="picker-arrow" size={16} aria-hidden />
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div ref={refs.setFloating} className="menu picker-list" style={floatingStyles} aria-label={label} {...getFloatingProps()}>
              {options.map((o, i) => (
                <Fragment key={o.value}>
                  {o.group && o.group !== options[i - 1]?.group && (
                    <div className="menu-label" role="presentation">
                      {o.group}
                    </div>
                  )}
                  <button
                    type="button"
                    ref={(el) => {
                      rows.current[i] = el;
                    }}
                    role="option"
                    aria-selected={o.value === value}
                    aria-disabled={o.disabled || undefined}
                    disabled={o.disabled}
                    tabIndex={active === i ? 0 : -1}
                    className="menu-item"
                    data-value={o.value}
                    {...getItemProps({ onClick: () => pick(() => onChange(o.value)) })}
                  >
                    {o.swatch && <span className="picker-swatch" style={{ background: o.swatch }} />}
                    <span className="picker-label">{o.label}</span>
                    {o.hint && <span className="menu-hint">{o.hint}</span>}
                    {o.value === value && <Check className="menu-check" size={16} aria-hidden />}
                  </button>
                </Fragment>
              ))}
              {actions.length > 0 && <hr />}
              {actions.map((a, j) => {
                const i = options.length + j;
                const ActionIcon = a.icon;
                return (
                  <button
                    key={a.id}
                    type="button"
                    ref={(el) => {
                      rows.current[i] = el;
                    }}
                    role="option"
                    aria-selected={false}
                    disabled={a.disabled}
                    tabIndex={active === i ? 0 : -1}
                    className="menu-item picker-action"
                    data-testid={a.testId}
                    {...getItemProps({ onClick: () => pick(() => onAction?.(a.id)) })}
                  >
                    {ActionIcon && <ActionIcon className="picker-action-icon" size={16} aria-hidden />}
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

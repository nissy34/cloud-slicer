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
import { Swatch } from './Swatch';

/** A choice in the list; the current one is bold with a ✓. Choices with the same `group`
 * sit together under its name (keep them in order); `hint` sits at the row's end. */
export type PickerOption = {
  value: string;
  label: string;
  /** What the button shows when this is picked, if shorter than the label (a narrow picker). */
  short?: string;
  /** A filament's colour, drawn as the app's one swatch (components/Swatch.tsx)… */
  swatch?: string;
  /** …with this number inside it (the filament's number). */
  swatchNumber?: string;
  /** No filament loaded there: the swatch is striped. */
  swatchEmpty?: boolean;
  group?: string;
  hint?: ReactNode;
  /** Small grey words right after the label, on the button too (an engine's version). */
  note?: string;
  /** A small boxed tag on the button, in place of the swatch, saying where the choice came from
   * (the printer's tool head "T3", like desktop's badge on a filament picked from the AMS). */
  tag?: string;
  disabled?: boolean;
  /** Why it can't be picked, in the row's tooltip. */
  title?: string;
};
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
  /** The current choice is wrong (a red box, like a field's). */
  invalid?: boolean;
  /** Each time the list opens (to fetch choices that come late, like the printer's filaments). */
  onOpen?(): void;
};

/**
 * The app's picker (docs/architecture/design-system.md): a button showing the current
 * choice, opening a list drawn in the theme, never the browser's own list, so a line and
 * actions can sit under the choices. Floating UI places it, keeps it on screen, and gives
 * arrow keys, Escape and closing on a tap outside.
 */
export function Picker({ label, value, options, onChange, actions = [], onAction, className, testId, disabled, field, title, placeholder, invalid, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const rows = useRef<(HTMLElement | null)[]>([]);
  const current = options.find((o) => o.value === value);
  const selectedIndex = current ? options.indexOf(current) : null;

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => {
      setOpen(next);
      if (next) onOpen?.();
    },
    placement: 'bottom-start',
    // Fixed, so a window's scrolling body doesn't clip the list.
    strategy: 'fixed',
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

  // Inside a window (a modal <dialog>) the list must hang off the window: the
  // browser draws an open window above the page and makes the rest unclickable.
  const host = open ? ((refs.domReference.current as HTMLElement | null)?.closest('dialog') ?? undefined) : undefined;

  // Escape closes only the list, not the window it sits in (the browser would cancel the <dialog>).
  const keepWindow = (e: React.KeyboardEvent) => {
    if (open && e.key === 'Escape') e.preventDefault();
  };

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
        aria-invalid={invalid || undefined}
        {...getReferenceProps({ onKeyDown: keepWindow })}
      >
        {current?.swatch && !current.tag && <Swatch colour={current.swatch} number={current.swatchNumber} empty={current.swatchEmpty} />}
        <span className="picker-value">
          {current?.short ?? current?.label ?? placeholder ?? ''}
          {current?.note && <span className="picker-note">{current.note}</span>}
          {current?.tag && <span className="picker-tag">{current.tag}</span>}
        </span>
        <ChevronDown className="picker-arrow" size={16} aria-hidden />
      </button>
      {open && (
        <FloatingPortal root={host}>
          <FloatingFocusManager context={context} modal={false}>
            <div ref={refs.setFloating} className="menu picker-list" style={floatingStyles} aria-label={label} {...getFloatingProps({ onKeyDown: keepWindow })}>
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
                    title={o.title}
                    tabIndex={active === i ? 0 : -1}
                    className="menu-item"
                    data-value={o.value}
                    {...getItemProps({ onClick: () => pick(() => onChange(o.value)) })}
                  >
                    {o.swatch && <Swatch colour={o.swatch} number={o.swatchNumber} empty={o.swatchEmpty} />}
                    <span className="picker-label">
                      {o.label}
                      {o.note && <span className="picker-note">{o.note}</span>}
                    </span>
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

import { useRef, useState, type ReactNode } from 'react';
import { HexColorPicker } from 'react-colorful';
import { Check, ChevronDown } from 'lucide-react';
import { Menu } from './Menu';
import { textOn } from '../lib/mixing';
import { BUILT_IN_COLOURS, parseHex, recentColours, rememberColour, toHex6 } from '../lib/colours';

type Props = {
  /** The colour now ("#RRGGBB", "#RRGGBBAA" and "#RGB" are read too). */
  value: string | undefined;
  /** Called with "#RRGGBB" in capitals, once per pick. */
  onChange(hex: string): void;
  /** What it colours ("Filament 1 colour"): the swatch's and the popup's name. */
  label: string;
  /** Drawn inside the swatch, like the filament list's numbers. */
  number?: ReactNode;
  size?: 'md' | 'lg';
  disabled?: boolean;
  title?: string;
};

/**
 * The app's one colour picker (docs/architecture/design-system.md): a swatch that opens a
 * small popup with desktop Orca's built-in filament colours, your recent own colours, and
 * Custom (a colour square and hue bar, plus a hex code field) for any other colour.
 * Never the browser's own colour box.
 */
export function ColourPicker({ value, onChange, label, number, size = 'lg', disabled, title }: Props) {
  const current = toHex6(value);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current);
  const [text, setText] = useState(current);
  const [custom, setCustom] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  // A custom colour not yet given to onChange: it is when the popup closes.
  const dirty = useRef(false);

  const commit = (hex: string) => {
    dirty.current = false;
    rememberColour(hex);
    if (hex !== current) onChange(hex);
  };
  const openChange = (next: boolean) => {
    if (next) {
      setDraft(current);
      setText(current);
      setCustom(false);
      setRecent(recentColours());
    } else if (dirty.current) commit(draft);
    setOpen(next);
  };
  const pick = (hex: string) => {
    commit(hex);
    setOpen(false);
  };
  const edit = (hex: string) => {
    dirty.current = true;
    setDraft(hex);
  };
  const row = (colours: { hex: string; name: string }[], name: string) => (
    <div className="colour-grid" role="group" aria-label={name}>
      {colours.map((c) => {
        const on = c.hex === draft;
        return (
          <button key={c.hex} type="button" className="swatch md" style={{ background: c.hex, color: textOn(c.hex) }} aria-label={c.name} aria-pressed={on} title={c.name} onClick={() => pick(c.hex)}>
            {on && <Check size={14} aria-hidden />}
          </button>
        );
      })}
    </div>
  );

  return (
    <Menu
      label={label}
      role="dialog"
      portal
      className="colour-pop"
      open={open}
      onOpenChange={openChange}
      button={(props) => (
        <button
          {...props}
          type="button"
          className={`swatch ${size}`}
          style={{ background: current, color: textOn(current) }}
          aria-label={label}
          title={title}
          data-colour={current}
          disabled={disabled}
        >
          {number}
        </button>
      )}
    >
      {row(BUILT_IN_COLOURS, 'Colours')}
      {recent.length > 0 && (
        <>
          <span className="colour-label">Recent</span>
          {row(
            recent.map((hex) => ({ hex, name: hex })),
            'Recent colours',
          )}
        </>
      )}
      <div className="colour-custom">
        <span className="swatch lg" style={{ background: draft }} aria-hidden />
        <input
          aria-label="Hex code"
          className="colour-hex"
          value={text}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value);
            const hex = parseHex(e.target.value);
            if (hex) edit(hex);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const hex = parseHex(text);
            if (hex) pick(hex);
          }}
          onBlur={() => setText(draft)}
        />
        <button type="button" className="quiet" aria-expanded={custom} onClick={() => setCustom(!custom)}>
          Custom <ChevronDown size={14} aria-hidden className={custom ? 'flip' : undefined} />
        </button>
      </div>
      {custom && (
        <>
          <HexColorPicker
            className="colour-square"
            color={draft}
            onChange={(hex) => {
              const h = hex.toUpperCase();
              edit(h);
              setText(h);
            }}
          />
          <button type="button" className="primary" onClick={() => pick(draft)}>
            Done
          </button>
        </>
      )}
    </Menu>
  );
}

// The design page (#design): every token and every shared part, light and dark
// side by side. Not linked from the app; it is where a design-system change is
// checked and screenshotted (docs/architecture/design-system.md). Parts join it as they are built.
import { useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { Notice } from './Notice';
import { ArrowDownToLine, Boxes, FileCode, Printer, ChevronDown, ChevronRight, CircleCheck, Ellipsis, Info, Moon, Pencil, RotateCcw, Sun, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { IconButton } from './IconButton';
import { Slider } from './Slider';
import { Swatch } from './Swatch';
import { Card } from './Card';
import { Note } from './Note';
import { Empty } from './Empty';

const COLOURS = [
  ['bg', 'page'],
  ['surface', 'cards, bars'],
  ['surface-2', 'fields, hover'],
  ['border', 'lines'],
  ['text', 'text'],
  ['muted', 'second text'],
  ['accent', 'main action, on'],
  ['accent-soft', 'chip on, hover'],
  ['ok', 'done, connected'],
  ['ok-soft', 'ok tint'],
  ['warn', 'paused, attention'],
  ['warn-soft', 'warning tint'],
  ['danger', 'delete, error'],
  ['danger-soft', 'error tint'],
  ['ok-solid', 'filled badge'],
  ['warn-solid', 'filled badge'],
  ['danger-solid', 'filled badge, stop'],
  ['scene-bg', '3D view'],
] as const;
const SIZES = [
  ['2xl', 'Page title', 600],
  ['xl', 'Window title', 600],
  ['lg', 'Card and section title', 600],
  ['md', 'Body text', 400],
  ['sm', 'Hints and small buttons', 400],
  ['xs', 'Small labels', 600],
] as const;
const STEPS = [1, 2, 3, 4, 5, 6, 7, 8];
const ICONS: [LucideIcon, string][] = [
  [X, 'close, remove'],
  [Ellipsis, 'more'],
  [Pencil, 'edit'],
  [RotateCcw, 'reset'],
  [ChevronDown, 'open'],
  [ChevronRight, 'submenu'],
  [TriangleAlert, 'warning'],
  [Info, 'info'],
  [CircleCheck, 'done'],
  [Sun, 'light'],
  [Moon, 'dark'],
];
const CORNERS = ['sm', 'md', 'lg', 'xl', 'full'];
const SHADOWS = [
  [1, 'lifted'],
  [2, 'menu'],
  [3, 'window'],
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ds-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Chips, tags, the switch, the chooser and line tabs, live so they can be tried. */
function Choices() {
  const [filters, setFilters] = useState(['Errors']);
  const [advanced, setAdvanced] = useState(true);
  const [light, setLight] = useState(false);
  const [side, setSide] = useState('Top');
  const [tab, setTab] = useState('Quality');
  return (
    <>
      <div className="chips">
        {['Errors', 'Temperatures', 'Moves'].map((f) => (
          <button key={f} className="chip" aria-pressed={filters.includes(f)} onClick={() => setFilters(filters.includes(f) ? filters.filter((x) => x !== f) : [...filters, f])}>
            {f}
          </button>
        ))}
        <label className="chip">
          <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
          Advanced
        </label>
      </div>
      <div className="ds-row">
        <span className="tag">Snapmaker Orca 2.4.0</span>
        <span className="tag ok">Printed</span>
        <span className="tag warn">Test</span>
        <span className="tag danger">Blocked</span>
        <span className="tag accent">New</span>
      </div>
      <label className="switch-row">
        <input className="switch" type="checkbox" role="switch" checked={light} onChange={(e) => setLight(e.target.checked)} />
        Chamber light
      </label>
      <div className="chooser" role="group" aria-label="Side">
        {['Top', 'Bottom', 'Both'].map((v) => (
          <button key={v} aria-pressed={side === v} onClick={() => setSide(v)}>
            {v}
          </button>
        ))}
      </div>
      <div className="line-tabs" role="tablist" aria-label="Pages">
        {['Quality', 'Strength', 'Speed', 'Support'].map((v) => (
          <button key={v} role="tab" aria-selected={tab === v} className={tab === v ? 'active' : undefined} onClick={() => setTab(v)}>
            {v}
          </button>
        ))}
      </div>
    </>
  );
}

/** Fields, a slider and filament swatches. */
function Fields() {
  const [speed, setSpeed] = useState(60);
  return (
    <>
      <div className="ds-row">
        <input aria-label="Name" defaultValue="Benchy two colours" />
        <select aria-label="Plate type" defaultValue="Textured PEI Plate">
          <option>Textured PEI Plate</option>
          <option>Smooth PEI Plate</option>
        </select>
        <span className="input-unit ds-unit">
          <input aria-label="Layer height" defaultValue="0.2" />
          <span className="unit">mm</span>
        </span>
      </div>
      <div className="ds-field-wrong">
        <span className="input-unit ds-unit">
          <input aria-label="Wall loops" defaultValue="abc" aria-invalid />
          <span className="unit">loops</span>
        </span>
        <p className="option-note">“abc” is not a number. Kept 2.</p>
      </div>
      <label className="ds-row">
        <span>Speed</span>
        <Slider aria-label="Speed" min={0} max={100} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        <span className="unit">{speed}%</span>
      </label>
      <div className="ds-row">
        {['#1E9E8F', '#FFEE00', '#FFFFFF', '#1E3A8A', '#D7263D'].map((c, i) => (
          <Swatch key={c} colour={c} number={i + 1} />
        ))}
        <Swatch colour="#FFEE00" number={2} size="lg" />
        <Swatch colour="#D7263D" size="sm" />
        <Swatch empty />
      </div>
    </>
  );
}

/** A card, a sidebar section title, the three notes and an empty place. */
function Containers() {
  return (
    <>
      <div className="ds-cards">
        <Card title="Print" actions={<button className="quiet">Choose</button>}>
          <Note tone="warn">The printer firmware has stopped.</Note>
        </Card>
        <Card title="Files" actions={<IconButton icon={Ellipsis} label="More" />}>
          <Empty icon={FileCode} text="No G-code files yet." />
        </Card>
      </div>
      <div className="group ds-group">
        <h2>
          <Printer aria-hidden />
          Printer
        </h2>
        <h2>
          <Boxes aria-hidden />
          Objects
        </h2>
      </div>
      <div className="ds-notes">
        <Note>Accounts aren't set up on this site yet. Save still downloads the 3MF.</Note>
        <Note tone="warn">This object's painting will be removed, as on desktop.</Note>
        <Note tone="error">Couldn't save: the network is down.</Note>
      </div>
    </>
  );
}

function Sheet({ theme, onWindow }: { theme: 'light' | 'dark'; onWindow(): void }) {
  return (
    <div className="ds-sheet" data-theme={theme}>
      <h1>{theme === 'light' ? 'Light' : 'Dark'}</h1>
      <Section title="Colours">
        <ul className="ds-colours">
          {COLOURS.map(([name, use]) => (
            <li key={name}>
              <span className="ds-swatch" style={{ background: `var(--${name})` }} />
              <code>--{name}</code>
              <span className="ds-muted">{use}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Text">
        {SIZES.map(([t, label, w]) => (
          <p key={t} className="ds-type" style={{ fontSize: `var(--t-${t})`, fontWeight: w }}>
            <code>--t-{t}</code> {label}
          </p>
        ))}
      </Section>
      <Section title="Spacing, corners, shadows">
        <div className="ds-row">
          {STEPS.map((n) => (
            <span key={n} className="ds-step" style={{ width: `var(--s-${n})` }} title={`--s-${n}`} />
          ))}
        </div>
        <div className="ds-row">
          {CORNERS.map((r) => (
            <span key={r} className="ds-box" style={{ borderRadius: `var(--r-${r})` }}>
              {r}
            </span>
          ))}
        </div>
        <div className="ds-row">
          {SHADOWS.map(([n, label]) => (
            <span key={n} className="ds-box ds-lifted" style={{ boxShadow: `var(--shadow-${n})` }}>
              {label}
            </span>
          ))}
        </div>
      </Section>
      <Section title="Buttons">
        <div className="ds-row">
          <button className="primary">Slice plate</button>
          <button className="secondary">Send to printer</button>
          <button className="ghost">Cancel</button>
          <button className="quiet">Arrange</button>
          <button className="secondary" disabled>
            Off
          </button>
        </div>
        <div className="ds-row">
          <button className="primary danger">Remove printer</button>
          <button className="secondary danger">Emergency stop</button>
          <button className="quiet danger">Delete</button>
          <button className="secondary">
            <ArrowDownToLine size={16} aria-hidden /> Load
          </button>
        </div>
        <div className="ds-row">
          <IconButton icon={Pencil} label="Edit printer settings" />
          <IconButton icon={Ellipsis} label="More" />
          <IconButton icon={RotateCcw} label="Back to the preset's value" className="reset" />
          <IconButton icon={X} label="Remove" danger />
        </div>
      </Section>
      <Section title="Icons (Lucide)">
        <div className="ds-row ds-icons">
          {ICONS.map(([Shape, name]) => (
            <span key={name} title={name}>
              <Shape size={20} aria-hidden />
              <small>{name}</small>
            </span>
          ))}
        </div>
      </Section>
      <Section title="Chips, tags, switch, chooser, tabs">
        <Choices />
      </Section>
      <Section title="Fields, slider, swatches">
        <Fields />
      </Section>
      <Section title="Cards, titles, notes, empty places">
        <Containers />
      </Section>
      <Section title="Window and messages">
        <div className="ds-row">
          <button className="secondary" onClick={onWindow}>
            Open a window
          </button>
        </div>
        <div className="ds-notices">
          <Notice tone="ok" title="Saved to your online projects" onClose={() => {}} />
          <Notice tone="warn" title="Being edited on your other computer" text="This tab is view only." actions={<button className="primary">Edit here instead</button>} />
          <Notice tone="error" title="The printer stopped" text="Heater error on T2." onClose={() => {}} />
        </div>
      </Section>
    </div>
  );
}

export function DesignPage() {
  const [open, setOpen] = useState(false);
  return (
    <div className="ds-page" data-testid="design-page">
      <Sheet theme="light" onWindow={() => setOpen(true)} />
      <Sheet theme="dark" onWindow={() => setOpen(true)} />
      {open && (
        <Dialog
          title="Clear the plate?"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="secondary" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="primary" onClick={() => setOpen(false)}>
                Clear all
              </button>
            </>
          }
        >
          <p>“Benchy two colours” has changes that aren't saved yet.</p>
        </Dialog>
      )}
    </div>
  );
}

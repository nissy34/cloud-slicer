// The design page (#design): every token and every shared part, light and dark
// side by side. Not linked from the app; it is where a design-system change is
// checked and screenshotted (docs/architecture/design-system.md). Parts join it as they are built.
import { useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { Notice } from './Notice';

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
          <button className="secondary" disabled>
            Off
          </button>
        </div>
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

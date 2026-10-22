import { createContext, useContext, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';

/** Set by the Device tab's layout around each card: folding a card leaves only its title. */
export const SlotContext = createContext<{ folded: boolean; toggleFold(): void } | null>(null);

/** True while this card is folded; a folded card's own streams and polling stop. */
export const useFolded = () => useContext(SlotContext)?.folded ?? false;

export function Card({ title, actions, className, children, testId }: { title: string; actions?: ReactNode; className?: string; children: ReactNode; testId?: string }) {
  const slot = useContext(SlotContext);
  const folded = slot?.folded ?? false;
  return (
    <section className={`dv-card ${className ?? ''}${folded ? ' dv-folded' : ''}`} aria-label={title} data-testid={testId}>
      <header className="dv-card-head">
        <h2>
          {slot ? (
            <button className="dv-fold" aria-expanded={!folded} onClick={slot.toggleFold} title={folded ? 'Unfold this card' : 'Fold this card'}>
              <span className="dv-fold-icon" aria-hidden="true" />
              {title}
            </button>
          ) : (
            title
          )}
        </h2>
        {actions && !folded && <div className="dv-card-actions">{actions}</div>}
      </header>
      {!folded && children}
    </section>
  );
}

export function Swatch({ colour, empty, title }: { colour: string; empty?: boolean; title?: string }) {
  return <span className={`dv-swatch${empty ? ' empty' : ''}`} style={empty ? undefined : { background: colour }} title={title} aria-hidden />;
}

/** "215 / 220 °C" with the target editable in place. */
export function Temperature({ temp, target, max, onSet, disabled, label }: { temp: number; target: number; max: number; onSet(t: number): void; disabled?: boolean; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v) && v !== target) onSet(Math.min(max, Math.max(0, v)));
  };
  return (
    <span className="dv-temp">
      <b className={target > 0 ? 'heating' : ''}>{temp.toFixed(0)}°</b>
      <span className="muted">/</span>
      {disabled ? (
        // Set on the printer itself: the target as plain text.
        <span className="dv-temp-target" data-testid="temp-target">
          {Math.round(target)}
        </span>
      ) : (
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          aria-label={`${label} target`}
          value={draft ?? String(Math.round(target))}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setDraft(null);
          }}
        />
      )}
      <span className="muted">°C</span>
      {target > 0 && !disabled && (
        <button className="dv-link" onClick={() => onSet(0)} aria-label={`Turn ${label} off`}>
          Off
        </button>
      )}
    </span>
  );
}

/** A 0..100 % slider that only sends when released. */
export function PercentSlider({ value, onCommit, label, disabled }: { value: number; onCommit(v: number): void; label: string; disabled?: boolean }) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? Math.round(value * 100);
  const commit = () => {
    if (draft != null) onCommit(draft / 100);
    setDraft(null);
  };
  return (
    <span className="dv-slider">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={shown}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="dv-slider-value">{shown}%</span>
    </span>
  );
}

export function useConfirm() {
  const [pending, setPending] = useState<{ text: string; action: string; title?: string; keep?: string; danger?: boolean; run(): void } | null>(null);
  const dialog = pending && (
    <Dialog
      title={pending.title ?? pending.action}
      onClose={() => setPending(null)}
      footer={
        <>
          <button className="secondary" onClick={() => setPending(null)}>
            {pending.keep ?? 'Keep going'}
          </button>
          <button
            className={pending.danger ? 'primary dv-danger' : 'primary'}
            onClick={() => {
              pending.run();
              setPending(null);
            }}
          >
            {pending.action}
          </button>
        </>
      }
    >
      <p>{pending.text}</p>
    </Dialog>
  );
  return { confirm: setPending, dialog };
}

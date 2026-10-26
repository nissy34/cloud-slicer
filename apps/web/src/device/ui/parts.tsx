import { createContext, useContext, useState, type ReactNode } from 'react';
import { Card as BaseCard } from '../../components/Card';
import { Dialog } from '../../components/Dialog';
import { Slider } from '../../components/Slider';

/** Set by the Device tab's layout around each card: folding a card leaves only its title. */
export const SlotContext = createContext<{ folded: boolean; toggleFold(): void } | null>(null);

/** True while this card is folded; a folded card's own streams and polling stop. */
export const useFolded = () => useContext(SlotContext)?.folded ?? false;

export function Card({ title, actions, className, children, testId }: { title: string; actions?: ReactNode; className?: string; children: ReactNode; testId?: string }) {
  const slot = useContext(SlotContext);
  const folded = slot?.folded ?? false;
  return (
    <BaseCard
      label={title}
      className={[className, folded && 'dv-folded'].filter(Boolean).join(' ')}
      testId={testId}
      actions={folded ? undefined : actions}
      title={
        slot ? (
          <button className="dv-fold" aria-expanded={!folded} onClick={slot.toggleFold} title={folded ? 'Unfold this card' : 'Fold this card'}>
            <span className="dv-fold-icon" aria-hidden="true" />
            {title}
          </button>
        ) : (
          title
        )
      }
    >
      {!folded && children}
    </BaseCard>
  );
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
        <button className="quiet" onClick={() => onSet(0)} aria-label={`Turn ${label} off`}>
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
      <Slider
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
            className={pending.danger ? 'primary danger' : 'primary'}
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

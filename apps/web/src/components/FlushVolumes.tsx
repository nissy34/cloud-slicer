// Desktop Orca's "Flushing volumes" window, for printers with one nozzle and
// several filaments (AMS, MMU, CFS...): how much each filament change purges,
// per pair of filaments, worked out from their colours (lib/flush). Printers
// with a head per filament (the U1) never purge, so it isn't offered there.
import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import {
  flushNote,
  flushShown,
  MATRIX,
  MULTIPLIER,
  MULTIPLIER_RANGE,
  outOfRange,
  parseMatrix,
  parseMultipliers,
  serializeMatrix,
  serializeMultipliers,
  shown,
  stored,
} from '../lib/flush';
import { useOption, useSlicer } from '../state/store';
import { Swatch } from './Swatch';

export function FlushVolumesButton() {
  const [open, setOpen] = useState(false);
  const info = useSlicer((s) => s.flush);
  const filaments = useSlicer((s) => s.selection?.filaments.length ?? 0);
  const changed = useSlicer((s) => MATRIX in s.overrides || MULTIPLIER in s.overrides);
  if (!flushShown(info, filaments)) return null;
  return (
    <div className="flush-link">
      <button className="quiet" onClick={() => setOpen(true)} data-testid="flush-volumes">
        Flushing volumes
      </button>
      <span className="muted small">{changed ? 'your own amounts' : 'from the colours'}</span>
      {open && <FlushVolumesDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

const NOZZLE_NAMES = ['Left nozzle', 'Right nozzle'];

function FlushVolumesDialog({ onClose }: { onClose(): void }) {
  const info = useSlicer((s) => s.flush);
  const selection = useSlicer((s) => s.selection);
  const purgeInTower = useOption('purge_in_prime_tower');
  const primeVolume = useOption('prime_volume');
  const base = useSlicer((s) => s.baseConfig[MATRIX]);
  const value = useOption(MATRIX);
  const multiplierValue = useOption(MULTIPLIER);
  const setOverride = useSlicer((s) => s.setOverride);
  const [nozzle, setNozzle] = useState(0);
  const n = selection?.filaments.length ?? 0;
  // The window closes by itself when the printer stops being one that flushes.
  const applies = flushShown(info, n);
  useEffect(() => {
    if (!applies) onClose();
  }, [applies, onClose]);
  if (!info || !selection || !applies) return null;
  const nozzles = Math.max(1, info.nozzles);
  const perNozzle = (multiplierValue ?? '').split(',').length > 1 || nozzles > 1;
  const blocks = parseMatrix(value, n, nozzles);
  const multipliers = parseMultipliers(multiplierValue, nozzles);
  const b = Math.min(nozzle, nozzles - 1);
  const multiplier = multipliers[b];
  const min = info.min[b] ?? 0;
  const note = flushNote({ purge_in_prime_tower: purgeInTower, prime_volume: primeVolume }, info);
  const label = (i: number) => `Filament ${i + 1}`;

  const setCell = (from: number, to: number, purge: number) => {
    const next = blocks.map((block) => block.map((row) => [...row]));
    next[b][from][to] = stored(Math.max(0, Math.min(info.max, purge)), multiplier);
    setOverride(MATRIX, serializeMatrix(next));
  };
  const setMultiplier = (m: number) => {
    const next = [...multipliers];
    next[b] = Math.max(MULTIPLIER_RANGE[0], Math.min(MULTIPLIER_RANGE[1], m));
    setOverride(MULTIPLIER, serializeMultipliers(next, perNozzle));
  };
  // Desktop's Re-calculate: the amounts worked out from the colours again (this nozzle's).
  const recalculate = () => {
    const auto = parseMatrix(base, n, nozzles);
    const next = blocks.map((block, i) => (i === b ? auto[i] : block));
    setOverride(MATRIX, serializeMatrix(next) === serializeMatrix(auto) ? null : serializeMatrix(next));
  };

  return (
    <Dialog
      title="Flushing volumes"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="secondary dv-left" onClick={recalculate} data-testid="flush-recalculate">
            Re-calculate
          </button>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="flush-volumes">
        <p className="muted small">
          How much the printer pushes out, in mm³, when it changes from the filament on the left to the one at the top. Worked out from the colours: dark to light
          needs more.
        </p>
        {nozzles > 1 && (
          <div className="chooser" role="radiogroup" aria-label="Nozzle">
            {Array.from({ length: nozzles }, (_, i) => (
              <button key={i} role="radio" aria-checked={i === b} className={i === b ? 'on' : ''} onClick={() => setNozzle(i)}>
                {NOZZLE_NAMES[i] ?? `Nozzle ${i + 1}`}
              </button>
            ))}
          </div>
        )}
        <div className="flush-grid" style={{ gridTemplateColumns: `auto repeat(${n}, minmax(0, 1fr))` }} role="table" aria-label="Flushing volumes in mm³">
          <span className="flush-corner" role="columnheader">
            <span>from</span>
            <span>to</span>
          </span>
          {selection.colours.map((c, j) => (
            <span key={j} className="flush-head" role="columnheader" aria-label={`To ${label(j)}`}>
              <Swatch colour={c} number={j + 1} />
            </span>
          ))}
          {selection.colours.map((c, i) => (
            <FlushRow key={i}>
              <span className="flush-head" role="rowheader" aria-label={`From ${label(i)}`}>
                <Swatch colour={c} number={i + 1} />
              </span>
              {selection.colours.map((_, j) =>
                i === j ? (
                  <span key={j} className="flush-self" aria-hidden>
                    –
                  </span>
                ) : (
                  <PurgeBox
                    key={`${b}:${i}:${j}:${n}`}
                    value={shown(blocks[b][i][j], multiplier)}
                    warn={outOfRange(shown(blocks[b][i][j], multiplier), min, info.max)}
                    label={`Purge from ${label(i)} to ${label(j)}, mm³`}
                    testId={`flush-${i}-${j}`}
                    onCommit={(v) => setCell(i, j, v)}
                  />
                ),
              )}
            </FlushRow>
          ))}
        </div>
        <p className="small muted">
          Suggested: {min} to {info.max} mm³ (outside it shows red).
        </p>
        <label className="flush-multiplier">
          <span>Multiplier</span>
          <PurgeBox
            key={`m${b}:${multiplier}`}
            value={multiplier}
            step={0.05}
            label="Multiplier"
            testId="flush-multiplier"
            onCommit={setMultiplier}
          />
          <span className="small muted">
            Scales every amount ({MULTIPLIER_RANGE[0]} to {MULTIPLIER_RANGE[1]}).
          </span>
        </label>
        {note && <p className="hint warn">{note}</p>}
      </div>
    </Dialog>
  );
}

const FlushRow = ({ children }: { children: React.ReactNode }) => (
  <div className="flush-row" role="row">
    {children}
  </div>
);

/** A number box that applies its value when you leave it or press Enter. */
function PurgeBox({
  value,
  onCommit,
  label,
  testId,
  warn = false,
  step = 1,
}: {
  value: number;
  onCommit(v: number): void;
  label: string;
  testId: string;
  warn?: boolean;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const v = parseFloat(draft.replace(',', '.'));
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setDraft(String(value));
  };
  return (
    <input
      className={warn ? 'flush-box warn' : 'flush-box'}
      type="number"
      inputMode="decimal"
      min={0}
      step={step}
      aria-label={label}
      data-testid={testId}
      data-value={value}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

import { useMemo, useState } from 'react';
import { useDevice } from '../../state/device';
import { dialect } from '../addons';
import { extrudeGcode, flowFactorGcode, homeGcode, jogGcode, motorsOffGcode, speedFactorGcode } from '../commands';
import { heaters, job, motion } from '../status';
import { Card } from './parts';

const STEPS = [0.1, 1, 10, 50];

export function MotionCard() {
  const objects = useDevice((s) => s.objects);
  const run = useDevice((s) => s.run);
  const bedZ = useDevice((s) => s.addons.some((a) => a.bedMovesInZ));
  const words = dialect(useDevice((s) => s.addons));
  const m = useMemo(() => motion(objects), [objects]);
  const state = job(objects).state;
  const printing = state === 'printing';
  const busy = printing || state === 'paused';
  const [step, setStep] = useState(10);
  const homed = (axis: string) => m.homed.includes(axis);
  const jog = (axis: 'x' | 'y' | 'z', dir: 1 | -1) => void run(jogGcode(axis, dir * step, axis === 'z' ? 600 : 6000, words));
  const nozzle = heaters(objects).find((h) => h.name === m.activeExtruder);
  const hot = (nozzle?.temp ?? 0) >= 170;
  // Greyed-out controls say why on hover; the containers carry it too, for browsers that show no tooltip on a disabled button.
  const why = busy ? `Disabled while ${printing ? 'printing' : 'paused'}` : undefined;

  return (
    <Card
      title="Move"
      testId="motion-card"
      actions={
        <span className="dv-pos" aria-label="Position">
          X {m.position[0].toFixed(1)} · Y {m.position[1].toFixed(1)} · Z {m.position[2].toFixed(2)}
        </span>
      }
    >
      {/* While a print runs the controls stay in place, greyed out, so the card keeps its shape. */}
      {busy && (
        <div className="dv-form-inline">
          <label>
            Speed
            <FactorInput value={m.speedFactor} onSet={(v) => void run(speedFactorGcode(v))} />
          </label>
          <label>
            Flow
            <FactorInput value={m.extrudeFactor} onSet={(v) => void run(flowFactorGcode(v))} />
          </label>
        </div>
      )}
      <div className="dv-jog" title={why}>
        {/* Arrows say which way something physically moves, never X/Y/Z: the head pad is seen from above, standing in front of the printer. */}
        <div className="dv-jog-group">
          <span className="dv-jog-label">Head</span>
          <div className="dv-jog-xy" role="group" aria-label="Move the head">
            <span />
            <JogButton why={why} label="Head to the back" arrow="↑" disabled={busy || !homed('y')} onClick={() => jog('y', 1)} />
            <span />
            <JogButton why={why} label="Head left" arrow="←" disabled={busy || !homed('x')} onClick={() => jog('x', -1)} />
            <button className="dv-home" onClick={() => void run(homeGcode(['x', 'y']))} disabled={busy} aria-label="Home the head" title={why ?? 'Home the head'}>
              ⌂
            </button>
            <JogButton why={why} label="Head right" arrow="→" disabled={busy || !homed('x')} onClick={() => jog('x', 1)} />
            <span />
            <JogButton why={why} label="Head toward you" arrow="↓" disabled={busy || !homed('y')} onClick={() => jog('y', -1)} />
            <span />
          </div>
        </div>
        <div className="dv-jog-group">
          <span className="dv-jog-label">{bedZ ? 'Bed' : 'Head height'}</span>
          <div className="dv-jog-z" role="group" aria-label={bedZ ? 'Move the bed' : 'Move the head up and down'}>
            {/* Z+ always means more room between nozzle and bed: the head goes up, or the bed goes down. */}
            <JogButton why={why} label={bedZ ? 'Bed up' : 'Head up'} arrow="↑" disabled={busy || !homed('z')} onClick={() => jog('z', bedZ ? -1 : 1)} />
            <button
              className="dv-home"
              onClick={() => void run(homeGcode(['z']))}
              disabled={busy}
              aria-label={bedZ ? 'Home the bed' : 'Home the height'}
              title={why ?? (bedZ ? 'Home the bed' : 'Home the height')}
            >
              ⌂
            </button>
            <JogButton why={why} label={bedZ ? 'Bed down' : 'Head down'} arrow="↓" disabled={busy || !homed('z')} onClick={() => jog('z', bedZ ? 1 : -1)} />
          </div>
        </div>
      </div>
      <div className="dv-steps" role="radiogroup" aria-label="Step" title={why}>
        {STEPS.map((s) => (
          <button key={s} role="radio" aria-checked={step === s} className={step === s ? 'on' : ''} disabled={busy} title={why} onClick={() => setStep(s)}>
            {s} mm
          </button>
        ))}
      </div>
      <div className="dv-row" title={why}>
        <button className="secondary" disabled={busy} title={why} onClick={() => void run(homeGcode())}>
          Home all
        </button>
        <button className="secondary" disabled={busy} title={why} onClick={() => void run(motorsOffGcode())}>
          Motors off
        </button>
        <button className="secondary" disabled={busy || !hot} title={why ?? (hot ? undefined : 'Heat the nozzle first')} onClick={() => void run(extrudeGcode(10, undefined, words))}>
          Extrude 10 mm
        </button>
        <button className="secondary" disabled={busy || !hot} title={why ?? (hot ? undefined : 'Heat the nozzle first')} onClick={() => void run(extrudeGcode(-10, undefined, words))}>
          Retract
        </button>
      </div>
      {!busy && !m.homed && <p className="muted">Home the printer before moving it.</p>}
    </Card>
  );
}

function JogButton({ label, arrow, disabled, why, onClick }: { label: string; arrow: string; disabled: boolean; why?: string; onClick(): void }) {
  return (
    <button className="dv-arrow" onClick={onClick} disabled={disabled} aria-label={label} title={why ?? label}>
      {arrow}
    </button>
  );
}

function FactorInput({ value, onSet }: { value: number; onSet(pct: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="dv-temp">
      <input
        type="number"
        value={draft ?? String(Math.round(value * 100))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft != null && Number.isFinite(Number(draft))) onSet(Number(draft));
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="muted">%</span>
    </span>
  );
}

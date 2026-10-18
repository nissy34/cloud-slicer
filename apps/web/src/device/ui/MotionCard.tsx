import { useMemo, useState } from 'react';
import { useDevice } from '../../state/device';
import { extrudeGcode, flowFactorGcode, homeGcode, jogGcode, motorsOffGcode, speedFactorGcode } from '../commands';
import { heaters, job, motion } from '../status';
import { Card } from './parts';

const STEPS = [0.1, 1, 10, 50];

export function MotionCard() {
  const objects = useDevice((s) => s.objects);
  const run = useDevice((s) => s.run);
  const m = useMemo(() => motion(objects), [objects]);
  const state = job(objects).state;
  const printing = state === 'printing';
  const busy = printing || state === 'paused';
  const [step, setStep] = useState(10);
  const homed = (axis: string) => m.homed.includes(axis);
  const jog = (axis: 'x' | 'y' | 'z', dir: 1 | -1) => void run(jogGcode(axis, dir * step, axis === 'z' ? 600 : 6000));
  const nozzle = heaters(objects).find((h) => h.name === m.activeExtruder);
  const hot = (nozzle?.temp ?? 0) >= 170;

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
      {printing ? (
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
      ) : (
        <>
          <div className="dv-jog">
            <div className="dv-jog-xy" role="group" aria-label="Move X and Y">
              <span />
              <button onClick={() => jog('y', 1)} disabled={busy || !homed('y')} aria-label="Y plus">
                Y+
              </button>
              <span />
              <button onClick={() => jog('x', -1)} disabled={busy || !homed('x')} aria-label="X minus">
                X−
              </button>
              <button className="dv-home" onClick={() => void run(homeGcode(['x', 'y']))} disabled={busy} aria-label="Home X and Y">
                ⌂
              </button>
              <button onClick={() => jog('x', 1)} disabled={busy || !homed('x')} aria-label="X plus">
                X+
              </button>
              <span />
              <button onClick={() => jog('y', -1)} disabled={busy || !homed('y')} aria-label="Y minus">
                Y−
              </button>
              <span />
            </div>
            <div className="dv-jog-z" role="group" aria-label="Move Z">
              <button onClick={() => jog('z', 1)} disabled={busy || !homed('z')} aria-label="Z plus">
                Z+
              </button>
              <button className="dv-home" onClick={() => void run(homeGcode(['z']))} disabled={busy} aria-label="Home Z">
                ⌂
              </button>
              <button onClick={() => jog('z', -1)} disabled={busy || !homed('z')} aria-label="Z minus">
                Z−
              </button>
            </div>
          </div>
          <div className="dv-steps" role="radiogroup" aria-label="Step">
            {STEPS.map((s) => (
              <button key={s} role="radio" aria-checked={step === s} className={step === s ? 'on' : ''} onClick={() => setStep(s)}>
                {s} mm
              </button>
            ))}
          </div>
          <div className="dv-row">
            <button className="secondary" disabled={busy} onClick={() => void run(homeGcode())}>
              Home all
            </button>
            <button className="secondary" disabled={busy} onClick={() => void run(motorsOffGcode())}>
              Motors off
            </button>
            <button className="secondary" disabled={busy || !hot} title={hot ? undefined : 'Heat the nozzle first'} onClick={() => void run(extrudeGcode(10))}>
              Extrude 10 mm
            </button>
            <button className="secondary" disabled={busy || !hot} title={hot ? undefined : 'Heat the nozzle first'} onClick={() => void run(extrudeGcode(-10))}>
              Retract
            </button>
          </div>
          {!m.homed && <p className="muted">Home the printer before moving it.</p>}
        </>
      )}
    </Card>
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

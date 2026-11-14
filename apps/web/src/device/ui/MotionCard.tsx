import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDevice } from '../../state/device';
import { dialect } from '../addons';
import { extrudeGcode, flowFactorGcode, homeGcode, jogGcode, motorsOffGcode, speedFactorGcode } from '../commands';
import { heaters, job, motion } from '../status';
import { Card } from './parts';
import { House } from 'lucide-react';

const STEPS = [0.1, 1, 10, 50];

export function MotionCard() {
  const { t } = useTranslation();
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
  const why = busy ? (printing ? t('deviceMove.disabledPrinting') : t('deviceMove.disabledPaused')) : undefined;

  return (
    <Card
      title={t('deviceCards.move')}
      testId="motion-card"
      actions={
        <span className="dv-pos" aria-label={t('deviceMove.position')}>
          X {m.position[0].toFixed(1)} · Y {m.position[1].toFixed(1)} · Z {m.position[2].toFixed(2)}
        </span>
      }
    >
      {/* While a print runs the controls stay in place, greyed out, so the card keeps its shape. */}
      {busy && (
        <div className="dv-form-inline">
          <label>
            {t('deviceMove.speed')}
            <FactorInput value={m.speedFactor} onSet={(v) => void run(speedFactorGcode(v))} />
          </label>
          <label>
            {t('deviceMove.flow')}
            <FactorInput value={m.extrudeFactor} onSet={(v) => void run(flowFactorGcode(v))} />
          </label>
        </div>
      )}
      <div className="dv-jog" title={why}>
        {/* Arrows say which way something physically moves, never X/Y/Z: the head pad is seen from above, standing in front of the printer. */}
        <div className="dv-jog-group">
          <span className="dv-jog-label">{t('deviceMove.head')}</span>
          <div className="dv-jog-xy" role="group" aria-label={t('deviceMove.moveHead')}>
            <span />
            <JogButton why={why} label={t('deviceMove.headBack')} arrow="↑" disabled={busy || !homed('y')} onClick={() => jog('y', 1)} />
            <span />
            <JogButton why={why} label={t('deviceMove.headLeft')} arrow="←" disabled={busy || !homed('x')} onClick={() => jog('x', -1)} />
            <button className="dv-home" onClick={() => void run(homeGcode(['x', 'y']))} disabled={busy} aria-label={t('deviceMove.homeHead')} title={why ?? t('deviceMove.homeHead')}>
              <House size={18} aria-hidden />
            </button>
            <JogButton why={why} label={t('deviceMove.headRight')} arrow="→" disabled={busy || !homed('x')} onClick={() => jog('x', 1)} />
            <span />
            <JogButton why={why} label={t('deviceMove.headToward')} arrow="↓" disabled={busy || !homed('y')} onClick={() => jog('y', -1)} />
            <span />
          </div>
        </div>
        <div className="dv-jog-group">
          <span className="dv-jog-label">{bedZ ? t('deviceMove.bed') : t('deviceMove.headHeight')}</span>
          <div className="dv-jog-z" role="group" aria-label={bedZ ? t('deviceMove.moveBed') : t('deviceMove.moveHeadZ')}>
            {/* Z+ always means more room between nozzle and bed: the head goes up, or the bed goes down. */}
            <JogButton why={why} label={bedZ ? t('deviceMove.bedUp') : t('deviceMove.headUp')} arrow="↑" disabled={busy || !homed('z')} onClick={() => jog('z', bedZ ? -1 : 1)} />
            <button
              className="dv-home"
              onClick={() => void run(homeGcode(['z']))}
              disabled={busy}
              aria-label={bedZ ? t('deviceMove.homeBed') : t('deviceMove.homeHeight')}
              title={why ?? (bedZ ? t('deviceMove.homeBed') : t('deviceMove.homeHeight'))}
            >
              <House size={18} aria-hidden />
            </button>
            <JogButton why={why} label={bedZ ? t('deviceMove.bedDown') : t('deviceMove.headDown')} arrow="↓" disabled={busy || !homed('z')} onClick={() => jog('z', bedZ ? 1 : -1)} />
          </div>
        </div>
      </div>
      <div className="dv-steps" role="radiogroup" aria-label={t('deviceMove.step')} title={why}>
        {STEPS.map((s) => (
          <button key={s} role="radio" aria-checked={step === s} className={step === s ? 'on' : ''} disabled={busy} title={why} onClick={() => setStep(s)}>
            {s} mm
          </button>
        ))}
      </div>
      <div className="dv-row" title={why}>
        <button className="secondary" disabled={busy} title={why} onClick={() => void run(homeGcode())}>
          {t('deviceMove.homeAll')}
        </button>
        <button className="secondary" disabled={busy} title={why} onClick={() => void run(motorsOffGcode())}>
          {t('deviceMove.motorsOff')}
        </button>
        <button className="secondary" disabled={busy || !hot} title={why ?? (hot ? undefined : t('deviceMove.heatFirst'))} onClick={() => void run(extrudeGcode(10, undefined, words))}>
          {t('deviceMove.extrude10')}
        </button>
        <button className="secondary" disabled={busy || !hot} title={why ?? (hot ? undefined : t('deviceMove.heatFirst'))} onClick={() => void run(extrudeGcode(-10, undefined, words))}>
          {t('deviceMove.retract')}
        </button>
      </div>
      {!busy && !m.homed && <p className="muted">{t('deviceMove.homeFirst')}</p>}
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

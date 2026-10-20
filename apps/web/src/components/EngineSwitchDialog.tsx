import { useMemo } from 'react';
import { engineName, type EngineFlavor } from '../lib/engines';
import type { DroppedSetting } from '../lib/engine-switch';
import { textOn } from '../lib/mixing';
import { useSlicer } from '../state/store';

const TYPE_LABEL = { printer: 'Printer', process: 'Process', filament: 'Filament' } as const;

/** "Travel speed" or "Travel speed (Cube)", once each. */
function settingList(list: DroppedSetting[]) {
  const seen = new Set<string>();
  return list
    .map((d) => (d.where ? `${d.label} (${d.where})` : d.label))
    .filter((t) => !seen.has(t) && seen.add(t));
}

/**
 * Desktop OrcaSlicer's printer-change question, for the engine: what the open
 * project would lose in engine `to`, with Switch / Cancel. Shown only when
 * something would be lost (losesNothing): it lists only what applies.
 */
export function EngineSwitchDialog({ to, onClose, onSwitch }: { to: EngineFlavor; onClose: () => void; onSwitch: () => void }) {
  const from = useSlicer((s) => s.flavor);
  const palette = useSlicer((s) => s.palette);
  const colours = useSlicer((s) => s.selection?.colours);
  const hasModel = useSlicer((s) => !!s.project?.objects.length);
  const plan = useMemo(() => useSlicer.getState().switchPlan(to), [to]);
  const target = engineName(to);
  const dropped = settingList(plan.dropped);
  const highFlow = settingList(plan.highFlowChanged);
  const swatch = (colour: string | undefined, text: string) => (
    <span className="engine-switch-swatch" style={{ background: colour ?? 'transparent', color: textOn(colour ?? '#fff') }}>
      {text}
    </span>
  );
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog engine-switch" role="dialog" aria-modal="true" aria-labelledby="engine-switch-title" data-testid="engine-switch">
        <h2 id="engine-switch-title">Switch this project to {target}?</h2>
        <div className="engine-switch-body">
          <p>
            {hasModel ? 'Your model, plates, positions, painting and settings move over, except:' : 'Your printer, presets and changed settings move over, except:'}
          </p>
          {plan.mixes.length > 0 && (
            <section>
              <h3>Colour mixes become plain filaments</h3>
              <p className="muted small">{target} has no colour mixing. What is printed with a mix prints with the filament it uses most.</p>
              <ul className="engine-switch-mixes">
                {plan.mixes.map((m) => (
                  <li key={m.id}>
                    {swatch(m.colour, String(m.id))}
                    <span className="muted small">{m.label}</span>
                    <span aria-hidden>→</span>
                    {swatch(colours?.[m.becomes - 1] ?? palette[m.becomes - 1], String(m.becomes))}
                    <span className="sr-only">becomes filament {m.becomes}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {highFlow.length > 0 && (
            <section>
              <h3>High flow values</h3>
              <p className="muted small">
                {target} has one value per setting, not one for standard and one for high flow. The standard flow values carry over; your high flow changes to{' '}
                {highFlow.join(', ')} are lost.
              </p>
            </section>
          )}
          {dropped.length > 0 && (
            <section>
              <h3>Settings {target} doesn't have</h3>
              <p className="muted small">Your changes to these are left out: {dropped.join(', ')}.</p>
            </section>
          )}
          {plan.presets.length > 0 && (
            <section>
              <h3>A different layer height</h3>
              <p className="muted small">{target} has no preset like this one, so the nearest one is used.</p>
              <ul className="engine-switch-presets">
                {plan.presets.map((m) => (
                  <li key={`${m.type}:${m.from}`}>
                    <span className="muted small">{TYPE_LABEL[m.type]}</span> {m.from} → <b>{m.to}</b>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="muted small">
            Switching back to {engineName(from)} later won't bring these back.{hasModel && ' Slice again after switching.'}
          </p>
        </div>
        <div className="dialog-actions">
          <button className="secondary" onClick={onClose} autoFocus>
            Cancel
          </button>
          <button className="primary" onClick={onSwitch}>
            Switch to {target}
          </button>
        </div>
      </div>
    </div>
  );
}

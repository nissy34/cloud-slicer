import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Cpu } from 'lucide-react';
import { losesNothing } from '../lib/engine-switch';
import { ENGINES, type EngineFlavor } from '../lib/engines';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { EngineSwitchDialog } from './EngineSwitchDialog';

/**
 * The sidebar's Slicer engine section, above the printer (the same place on
 * desktop and phone): the engine the project slices with. Picking the other
 * one moves the project over (just its presets and changed settings on an
 * empty plate), asking first when something would be lost (EngineSwitchDialog).
 */
export function EngineSection() {
  const flavor = useSlicer((s) => s.flavor);
    // Not while the engine starts, opens a file or slices.
  const busy = useSlicer((s) => s.engine !== 'ready' || s.job.kind === 'loading' || s.job.kind === 'slicing');
  const [asking, setAsking] = useState<EngineFlavor | null>(null);
  const pick = (id: EngineFlavor) => {
    if (id === flavor) return;
    // The presets and changed settings move over too, with or without a model.
    // Nothing to lose (a plain model on built-in presets): no question.
    if (losesNothing(useSlicer.getState().switchPlan(id))) void useProjects.getState().switchEngine(id);
    else setAsking(id);
  };
  return (
    <section className="group">
      <div className="group-head">
        <h2>
          <Cpu aria-hidden />
          Slicer engine
        </h2>
      </div>
      <label className="field">
        <span className="sr-only">Slicer engine</span>
        <select aria-label="Slicer engine" data-testid="engine-select" value={flavor} disabled={busy} onChange={(e) => pick(e.target.value as EngineFlavor)}>
          {ENGINES.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      {/* On the page itself, not in the settings column, whose headings it would take on. */}
      {asking &&
        createPortal(
          <EngineSwitchDialog
            to={asking}
            onClose={() => setAsking(null)}
            onSwitch={() => {
              setAsking(null);
              void useProjects.getState().switchEngine(asking);
            }}
          />,
          document.body,
        )}
    </section>
  );
}

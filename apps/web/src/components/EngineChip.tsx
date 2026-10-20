import { useState } from 'react';
import { createPortal } from 'react-dom';
import { losesNothing } from '../lib/engine-switch';
import { ENGINES, type EngineFlavor } from '../lib/engines';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { EngineSwitchDialog } from './EngineSwitchDialog';

/**
 * The engine the project slices with, as a chip above the printer (the same
 * place on desktop and phone). On an empty plate, picking
 * the other one starts the project with it; with a model, it moves the project
 * over, asking first when something would be lost (EngineSwitchDialog).
 */
export function EngineChip() {
  const flavor = useSlicer((s) => s.flavor);
  const hasModel = useSlicer((s) => !!s.project?.objects.length);
  // Not while the engine starts, opens a file or slices.
  const busy = useSlicer((s) => s.engine !== 'ready' || s.job.kind === 'loading' || s.job.kind === 'slicing');
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<EngineFlavor | null>(null);
  const current = ENGINES.find((e) => e.id === flavor)!;
  const pick = (id: EngineFlavor) => {
    setOpen(false);
    if (id === flavor) return;
    if (!hasModel) void useProjects.getState().newProject(id);
    // Nothing to lose (a plain model on built-in presets): no question.
    else if (losesNothing(useSlicer.getState().switchPlan(id))) void useProjects.getState().switchEngine(id);
    else setAsking(id);
  };
  return (
    <span className="engine-chip-wrap">
      <button className="engine-chip" aria-haspopup="menu" aria-expanded={open} disabled={busy} data-testid="engine-chip" onClick={() => setOpen(!open)}>
        Slicing with {current.name} ▾
      </button>
      {open && (
        <div className="menu-pop engine-chip-menu" role="menu" aria-label="Engine for this project" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <p className="menu-note">Engine for this project</p>
          {ENGINES.map((e) => (
            <button key={e.id} role="menuitemradio" aria-checked={e.id === flavor} onClick={() => pick(e.id)}>
              <span>
                <b>{e.name}</b>
                <span className="muted small"> {e.blurb}</span>
              </span>
              {e.id === flavor && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
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
    </span>
  );
}

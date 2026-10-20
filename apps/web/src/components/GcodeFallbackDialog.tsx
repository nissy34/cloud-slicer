import { engineName } from '../lib/engines';
import { useSlicer } from '../state/store';

/**
 * Slicing stopped on G-code another slicer wrote (Bambu Studio 2.5's, say):
 * slice with the engine's own G-code for the printer instead, or see the error.
 */
export function GcodeFallbackDialog() {
  const question = useSlicer((s) => s.gcodeFallback);
  const flavor = useSlicer((s) => s.flavor);
  if (!question) return null;
  const { answerGcodeFallback } = useSlicer.getState();
  const engine = engineName(flavor);
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && void answerGcodeFallback(false)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="gcode-fallback-title" data-testid="gcode-fallback">
        <h2 id="gcode-fallback-title">Use {engine}'s printer commands?</h2>
        <p>
          The commands this file gives the printer at the start and on each filament change (Start G-code and Change filament G-code in the printer
          settings) were written for {question.app}, and {engine} can't use them. {engine} has its own for <b>{question.printer}</b>, which work. This
          choice is saved with this project.
        </p>
        <div className="dialog-actions">
          <button className="secondary" onClick={() => void answerGcodeFallback(false)}>
            Cancel
          </button>
          <button className="primary" autoFocus onClick={() => void answerGcodeFallback(true)}>
            Use them and slice
          </button>
        </div>
      </div>
    </div>
  );
}

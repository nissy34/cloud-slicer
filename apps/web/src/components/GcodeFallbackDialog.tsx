import { engineName } from '../lib/engines';
import { useSlicer } from '../state/store';

/**
 * Slicing stopped on G-code another slicer wrote (Bambu Studio 2.5's, say):
 * slice with the printer preset's own G-code instead, or see the error.
 */
export function GcodeFallbackDialog() {
  const question = useSlicer((s) => s.gcodeFallback);
  const flavor = useSlicer((s) => s.flavor);
  if (!question) return null;
  const { answerGcodeFallback } = useSlicer.getState();
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && void answerGcodeFallback(false)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="gcode-fallback-title" data-testid="gcode-fallback">
        <h2 id="gcode-fallback-title">This project's G-code doesn't work in {engineName(flavor)}</h2>
        <p>
          Its start and filament change G-code was written for {question.app}. Slice with the standard G-code of <b>{question.printer}</b> instead?
        </p>
        <div className="dialog-actions">
          <button className="secondary" onClick={() => void answerGcodeFallback(false)}>
            Cancel
          </button>
          <button className="primary" autoFocus onClick={() => void answerGcodeFallback(true)}>
            Slice with standard G-code
          </button>
        </div>
      </div>
    </div>
  );
}

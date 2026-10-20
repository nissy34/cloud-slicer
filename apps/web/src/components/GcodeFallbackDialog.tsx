import { engineName } from '../lib/engines';
import { useSlicer } from '../state/store';

/**
 * Slicing stopped on G-code another slicer wrote (Bambu Studio 2.5's, say):
 * slice with the printer profile's own G-code instead, or see the error.
 */
export function GcodeFallbackDialog() {
  const question = useSlicer((s) => s.gcodeFallback);
  const flavor = useSlicer((s) => s.flavor);
  if (!question) return null;
  const { answerGcodeFallback } = useSlicer.getState();
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && void answerGcodeFallback(false)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="gcode-fallback-title" data-testid="gcode-fallback">
        <h2 id="gcode-fallback-title">Use your printer's G-code?</h2>
        <p>
          This project's start and filament change G-code is from {question.app} and doesn't work in {engineName(flavor)}. Slice with the G-code from your
          printer profile (<b>{question.printer}</b>) instead?
        </p>
        <div className="dialog-actions">
          <button className="secondary" onClick={() => void answerGcodeFallback(false)}>
            Cancel
          </button>
          <button className="primary" autoFocus onClick={() => void answerGcodeFallback(true)}>
            Use printer G-code
          </button>
        </div>
      </div>
    </div>
  );
}

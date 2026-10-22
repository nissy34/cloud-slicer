import { engineName } from '../lib/engines';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';

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
    <Dialog
      title={`Use ${engine}'s start and filament change G-code?`}
      testId="gcode-fallback"
      onClose={() => void answerGcodeFallback(false)}
      footer={
        <>
          <button className="secondary" onClick={() => void answerGcodeFallback(false)}>
            Cancel
          </button>
          <button className="primary" autoFocus onClick={() => void answerGcodeFallback(true)}>
            Yes, slice
          </button>
        </>
      }
    >
      <p>
        This file's start and filament change G-code was written for {question.app}, and {engine} can't use it. {engine} has its own for <b>{question.printer}</b>,
        which works. This choice is saved with this project.
      </p>
    </Dialog>
  );
}

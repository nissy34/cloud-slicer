import { RotateCcw } from 'lucide-react';
import { useSlicer } from '../state/store';

/**
 * Desktop's Reset beside a Measure or Assemble selection: lets go of pick
 * `index`; when the first goes, the second becomes the first.
 */
export function PickReset({ index }: { index: number }) {
  return (
    <button className="ghost measure-reset" aria-label={`Reset ${index + 1}`} title="Reset" onClick={() => useSlicer.getState().measureRemove(index)}>
      <RotateCcw size={14} aria-hidden />
    </button>
  );
}

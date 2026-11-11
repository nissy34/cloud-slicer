import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSlicer } from '../state/store';

/**
 * Desktop's Reset beside a Measure or Assemble selection: lets go of pick
 * `index`; when the first goes, the second becomes the first.
 */
export function PickReset({ index }: { index: number }) {
  const { t } = useTranslation();
  return (
    <button className="ghost measure-reset" aria-label={t('pickReset.resetN', { n: index + 1 })} title={t('pickReset.reset')} onClick={() => useSlicer.getState().measureRemove(index)}>
      <RotateCcw size={14} aria-hidden />
    </button>
  );
}

import { useTranslation } from 'react-i18next';
import { useSlicer } from '../state/store';
import { Ellipsis } from 'lucide-react';
import { IconButton } from './IconButton';

/**
 * A small bar over the 3D view while several models are chosen, or while
 * choosing on a phone: how many, Select all, their menu, and Done.
 */
export function ChooseBar() {
  const { t } = useTranslation();
  const count = useSlicer((s) => (s.group.length > 1 ? s.group.length : s.selected ? 1 : 0));
  const choosing = useSlicer((s) => s.choosing);
  const several = useSlicer((s) => s.group.length > 1);
  const { selectAll, setChoosing, choose, openGroupMenu } = useSlicer.getState();
  if (!choosing && !several) return null;
  return (
    <div className="choose-bar" role="toolbar" aria-label={t('chooseBar.chosenModels')}>
      <span className="choose-count" aria-live="polite">
        {count === 0 ? t('chooseBar.tapToChoose') : t('chooseBar.chosen', { count })}
      </span>
      <button className="ghost" aria-label={t('chooseBar.selectAll')} onClick={selectAll}>
        <span className="choose-long">{t('chooseBar.selectAll')}</span>
        <span className="choose-short">{t('chooseBar.all')}</span>
      </button>
      {several && (
        <button className="ghost" title={t('chooseBar.assembleTip')} onClick={() => void useSlicer.getState().groupAction({ op: 'assemble' })}>
          {t('chooseBar.assemble')}
        </button>
      )}
      {several && (
        <IconButton
          icon={Ellipsis}
          label={t('chooseBar.menuTip')}
          aria-label={t('chooseBar.menu')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openGroupMenu({ x: r.left, y: r.bottom + 4 });
          }}
        />
      )}
      <button
        className={choosing ? 'primary' : 'ghost'}
        title={choosing ? t('chooseBar.doneTip') : t('chooseBar.clearTip')}
        onClick={() => (choosing ? setChoosing(false) : choose([]))}
      >
        {choosing ? t('chooseBar.done') : t('chooseBar.clear')}
      </button>
    </div>
  );
}

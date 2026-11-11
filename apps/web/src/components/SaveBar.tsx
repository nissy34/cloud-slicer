import { useTranslation } from 'react-i18next';
import { useProjects } from '../state/projects';
import './print-loader.css';

/** How far a save's upload got: the loading card's bar, moving while the 3MF is made (#276). */
export function SaveBar() {
  const { t } = useTranslation();
  const progress = useProjects((s) => s.saveProgress);
  return (
    <div
      className={progress === null ? 'pl-bar save-bar indeterminate' : 'pl-bar save-bar'}
      role="progressbar"
      aria-label={t('uiParts.saving')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
      data-testid="save-bar"
    >
      <span style={progress === null ? undefined : { width: `${progress * 100}%` }} />
    </div>
  );
}

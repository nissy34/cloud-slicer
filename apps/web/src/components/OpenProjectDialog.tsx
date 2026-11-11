import { Trans, useTranslation } from 'react-i18next';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';

/** Desktop's question when a 3MF project is opened over objects already loaded. */
export function OpenProjectDialog() {
  const { t } = useTranslation();
  const files = useSlicer((s) => s.pendingOpen);
  const { cancelOpen } = useSlicer.getState();
  const { openFiles } = useProjects.getState();
  if (!files) return null;
  const name = files.find((f) => /\.3mf$/i.test(f.name))?.name ?? t('openProject.thisFile');
  return (
    <Dialog
      title={t('openProject.title')}
      onClose={cancelOpen}
      footer={
        <>
          <button className="secondary" onClick={cancelOpen}>
            {t('common.cancel')}
          </button>
          <button className="secondary" onClick={() => void openFiles(files, 'geometry')}>
            {t('openProject.geometryOnly')}
          </button>
          <button className="primary" onClick={() => void openFiles(files, 'project')}>
            {t('openProject.open')}
          </button>
        </>
      }
    >
      <p>
        <Trans i18nKey={'openProject.body'} values={{ name }} components={{ b: <b /> }} />
      </p>
    </Dialog>
  );
}

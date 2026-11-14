import { useTranslation } from 'react-i18next';
import { projectThumbnailUrl } from '../account/api';
import { yourDevice } from '../lib/autosave';
import { formatWhen } from '../lib/projects';
import { useProjects } from '../state/projects';
import { Notice } from './Notice';

/** On opening the app with nothing loaded: continue the work kept in this browser, the project open here last, or a project changed on another device. */
export function ContinueCard() {
  const { t } = useTranslation();
  const offer = useProjects((s) => s.offer);
  const busy = useProjects((s) => Boolean(s.busy));
  if (!offer || busy) return null;
  const { acceptOffer, dismissOffer } = useProjects.getState();
  if (offer.kind === 'local')
    return (
      <Notice
        testId="continue-card"
        icon={<span className="project-thumb small">3MF</span>}
        title={t('continue.title')}
        text={t('continue.local', { name: offer.copy.name, when: formatWhen(offer.copy.savedAt) })}
        actions={
          <>
            <button className="secondary" onClick={() => void dismissOffer(true)}>
              {t('continue.discard')}
            </button>
            <button className="primary" onClick={() => void acceptOffer()}>
              {t('continue.continue')}
            </button>
          </>
        }
      />
    );
  const p = offer.project;
  return (
    <Notice
      testId="continue-card"
      icon={<span className="project-thumb small">{p.hasThumbnail ? <img src={projectThumbnailUrl(p)} alt="" /> : '3MF'}</span>}
      title={offer.kind === 'here' ? t('continue.projectAsk', { name: p.name }) : t('continue.project', { name: p.name })}
      text={offer.kind === 'here' ? t('continue.openHere', { when: formatWhen(p.updatedAt) }) : t('continue.editedOn', { when: formatWhen(p.updatedAt), device: yourDevice(p.deviceName) })}
      actions={
        <>
          <button className="secondary" onClick={() => void dismissOffer(false)}>
            {t('continue.notNow')}
          </button>
          <button className="primary" onClick={() => void acceptOffer()}>
            {t('continue.continue')}
          </button>
        </>
      }
    />
  );
}

/** The project was taken over by another device: this tab only views it. */
export function ViewOnlyBanner() {
  const { t } = useTranslation();
  const elsewhere = useProjects((s) => s.elsewhere);
  const name = useProjects((s) => s.current.name);
  if (!elsewhere) return null;
  const { editHere, keepMineAsCopy } = useProjects.getState();
  return (
    <Notice
      tone="warn"
      testId="view-only-banner"
      title={t('continue.editedElsewhere', { name, device: yourDevice(elsewhere.project.deviceName) })}
      text={elsewhere.unsaved ? t('continue.viewOnlyUnsaved') : t('continue.viewOnly')}
      actions={
        <>
          {elsewhere.unsaved && (
            <button className="secondary" onClick={() => void keepMineAsCopy()}>
              {t('continue.saveMineAsCopy')}
            </button>
          )}
          <button className="primary" onClick={() => void editHere()}>
            {t('continue.editHere')}
          </button>
        </>
      }
    />
  );
}

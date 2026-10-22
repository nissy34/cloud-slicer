import { projectThumbnailUrl } from '../account/api';
import { yourDevice } from '../lib/autosave';
import { formatWhen } from '../lib/projects';
import { useProjects } from '../state/projects';
import { Notice } from './Notice';

/** On opening the app with nothing loaded: continue the draft, or a project changed on another device. */
export function ContinueCard() {
  const offer = useProjects((s) => s.offer);
  const busy = useProjects((s) => Boolean(s.busy));
  if (!offer || busy) return null;
  const p = offer.project;
  const { acceptOffer, dismissOffer } = useProjects.getState();
  const draft = offer.kind === 'draft';
  return (
    <Notice
      testId="continue-card"
      icon={<span className="project-thumb small">{p.hasThumbnail ? <img src={projectThumbnailUrl(p)} alt="" /> : '3MF'}</span>}
      title={draft ? 'Continue your unsaved project?' : `Continue ${p.name}`}
      text={
        draft
          ? `${p.name}, changed ${formatWhen(p.updatedAt)}${p.deviceName ? ` on ${yourDevice(p.deviceName)}` : ''}`
          : `Edited ${formatWhen(p.updatedAt)} on ${yourDevice(p.deviceName)}`
      }
      actions={
        <>
          <button className="secondary" onClick={() => void dismissOffer(draft)}>
            {draft ? 'Discard' : 'Not now'}
          </button>
          <button className="primary" onClick={() => void acceptOffer()}>
            Continue
          </button>
        </>
      }
    />
  );
}

/** The project was taken over by another device: this tab only views it. */
export function ViewOnlyBanner() {
  const elsewhere = useProjects((s) => s.elsewhere);
  const name = useProjects((s) => s.current.name);
  if (!elsewhere) return null;
  const { editHere, keepMineAsCopy } = useProjects.getState();
  return (
    <Notice
      tone="warn"
      testId="view-only-banner"
      title={`${name} is being edited on ${yourDevice(elsewhere.project.deviceName)}`}
      text={`This tab is view only.${elsewhere.unsaved ? ' Changes you made here aren’t in it.' : ''}`}
      actions={
        <>
          {elsewhere.unsaved && (
            <button className="secondary" onClick={() => void keepMineAsCopy()}>
              Save mine as a copy
            </button>
          )}
          <button className="primary" onClick={() => void editHere()}>
            Edit here instead
          </button>
        </>
      }
    />
  );
}

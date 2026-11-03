import { projectThumbnailUrl } from '../account/api';
import { yourDevice } from '../lib/autosave';
import { formatWhen } from '../lib/projects';
import { useProjects } from '../state/projects';
import { Notice } from './Notice';

/** On opening the app with nothing loaded: continue the project open here last, the draft, or a project changed on another device. */
export function ContinueCard() {
  const offer = useProjects((s) => s.offer);
  const busy = useProjects((s) => Boolean(s.busy));
  if (!offer || busy) return null;
  const { acceptOffer, dismissOffer } = useProjects.getState();
  if (offer.kind === 'local')
    return (
      <Notice
        testId="continue-card"
        icon={<span className="project-thumb small">3MF</span>}
        title="Continue where you left off?"
        text={`${offer.copy.name}, changed ${formatWhen(offer.copy.savedAt)}. Kept in this browser, not saved.`}
        actions={
          <>
            <button className="secondary" onClick={() => void dismissOffer(true)}>
              Discard
            </button>
            <button className="primary" onClick={() => void acceptOffer()}>
              Continue
            </button>
          </>
        }
      />
    );
  const p = offer.project;
  const draft = offer.kind === 'draft';
  return (
    <Notice
      testId="continue-card"
      icon={<span className="project-thumb small">{p.hasThumbnail ? <img src={projectThumbnailUrl(p)} alt="" /> : '3MF'}</span>}
      title={draft ? 'Continue your unsaved project?' : offer.kind === 'here' ? `Continue ${p.name}?` : `Continue ${p.name}`}
      text={
        draft
          ? `${p.name}, changed ${formatWhen(p.updatedAt)}${p.deviceName ? ` on ${yourDevice(p.deviceName)}` : ''}`
          : offer.kind === 'here'
            ? `You had it open here, edited ${formatWhen(p.updatedAt)}`
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

/** Asked once, the first time a project changes (signed in with Google Drive): AutoSave to Drive, or not. */
export function AutosaveQuestion() {
  const ask = useProjects((s) => s.askAutosave);
  if (!ask) return null;
  const { answerAutosave } = useProjects.getState();
  return (
    <Notice
      testId="autosave-question"
      title="Turn on AutoSave to Google Drive?"
      text="Your work also saves to your Google Drive as you go, even before you name it, so you can continue on another device. It takes up your Google storage space. Either way, unsaved work is kept in this browser."
      actions={
        <>
          <button className="secondary" onClick={() => void answerAutosave(false)}>
            Not now
          </button>
          <button className="primary" onClick={() => void answerAutosave(true)}>
            Turn on
          </button>
        </>
      }
    />
  );
}

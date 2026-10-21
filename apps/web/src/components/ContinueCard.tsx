import { projectThumbnailUrl } from '../account/api';
import { yourDevice } from '../lib/autosave';
import { formatWhen } from '../lib/projects';
import { useProjects } from '../state/projects';

/** On opening the app with nothing loaded: continue the draft, or a project changed on another device. */
export function ContinueCard() {
  const offer = useProjects((s) => s.offer);
  const busy = useProjects((s) => Boolean(s.busy));
  if (!offer || busy) return null;
  const p = offer.project;
  const { acceptOffer, dismissOffer } = useProjects.getState();
  const draft = offer.kind === 'draft';
  return (
    <div className="continue-card" role="dialog" aria-labelledby="continue-title" data-testid="continue-card">
      <div className="continue-main">
        <div className="project-thumb small" aria-hidden>
          {p.hasThumbnail ? <img src={projectThumbnailUrl(p)} alt="" /> : <span>3MF</span>}
        </div>
        <div className="continue-text">
          <b id="continue-title">{draft ? 'Continue your unsaved project?' : `Continue ${p.name}`}</b>
          <span className="muted small">
            {draft
              ? `${p.name}, changed ${formatWhen(p.updatedAt)}${p.deviceName ? ` on ${yourDevice(p.deviceName)}` : ''}`
              : `Edited ${formatWhen(p.updatedAt)} on ${yourDevice(p.deviceName)}`}
          </span>
        </div>
      </div>
      <div className="dialog-actions">
        <button className="secondary" onClick={() => void dismissOffer(draft)}>
          {draft ? 'Discard' : 'Not now'}
        </button>
        <button className="primary" onClick={() => void acceptOffer()}>
          Continue
        </button>
      </div>
    </div>
  );
}

/** The project was taken over by another device: this tab only views it. */
export function ViewOnlyBanner() {
  const elsewhere = useProjects((s) => s.elsewhere);
  const name = useProjects((s) => s.current.name);
  if (!elsewhere) return null;
  const { editHere, keepMineAsCopy } = useProjects.getState();
  return (
    <div className="view-only-banner" role="status" data-testid="view-only-banner">
      <span className="view-only-text">
        {name} is being edited on {yourDevice(elsewhere.project.deviceName)}. This tab is view only.
        {elsewhere.unsaved && ' Changes you made here aren’t in it.'}
      </span>
      <span className="view-only-actions">
        {elsewhere.unsaved && (
          <button className="secondary" onClick={() => void keepMineAsCopy()}>
            Save mine as a copy
          </button>
        )}
        <button className="primary" onClick={() => void editHere()}>
          Edit here instead
        </button>
      </span>
    </div>
  );
}

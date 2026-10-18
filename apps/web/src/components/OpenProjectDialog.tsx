import { useSlicer } from '../state/store';

/** Desktop's question when a 3MF project is opened over objects already loaded. */
export function OpenProjectDialog() {
  const files = useSlicer((s) => s.pendingOpen);
  const { openFiles, cancelOpen } = useSlicer.getState();
  if (!files) return null;
  const name = files.find((f) => /\.3mf$/i.test(f.name))?.name ?? 'This file';
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="open-project-title">
        <h2 id="open-project-title">Open as a project?</h2>
        <p>
          <b>{name}</b> is a project with its own plates and settings. Opening it replaces what is on your plates now. Importing its geometry adds
          its objects to your plate and keeps your settings.
        </p>
        <div className="dialog-actions">
          <button className="ghost" onClick={cancelOpen}>
            Cancel
          </button>
          <button className="secondary" onClick={() => void openFiles(files, 'geometry')}>
            Import geometry only
          </button>
          <button className="primary" onClick={() => void openFiles(files, 'project')}>
            Open project
          </button>
        </div>
      </div>
    </div>
  );
}

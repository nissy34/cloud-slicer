import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';

/** Desktop's question when a 3MF project is opened over objects already loaded. */
export function OpenProjectDialog() {
  const files = useSlicer((s) => s.pendingOpen);
  const { cancelOpen } = useSlicer.getState();
  const { openFiles } = useProjects.getState();
  if (!files) return null;
  const name = files.find((f) => /\.3mf$/i.test(f.name))?.name ?? 'This file';
  return (
    <Dialog
      title="Open as a project?"
      onClose={cancelOpen}
      footer={
        <>
          <button className="secondary" onClick={cancelOpen}>
            Cancel
          </button>
          <button className="secondary" onClick={() => void openFiles(files, 'geometry')}>
            Import geometry only
          </button>
          <button className="primary" onClick={() => void openFiles(files, 'project')}>
            Open project
          </button>
        </>
      }
    >
      <p>
        <b>{name}</b> is a project with its own plates and settings. Opening it replaces what is on your plates now. Importing its geometry adds its objects to
        your plate and keeps your settings.
      </p>
    </Dialog>
  );
}

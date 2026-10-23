import { useRef, useState, type DragEvent } from 'react';
import { MODEL_EXTENSIONS } from '../lib/presets';
import { useLoading } from '../state/loading';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { ask } from './AskDialog';
import { LoadingOverlay } from './LoadingOverlay';
import { ChooseBar } from './ChooseBar';
import { GroupMenu } from './GroupMenu';
import { ObjectMenu } from './ObjectMenu';
import { PlateMenu } from './PlateMenu';
import { Toolbar } from './Toolbar';

/** File button plus drag-and-drop anywhere over the workspace. */
export function OpenModel({ children }: { children: React.ReactNode }) {
  const openFiles = useProjects((s) => s.openFiles);
  const hasModel = useSlicer((s) => (s.project?.objects.length ?? 0) > 0);
  const plates = useSlicer((s) => s.project?.plates.length ?? 1);
  const { deletePlate } = useSlicer.getState();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const loading = useLoading() !== null;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void openFiles([...e.dataTransfer.files]);
  };

  return (
    <div
      className="workspace"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {children}
      <input
        ref={input}
        type="file"
        multiple
        accept={MODEL_EXTENSIONS.join(',')}
        hidden
        data-testid="model-input"
        onChange={(e) => {
          if (e.target.files?.length) void openFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
      {!hasModel && !dragging && !loading && (
        <div className="empty">
          <p>Drop STL, 3MF, OBJ, STEP or SVG files here</p>
          <button className="primary" onClick={() => input.current?.click()}>
            Open model
          </button>
        </div>
      )}
      {/* Always there, so a first visit shows what the slicer can do; tools that need a model wait greyed out. */}
      <Toolbar onAdd={() => input.current?.click()} />
      {hasModel && (
        <>
          <div className="workspace-tools">
            {plates > 1 && (
              <button className="ghost" title="Delete this plate and what's on it" onClick={() => void deletePlate()}>
                Delete plate
              </button>
            )}
            <button
              className="ghost"
              onClick={async () => {
                const p = useProjects.getState();
                if (!p.dirty || (await ask({ title: 'Clear the plate?', text: `“${p.current.name}” has changes that aren't saved yet.`, action: 'Clear all' })))
                  void p.newProject();
              }}
            >
              Clear all
            </button>
          </div>
        </>
      )}
      {dragging && <div className="dropzone">Drop to add</div>}
      {hasModel && <ChooseBar />}
      <ObjectMenu />
      <GroupMenu />
      <PlateMenu onAdd={() => input.current?.click()} />
      <LoadingOverlay />
    </div>
  );
}

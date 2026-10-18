import { useRef, useState, type DragEvent } from 'react';
import { MODEL_EXTENSIONS } from '../lib/presets';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { Toolbar } from './Toolbar';
import { ToolPanel } from './ToolPanel';

/** File button plus drag-and-drop anywhere over the workspace. */
export function OpenModel({ children }: { children: React.ReactNode }) {
  const openFiles = useProjects((s) => s.openFiles);
  const hasModel = useSlicer((s) => (s.project?.objects.length ?? 0) > 0);
  const plates = useSlicer((s) => s.project?.plates.length ?? 1);
  const { deletePlate } = useSlicer.getState();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

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
      {!hasModel && !dragging && (
        <div className="empty">
          <p>Drop STL, 3MF, OBJ or STEP files here</p>
          <button className="primary" onClick={() => input.current?.click()}>
            Open model
          </button>
        </div>
      )}
      {hasModel && (
        <>
          <Toolbar onAdd={() => input.current?.click()} />
          <ToolPanel />
          <div className="workspace-tools">
            {plates > 1 && (
              <button className="ghost" title="Delete this plate and what's on it" onClick={() => void deletePlate()}>
                Delete plate
              </button>
            )}
            <button
              className="ghost"
              onClick={() => {
                const p = useProjects.getState();
                if (!p.dirty || confirm(`Clear the plate? “${p.current.name}” has unsaved changes.`)) void p.newProject();
              }}
            >
              Clear all
            </button>
          </div>
        </>
      )}
      {dragging && <div className="dropzone">Drop to add</div>}
    </div>
  );
}

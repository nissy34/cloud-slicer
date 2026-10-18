import { useRef, useState, type DragEvent } from 'react';
import { MODEL_EXTENSIONS } from '../lib/presets';
import { useSlicer } from '../state/store';

/** File button plus drag-and-drop anywhere over the workspace. */
export function OpenModel({ children }: { children: React.ReactNode }) {
  const openFiles = useSlicer((s) => s.openFiles);
  const hasModel = useSlicer((s) => (s.project?.objects.length ?? 0) > 0);
  const clearProject = useSlicer((s) => s.clearProject);
  const plates = useSlicer((s) => s.project?.plates.length ?? 1);
  const { arrange, addPlate, deletePlate } = useSlicer.getState();
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
        <div className="workspace-tools">
          <button className="secondary" onClick={() => input.current?.click()}>
            Add model
          </button>
          <button className="secondary" title="Pack the objects on this plate" onClick={() => void arrange()}>
            Arrange
          </button>
          <button className="secondary" onClick={() => void addPlate()}>
            Add plate
          </button>
          {plates > 1 && (
            <button className="ghost" title="Delete this plate and what's on it" onClick={() => void deletePlate()}>
              Delete plate
            </button>
          )}
          <button className="ghost" onClick={() => void clearProject()}>
            Clear all
          </button>
        </div>
      )}
      {dragging && <div className="dropzone">Drop to add</div>}
    </div>
  );
}

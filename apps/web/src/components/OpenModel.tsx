import { useRef, useState, type DragEvent } from 'react';
import { MODEL_EXTENSIONS } from '../lib/presets';
import { useSlicer } from '../state/store';

/** File button plus drag-and-drop anywhere over the workspace. */
export function OpenModel({ children }: { children: React.ReactNode }) {
  const openModel = useSlicer((s) => s.openModel);
  const hasModel = useSlicer((s) => s.model != null);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void openModel(file);
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
        accept={MODEL_EXTENSIONS.join(',')}
        hidden
        data-testid="model-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openModel(file);
          e.target.value = '';
        }}
      />
      {!hasModel && !dragging && (
        <div className="empty">
          <p>Drop an STL, 3MF or OBJ file here</p>
          <button className="primary" onClick={() => input.current?.click()}>
            Open model
          </button>
        </div>
      )}
      {hasModel && (
        <button className="secondary open-another" onClick={() => input.current?.click()}>
          Open another model
        </button>
      )}
      {dragging && <div className="dropzone">Drop to open</div>}
    </div>
  );
}

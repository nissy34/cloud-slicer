import { formatBytes, formatWhen } from '../lib/projects';
import { useRecent } from '../state/recent';
import { useProjects } from '../state/projects';
import type { RecentFile } from '../lib/recent';

/** Opens a recent file the way the button it sits under would; false when the browser no longer has it. */
export async function openRecent(entry: RecentFile, open: (files: File[]) => unknown): Promise<boolean> {
  const file = await useRecent.getState().load(entry);
  if (!file) {
    useProjects.setState({ message: `“${entry.name}” is no longer kept in this browser. Open it from this device instead.`, messageWarn: true });
    return false;
  }
  await open([file]);
  return true;
}

/** Files opened from this device, newest first, under the empty plate's Open model button. */
export function RecentFiles({ onOpen }: { onOpen: (files: File[]) => unknown }) {
  const files = useRecent((s) => s.files).slice(0, 5);
  if (!files.length) return null;
  return (
    <div className="recent-files">
      <h3>Recent files</h3>
      <ul>
        {files.map((f) => (
          <li key={f.key}>
            <button title={`Open ${f.name}`} onClick={() => void openRecent(f, onOpen)}>
              <span className="recent-name">{f.name}</span>
              <span className="recent-meta">
                {formatWhen(f.openedAt)} · {formatBytes(f.size)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The open project as a document: its name, where it is saved, whether it has
// unsaved changes, and saving / opening it.
//
// A project is saved as Orca's own 3MF (the engine's store_bbs_3mf, like
// desktop's Save project). Signed in, Save keeps it in the account's online
// projects (R2 + D1, functions/_lib/projects.ts); signed out, Save downloads
// the file. Download 3MF always downloads.
import { create } from 'zustand';
import { api, ApiError, type OnlineProject } from '../account/api';
import { copyName, nameFromFile, newProjectId, projectFileName, projectSignature, UNTITLED } from '../lib/projects';
import { snapshot } from '../lib/snapshot';
import { useAccount } from './account';
import { useSlicer, type OpenMode } from './store';
import { useRecent } from './recent';

export interface CurrentProject {
  name: string;
  /** Online project id, or null when it isn't saved online. */
  id: string | null;
  /** Online version this copy started from (0 when not online). */
  version: number;
}

interface ProjectsState {
  current: CurrentProject;
  /** Something a save would keep changed since the project was opened or saved. */
  dirty: boolean;
  /** What is being done right now ('' when idle), e.g. "Saving…". */
  busy: string;
  /** A project from the account being downloaded: bytes so far, of `total` (0 when unknown). */
  downloading: { name: string; loaded: number; total: number } | null;
  /** The last problem or result, shown under the project menu. */
  message: string;
  messageWarn: boolean;
  /** A save found a newer version saved from another device. */
  conflict: { theirs: OnlineProject | null } | null;
  /** The Projects list is open. */
  listOpen: boolean;
  /** Save as is asking for a name. */
  saveAsOpen: boolean;

  /** Online when signed in (and the site has project storage), else a download. */
  canSaveOnline(): boolean;
  save(): Promise<void>;
  saveAs(name: string): Promise<void>;
  download(): Promise<void>;
  resolveConflict(choice: 'overwrite' | 'copy' | 'cancel'): Promise<void>;
  /** Opens model or project files from this device (a 3MF replaces the project). */
  /** Adds model files, or opens a 3MF as the project (see the slicer store's openFiles). */
  openFiles(files: File[], mode?: OpenMode): Promise<void>;
  openOnline(p: OnlineProject): Promise<void>;
  /** A project in the list was renamed or deleted. */
  onlineChanged(p: OnlineProject | { id: string; deleted: true }): void;
  newProject(): Promise<void>;
  setListOpen(open: boolean): void;
  setSaveAsOpen(open: boolean): void;
  clearMessage(): void;
}

const blank = (): CurrentProject => ({ name: UNTITLED, id: null, version: 0 });

// What was last opened or saved, to tell whether anything changed since.
let savedSignature = '';
let paintedSinceSave = false;
const signature = () => {
  const s = useSlicer.getState();
  // Mixes are saved with the project, so changing them is an unsaved change too.
  return projectSignature(s.project, s.selection, { ...s.overrides, mixed_filament_definitions: s.mixDefinitions });
};
function markClean() {
  savedSignature = signature();
  paintedSinceSave = false;
  useProjects.setState({ dirty: false });
}

async function buildFile(): Promise<{ file: Blob; png: Blob | null }> {
  const shot = await snapshot();
  const plate = useSlicer.getState().plate;
  const bytes = await useSlicer
    .getState()
    .projectFile(shot ? { plate, width: shot.width, height: shot.height, pixels: shot.pixels } : null);
  return { file: new Blob([bytes], { type: 'model/3mf' }), png: shot?.png ?? null };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const errorText = (e: unknown) => (e as Error).message || 'Something went wrong';

export const useProjects = create<ProjectsState>((set, get) => {
  // Saves online as `target`. baseVersion undefined overwrites what is there.
  async function upload(target: CurrentProject, baseVersion: number | undefined) {
    set({ busy: 'Saving…', message: '' });
    try {
      const { file, png } = await buildFile();
      const id = target.id ?? newProjectId();
      const saved = await api.saveProject(id, target.name, file, baseVersion);
      // The project is saved even if its picture isn't.
      if (png) await api.saveProjectThumbnail(id, png).catch(() => {});
      set({ current: { name: saved.name, id: saved.id, version: saved.version }, conflict: null, message: `Saved “${saved.name}” to your projects`, messageWarn: false });
      markClean();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        set({ conflict: { theirs: (e.body.current as OnlineProject | null) ?? null } });
        return;
      }
      set({ message: `Not saved: ${errorText(e)}`, messageWarn: true });
    } finally {
      set({ busy: '' });
    }
  }

  async function downloadAs(name: string) {
    set({ busy: 'Preparing the 3MF…', message: '' });
    try {
      const { file } = await buildFile();
      downloadBlob(file, projectFileName(name));
      return true;
    } catch (e) {
      set({ message: `Couldn't make the 3MF: ${errorText(e)}`, messageWarn: true });
      return false;
    } finally {
      set({ busy: '' });
    }
  }

  return {
    current: blank(),
    dirty: false,
    busy: '',
    downloading: null,
    message: '',
    messageWarn: false,
    conflict: null,
    listOpen: false,
    saveAsOpen: false,

    canSaveOnline: () => useAccount.getState().status === 'signedIn',

    async save() {
      if (get().busy) return;
      const cur = get().current;
      if (!get().canSaveOnline()) {
        if (await downloadAs(cur.name)) {
          set({ current: { ...cur, id: null, version: 0 } });
          markClean();
        }
        return;
      }
      if (!cur.id && cur.name === UNTITLED) return set({ saveAsOpen: true });
      await upload(cur, cur.id ? cur.version : 0);
    },

    async saveAs(name) {
      set({ saveAsOpen: false });
      const target = { name: name.trim() || UNTITLED, id: null, version: 0 };
      if (!get().canSaveOnline()) {
        if (await downloadAs(target.name)) {
          set({ current: target });
          markClean();
        }
        return;
      }
      await upload(target, 0);
    },

    download: async () => void (await downloadAs(get().current.name)),

    async resolveConflict(choice) {
      const cur = get().current;
      const theirs = get().conflict?.theirs;
      set({ conflict: null });
      if (choice === 'overwrite') await upload(cur, undefined);
      if (choice === 'copy') {
        const taken = await api.projects().then((l) => l.projects.map((p) => p.name)).catch(() => [theirs?.name ?? cur.name]);
        await upload({ name: copyName(cur.name, taken), id: null, version: 0 }, 0);
      }
    },

    async openFiles(files, mode) {
      void useRecent.getState().remember(files);
      const slicer = useSlicer.getState();
      const wasEmpty = !slicer.project?.objects.length;
      const project = files.find((f) => /\.3mf$/i.test(f.name));
      if (await slicer.openFiles(files, mode)) {
        set({ current: { name: nameFromFile(project!.name), id: null, version: 0 } });
        markClean();
      } else if (wasEmpty && files.length && get().current.name === UNTITLED && !get().current.id) {
        // Like desktop: a new project is named after its first model.
        set({ current: { name: nameFromFile(files[0].name), id: null, version: 0 } });
      }
    },

    async openOnline(p) {
      set({ busy: `Opening “${p.name}”…`, message: '', listOpen: false });
      try {
        set({ downloading: { name: p.name, loaded: 0, total: 0 } });
        const { bytes, version } = await api.projectFile(p.id, (loaded, total) => set({ downloading: { name: p.name, loaded, total } }));
        set({ downloading: null });
        await useSlicer.getState().openFiles([new File([bytes], projectFileName(p.name), { type: 'model/3mf' })], 'project');
        set({ current: { name: p.name, id: p.id, version: version || p.version } });
        markClean();
      } catch (e) {
        set({ message: `Couldn't open “${p.name}”: ${errorText(e)}`, messageWarn: true });
      } finally {
        set({ busy: '', downloading: null });
      }
    },

    onlineChanged(p) {
      const cur = get().current;
      if (cur.id !== p.id) return;
      if ('deleted' in p) set({ current: { ...cur, id: null, version: 0 }, dirty: true });
      else set({ current: { ...cur, name: p.name, version: p.version } });
    },

    async newProject() {
      await useSlicer.getState().clearProject();
      set({ current: blank(), message: '' });
      markClean();
    },

    setListOpen: (listOpen) => set({ listOpen }),
    setSaveAsOpen: (saveAsOpen) => set({ saveAsOpen }),
    clearMessage: () => set({ message: '' }),
  };
});

// Unsaved changes: anything a save keeps, or paint (which the signature can't see).
// An empty plate never counts as unsaved.
useSlicer.subscribe((s, prev) => {
  const same = s.project === prev.project && s.selection === prev.selection && s.overrides === prev.overrides && s.mixDefinitions === prev.mixDefinitions;
  if (same && s.preview === prev.preview && s.overlay === prev.overlay) return;
  if (s.paint && ((s.preview !== prev.preview && prev.preview) || (s.overlay !== prev.overlay && prev.overlay))) paintedSinceSave = true;
  const dirty = Boolean(s.project?.objects.length) && (paintedSinceSave || signature() !== savedSignature);
  if (dirty !== useProjects.getState().dirty) useProjects.setState({ dirty });
});
// A fresh page starts clean once the engine has its presets and selection.
useSlicer.subscribe((s, prev) => {
  if (s.engine === 'ready' && prev.engine !== 'ready') markClean();
});

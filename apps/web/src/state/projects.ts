// The open project as a document: its name, where it is saved, whether it has
// unsaved changes, and saving / opening it.
//
// A project is saved as Orca's own 3MF (the engine's store_bbs_3mf, like
// desktop's Save project). Signed in, Save keeps it in the account's online
// projects: the file in the person's Google Drive (account/drive.ts), its list
// entry in D1 (functions/_lib/projects.ts); signed out, or without Drive, Save
// downloads the file. Download 3MF always downloads.
//
// AutoSave keeps unsaved work in this browser only (lib/local-copy.ts), signed
// in or not, a few seconds after each change (lib/autosave.ts has the timing),
// and the Continue card offers it back after a crash or a closed tab. A project
// goes to Google Drive only on Save: uploading the whole 3MF after every change
// would cost big projects hundreds of MB.
//
// One device edits a saved project at a time: opening it elsewhere takes it
// over, and this tab then only views it (`elsewhere`) until "Edit here instead".
import { create } from 'zustand';
import { api, ApiError, type OnlineProject } from '../account/api';
import { downloadFromDrive, driveGone, uploadToDrive } from '../account/drive';
import { downloadPicked, type PickedFile } from '../account/drive-picker';
import { autosaveDelay, continueOffer, deviceNameFrom, goneText, type ContinueOffer, type OnlineOffer } from '../lib/autosave';
import { clearLocalCopy, loadLocalCopy, saveLocalCopy, type LocalCopy } from '../lib/local-copy';
import { copyName, freeName, nameFromFile, newProjectId, projectFileName, projectSignature, sentOf, UNTITLED } from '../lib/projects';
import { engineFromUrl, engineName, engineOf3mf, type EngineFlavor } from '../lib/engines';
import { SETUP_KEY, type Setup } from '../lib/setup';
import { sharedOnLoad, splitShared, takeSharedFiles } from '../lib/share-target';
import { snapshot } from '../lib/snapshot';
import { isCancelled, unlessCancelled } from '../lib/time-limit';
import { deviceId, loadOpenProject, saveDefaultEngine, saveOpenProject } from '../lib/storage';
import { getUserSetting, useAccount } from './account';
import { useSlicer, type OpenMode } from './store';

export interface CurrentProject {
  name: string;
  /** Online project id, or null when it isn't saved online. */
  id: string | null;
  /** Online version this copy started from (0 when not online). */
  version: number;
  /**
   * Opened from Google Drive (Open from Google Drive) and not saved yet: the Drive file's name. Save then says it keeps a
   * copy in the Cloud Slicer folder, and that this file stays as it is.
   */
  fromDrive?: string;
}

/** The project is being edited on another device: this tab only views it. */
export interface Elsewhere {
  project: OnlineProject;
  /** Changes made here that the other device doesn't have (offered as a copy). */
  unsaved: boolean;
}

interface ProjectsState {
  current: CurrentProject;
  /** Something a save would keep changed since the project was opened or saved. */
  dirty: boolean;
  /** What is being done right now ('' when idle), e.g. "Saving…". */
  busy: string;
  /** A Save, Save a copy or Download 3MF the person asked for is running: a card says so until it is done. */
  saving: boolean;
  /** How far the save's upload got, 0 to 1 (null while it isn't uploading). */
  saveProgress: number | null;
  /** The running save can still be cancelled (not once it is being recorded, which is quick). */
  saveCancel: boolean;
  /** Stops the running save (and any waiting after it): nothing is saved, the changes stay here. */
  cancelSave(): void;
  /** A project from the account being downloaded: bytes so far, of `total` (0 when unknown). */
  downloading: { name: string; loaded: number; total: number } | null;
  /** The last problem or result, shown under the project menu. */
  message: string;
  messageWarn: boolean;
  /** A save found a newer version saved from another device, or the file changed in Google Drive (`inDrive`). */
  conflict: { theirs: OnlineProject | null; inDrive?: boolean } | null;
  /** The unsaved changes are kept in this browser (AutoSave), so a closed tab doesn't lose them. */
  keptHere: boolean;
  /** A project whose file was deleted in Google Drive: offered for removal from the list. */
  gone: OnlineProject | null;
  /** Removes `gone` from the list (its file is already gone from Drive). */
  removeGone(): Promise<void>;
  /** The Projects list is open. */
  listOpen: boolean;
  /** Save is asking for a name: 'name' names the open project, 'copy' saves a copy. */
  saveAsOpen: false | 'name' | 'copy';
  elsewhere: Elsewhere | null;
  /** The Continue card: work kept in this browser, or a project open here before or changed on another device. */
  offer: ContinueOffer | null;
  /** The first look for a Continue card is done (the setup wizard waits for it). */
  offerChecked: boolean;

  /** Online when signed in with Google Drive connected (and online projects on for them), else a download. */
  canSaveOnline(): boolean;
  /** Ctrl+S: names a new project, else saves now. Signed out: downloads. */
  save(): Promise<void>;
  /** Names the open project (mode 'name') or saves a copy and continues in it ('copy'). */
  saveAs(name: string): Promise<void>;
  download(): Promise<void>;
  resolveConflict(choice: 'overwrite' | 'copy' | 'cancel'): Promise<void>;
  /** Adds model files, or opens a 3MF as the project (see the slicer store's openFiles). */
  openFiles(files: File[], mode?: OpenMode): Promise<void>;
  /**
   * Open from Google Drive: downloads the files picked in Google's window (account/drive-picker.ts) and opens them like
   * files from the device (`mode` as there). Files the app can't open are named and left out.
   */
  openFromDrive(picked: PickedFile[], mode?: OpenMode): Promise<void>;
  openOnline(p: OnlineProject): Promise<void>;
  /** A project in the list was renamed or deleted. */
  onlineChanged(p: OnlineProject | { id: string; deleted: true }): void;
  /** An empty project, with the default engine or the one given. */
  newProject(engine?: EngineFlavor): Promise<void>;
  /** Moves the open project to the other engine (the Slicer engine dropdown); it then has unsaved changes. */
  switchEngine(engine: EngineFlavor): Promise<void>;
  /** Before the open project is replaced: saves, asks or discards as needed. False: stay. */
  leaveOk(): Promise<boolean>;
  /** View only: load the other device's latest save and edit it here. */
  editHere(): Promise<void>;
  /** View only with changes made here: keep them as a copy and continue in it. */
  keepMineAsCopy(): Promise<void>;
  /** Looks for something to continue (the Continue card). */
  findOffer(): Promise<void>;
  acceptOffer(): Promise<void>;
  /** "Not now", or "Discard" for the work kept in this browser (deletes it). */
  dismissOffer(discard: boolean): Promise<void>;
  setListOpen(open: boolean): void;
  setSaveAsOpen(open: false | 'name' | 'copy'): void;
  clearMessage(): void;
}

const blank = (): CurrentProject => ({ name: UNTITLED, id: null, version: 0 });

/** Still the page's first project: nothing on the plate, never named or saved. */
export function untouchedProject(): boolean {
  const p = useProjects.getState().current;
  return !useSlicer.getState().project?.objects.length && p.name === UNTITLED && !p.id;
}

/** The engine new projects use: the setup wizard's choice, else Snapmaker Orca. */
export const defaultEngine = (): EngineFlavor => getUserSetting<Setup>(SETUP_KEY)?.engine ?? 'snapmaker';

/** This device, as saves name it. */
export const thisDevice = () => ({ id: deviceId(), name: deviceNameFrom(navigator.userAgent, navigator.maxTouchPoints) });

/** The project is open on another device: editing here is off. */
export const viewOnly = () => useProjects.getState().elsewhere !== null;

// Opening a project made with the other engine starts that engine first.
async function useEngineOf(flavor: EngineFlavor | null) {
  const slicer = useSlicer.getState();
  if (!flavor || flavor === slicer.flavor) return false;
  await slicer.switchEngine(flavor);
  if (useSlicer.getState().engine !== 'ready') throw new Error(`${engineName(flavor)} could not start`);
  return true;
}
const switchedNotice = (flavor: EngineFlavor) =>
  useSlicer.setState({ notice: `Opened with ${engineName(flavor)}, the engine this project was made with.`, noticeWarn: false });

// What was last opened or saved, to tell whether anything changed since.
let savedSignature = '';
let paintedSinceSave = false;
// Counts paint strokes, so a save knows whether paint changed while it ran.
let paintCount = 0;
const signature = () => {
  const s = useSlicer.getState();
  // Mixes are saved with the project, so changing them is an unsaved change too.
  return projectSignature(s.project, s.selection, { ...s.overrides, mixed_filament_definitions: s.mixDefinitions });
};
function markClean() {
  savedSignature = signature();
  paintedSinceSave = false;
  useProjects.setState({ dirty: false, keptHere: false });
}
// After a save of what the project was when it started (`sig`, `paints`): clean
// unless it changed while the file was being made and sent.
function markSaved(sig: string, paints: number) {
  savedSignature = sig;
  paintedSinceSave = paintCount !== paints;
  const dirty = paintedSinceSave || signature() !== sig;
  useProjects.setState({ dirty, keptHere: false });
}

async function buildFile(): Promise<{ file: Blob; picture: Blob | null }> {
  const shot = await snapshot();
  const plate = useSlicer.getState().plate;
  const bytes = await useSlicer
    .getState()
    .projectFile(shot ? { plate, width: shot.width, height: shot.height, pixels: shot.pixels } : null);
  return { file: new Blob([bytes], { type: 'model/3mf' }), picture: shot?.picture ?? null };
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
const hasObjects = () => Boolean(useSlicer.getState().project?.objects.length);
const signedIn = () => useAccount.getState().status === 'signedIn';
/**
 * Projects save online only into the person's Google Drive: someone who said no
 * to Drive at sign-in saves as a download until they connect it (account menu).
 */
const savesOnline = () => {
  const user = useAccount.getState().user;
  return signedIn() && user?.drive === true && user.projects !== false;
};

// The time of the last change, which AutoSave waits a quiet moment after.
let lastChange = 0;
// One save at a time; a save asked for meanwhile runs after it.
let saving: Promise<void> = Promise.resolve();
const queue = (fn: () => Promise<void>) => (saving = saving.then(fn, fn));
// Cancel for the saves running or waiting now.
const saveAborts = new Set<AbortController>();
/** A Cancel for one save, until `done`. */
function cancellable(): { signal: AbortSignal; done: () => void } {
  const ctl = new AbortController();
  saveAborts.add(ctl);
  return { signal: ctl.signal, done: () => saveAborts.delete(ctl) };
}
const idle = { busy: '', saving: false, saveCancel: false, saveProgress: null };

export const useProjects = create<ProjectsState>((set, get) => {
  // A copy just saved from project `from` starts with its print history (lib/prints.ts).
  async function copyHistory(from: string | null) {
    const to = get().current.id;
    if (from && to && from !== to) await api.copyPrints(to, from).catch((e) => console.warn('Print history not copied:', e));
  }

  // Saves online as `target`. baseVersion undefined overwrites what is there. True when saved.
  // `signal`: Cancel (one of its own when not given).
  async function upload(target: CurrentProject, baseVersion: number | undefined, signal?: AbortSignal): Promise<boolean> {
    const own = signal ? null : cancellable();
    signal ??= own!.signal;
    set({ busy: 'Saving…', saving: true, saveCancel: true, saveProgress: null, message: '' });
    const sig = signature();
    const paints = paintCount;
    try {
      // The engine does one thing at a time: a slice running now finishes first.
      // Making the 3MF of a big project takes a while (about 30 s for 86 MB): say so, so it doesn't look stuck (#284).
      set({ busy: useSlicer.getState().job.kind === 'slicing' ? 'Saving… after the slice' : 'Saving… making the 3MF' });
      const { file, picture } = await unlessCancelled(buildFile(), signal);
      const id = target.id ?? newProjectId();
      // Projects live in the person's Google Drive: the page uploads the file there, then the save points at it,
      // saying how far it got.
      const drive = await uploadToDrive(file, target.name, {
        signal,
        onProgress: (sent, total) => set({ busy: `Saving… ${sentOf(sent, total)}`, saveProgress: total ? Math.min(1, sent / total) : 1 }),
      });
      // Recording the save is quick and can't be stopped halfway (the server would keep it).
      set({ busy: 'Saving… finishing', saveCancel: false, saveProgress: 1 });
      const saved = await api.saveProject(id, target.name, drive, baseVersion, useSlicer.getState().flavor, {
        device: thisDevice(),
        plates: useSlicer.getState().project?.plates.length,
      });
      // The project is saved even if its picture isn't.
      if (picture) await api.saveProjectThumbnail(id, picture).catch(() => {});
      set({ current: { name: saved.name, id: saved.id, version: saved.version }, conflict: null });
      set({ message: `Saved “${saved.name}” to your projects`, messageWarn: false });
      markSaved(sig, paints);
      return true;
    } catch (e) {
      // Cancelled: nothing saved, and Cancel already said so.
      if (isCancelled(e)) return false;
      const code = e instanceof ApiError ? (e.body.code as string | undefined) : undefined;
      if (e instanceof ApiError && e.status === 409 && code === 'elsewhere') {
        set({ elsewhere: { project: e.body.current as OnlineProject, unsaved: get().dirty } });
        return false;
      }
      if (e instanceof ApiError && e.status === 409) {
        set({ conflict: { theirs: (e.body.current as OnlineProject | null) ?? null, inDrive: code === 'changed-in-drive' } });
        return false;
      }
      set({ message: `Not saved: ${errorText(e)}`, messageWarn: true });
      return false;
    } finally {
      own?.done();
      set(idle);
    }
  }

  async function downloadAs(name: string) {
    const cancel = cancellable();
    set({ busy: 'Preparing the 3MF…', saving: true, saveCancel: true, saveProgress: null, message: '' });
    try {
      const { file } = await unlessCancelled(buildFile(), cancel.signal);
      downloadBlob(file, projectFileName(name));
      return true;
    } catch (e) {
      if (!isCancelled(e)) set({ message: `Couldn't make the 3MF: ${errorText(e)}`, messageWarn: true });
      return false;
    } finally {
      cancel.done();
      set(idle);
    }
  }

  // A save the person asked for shows "Saving…" from the press, also while a save
  // before it finishes first, or while the names are checked, until it is done.
  async function asked(fn: (signal: AbortSignal) => Promise<void>) {
    const cancel = cancellable();
    set({ busy: 'Saving…', saving: true, saveCancel: true, saveProgress: null, message: '' });
    try {
      // Cancelled while it waited: it doesn't start.
      await queue(async () => void (cancel.signal.aborted || (await fn(cancel.signal))));
    } finally {
      cancel.done();
      // Something else started meanwhile (opening a project) keeps its own text.
      set((s) => (s.busy.startsWith('Saving') ? idle : { saving: false, saveCancel: false, saveProgress: null }));
    }
  }


  // Unsaved work kept in this browser, opened again as it was (still unsaved).
  async function openLocal(copy: LocalCopy) {
    set({ busy: `Opening “${copy.name}”…`, message: '', offer: null });
    try {
      if (await useEngineOf(copy.engine)) switchedNotice(copy.engine);
      const opened = await useSlicer.getState().openFiles([new File([copy.file], projectFileName(copy.name), { type: 'model/3mf' })], 'project');
      if (opened === 'cancelled') {
        set({ current: blank() });
        markClean();
        return;
      }
      set({ current: { name: copy.name, id: copy.id, version: copy.version }, elsewhere: null, conflict: null });
      markClean();
      // Still unsaved, and already kept here.
      paintedSinceSave = true;
      set({ dirty: true, keptHere: true });
    } catch (e) {
      set({ message: `Couldn't open “${copy.name}”: ${errorText(e)}`, messageWarn: true });
    } finally {
      set({ busy: '' });
    }
  }

  // The open project was deleted on another device: nothing here is lost. It
  // stays open as unsaved work, which AutoSave keeps in this browser.
  function keepGone(device: string | null | undefined) {
    const cur = get().current;
    set({
      current: { name: cur.name, id: null, version: 0 },
      elsewhere: null,
      conflict: null,
      message: goneText(cur.name, device),
      messageWarn: true,
    });
    paintedSinceSave = true;
    set({ dirty: hasObjects() });
  }

  /** Names other saved projects have, so a new save doesn't repeat one (`except`: the open project's own id). */
  const takenNames = (except: string | null, signal?: AbortSignal) =>
    api
      .projects(signal)
      .then((l) => l.projects.filter((p) => p.id !== except).map((p) => p.name))
      .catch(() => [] as string[]);

  return {
    current: blank(),
    dirty: false,
    busy: '',
    saving: false,
    saveProgress: null,
    saveCancel: false,
    downloading: null,
    message: '',
    messageWarn: false,
    conflict: null,
    keptHere: false,
    gone: null,
    listOpen: false,
    saveAsOpen: false,
    elsewhere: null,
    offer: null,
    offerChecked: false,

    canSaveOnline: () => savesOnline(),

    cancelSave() {
      if (!get().saveCancel) return;
      for (const ctl of saveAborts) ctl.abort();
      set({ message: 'Save cancelled', messageWarn: false });
    },

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
      if (get().elsewhere) return;
      // Like Word: the first Save names the project.
      if (!cur.id) return set({ saveAsOpen: 'name' });
      await asked(async (signal) => {
        const now = get().current;
        await upload(now, now.version, signal);
      });
    },

    async saveAs(name) {
      const mode = get().saveAsOpen || 'copy';
      set({ saveAsOpen: false });
      const clean = name.trim() || UNTITLED;
      if (!get().canSaveOnline()) {
        if (await downloadAs(clean)) {
          set({ current: { name: clean, id: null, version: 0 } });
          markClean();
        }
        return;
      }
      await asked(async (signal) => {
        // Naming a new project and saving a copy both make a new online project.
        const from = get().current;
        if (await upload({ name: freeName(clean, await takenNames(null, signal)), id: null, version: 0 }, 0, signal)) {
          if (mode === 'copy') await copyHistory(from.id);
        }
      });
    },

    download: async () => void (await downloadAs(get().current.name)),

    async resolveConflict(choice) {
      const cur = get().current;
      const theirs = get().conflict?.theirs;
      set({ conflict: null });
      await asked(async (signal) => {
        if (choice === 'overwrite') await upload(cur, undefined, signal);
        if (choice === 'copy') {
          const taken = await api.projects(signal).then((l) => l.projects.map((p) => p.name)).catch(() => [theirs?.name ?? cur.name]);
          if (await upload({ name: copyName(cur.name, taken), id: null, version: 0 }, 0, signal)) await copyHistory(cur.id);
        }
      });
    },

    async openFiles(files, mode) {
      const wasEmpty = !useSlicer.getState().project?.objects.length;
      const threeMfs = files.filter((f) => /\.3mf$/i.test(f.name));
      const project = threeMfs[0];
      const asProject = threeMfs.length === 1 && mode !== 'geometry' && (mode === 'project' || wasEmpty);
      if (get().elsewhere && !asProject) {
        set({ message: 'This project is view only here. Use “Edit here instead” to change it.', messageWarn: true });
        return;
      }
      // A single 3MF opens as the project (see the slicer store's openFiles), with its own engine.
      let switched: EngineFlavor | null = null;
      if (asProject) {
        const made = await engineOf3mf(project);
        try {
          if (await useEngineOf(made)) switched = made;
        } catch (e) {
          set({ message: `Couldn't open “${project.name}”: ${errorText(e)}`, messageWarn: true });
          return;
        }
      }
      const opened = await useSlicer.getState().openFiles(files, mode);
      if (opened === 'cancelled') {
        // Dropped before it was drawn: an empty new project, as New project leaves it.
        offerSettled = true;
        set({ current: blank(), elsewhere: null, offer: null });
        markClean();
      } else if (opened) {
        offerSettled = true;
        set({ current: { name: nameFromFile(project!.name), id: null, version: 0 }, elsewhere: null, offer: null });
        markClean();
        // Not saved anywhere yet: AutoSave keeps it in this browser.
        paintedSinceSave = true;
        set({ dirty: true });
        if (switched) switchedNotice(switched);
      } else if (wasEmpty && files.length && get().current.name === UNTITLED && !get().current.id) {
        // Like desktop: a new project is named after its first model.
        offerSettled = true;
        set({ current: { name: nameFromFile(files[0].name), id: null, version: 0 }, offer: null });
      }
    },

    async openFromDrive(picked, mode) {
      if (!picked.length || get().busy) return;
      const label = picked.length === 1 ? picked[0].name : `${picked.length} files`;
      set({ busy: `Opening “${label}”…`, message: '' });
      let files: File[];
      let skipped: string[];
      try {
        set({ downloading: { name: label, loaded: 0, total: 0 } });
        ({ files, skipped } = await downloadPicked(picked, (loaded, total) => set({ downloading: { name: label, loaded, total } })));
      } catch (e) {
        set({ message: `Couldn't open “${label}” from Google Drive: ${errorText(e)}`, messageWarn: true });
        return;
      } finally {
        set({ busy: '', downloading: null });
      }
      const cantOpen = skipped.length ? `Cloud Slicer can't open ${skipped.map((n) => `“${n}”`).join(', ')}.` : '';
      if (!files.length) return set({ message: cantOpen, messageWarn: true });
      // A 3MF replaces the open project: ask first, as Open from this device does.
      if (mode === 'project' && files.some((f) => /\.3mf$/i.test(f.name)) && !(await get().leaveOk())) return;
      const before = get().current;
      await get().openFiles(files, mode);
      const cur = get().current;
      // Nothing opened (cancelled, or an error the open already showed).
      if (cur === before || !hasObjects()) return;
      if (cantOpen) return set({ message: cantOpen, messageWarn: true });
      if (cur.id) return;
      const name = files.length === 1 ? files[0].name : `${files.length} files`;
      set({
        current: { ...cur, fromDrive: name },
        message:
          files.length === 1
            ? `Opened “${name}” from your Google Drive. Save keeps a copy in your Cloud Slicer folder. The file in Drive stays as it is.`
            : `Opened ${name} from your Google Drive. Save keeps a copy in your Cloud Slicer folder. The files in Drive stay as they are.`,
        messageWarn: false,
      });
    },

    async openOnline(p) {
      offerSettled = true;
      set({ busy: `Opening “${p.name}”…`, message: '', listOpen: false, offer: null });
      try {
        // The list keeps each project's size, so the bar fills from the start.
        set({ downloading: { name: p.name, loaded: 0, total: p.size || 0 } });
        // This device edits it from now on; another device that had it open only views it.
        await api.takeOverProject(p.id, thisDevice()).catch(() => {});
        // Straight from their Google Drive, with the latest list entry (its file and version).
        const latest = await api.project(p.id).catch(() => p);
        const bytes = await downloadFromDrive(
          latest.driveFile,
          (loaded, total) => set({ downloading: { name: p.name, loaded, total } }),
          latest.size || p.size,
        );
        const version = latest.version;
        set({ downloading: null });
        if (await useEngineOf(p.engine ?? 'snapmaker')) switchedNotice(p.engine);
        if ((await useSlicer.getState().openFiles([new File([bytes], projectFileName(p.name), { type: 'model/3mf' })], 'project')) === 'cancelled') {
          set({ current: blank(), elsewhere: null, conflict: null });
          markClean();
          return;
        }
        set({ current: { name: p.name, id: p.id, version: version || p.version }, elsewhere: null, conflict: null });
        markClean();
      } catch (e) {
        // Deleted in Drive: the Online projects window offers to remove it from the list.
        if (driveGone(e)) set({ gone: p });
        else set({ message: `Couldn't open “${p.name}”: ${errorText(e)}`, messageWarn: true });
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

    async newProject(engine = defaultEngine()) {
      if (engine !== useSlicer.getState().flavor) await useSlicer.getState().switchEngine(engine);
      else await useSlicer.getState().clearProject();
      set({ current: blank(), message: '', elsewhere: null, conflict: null });
      markClean();
    },

    async switchEngine(engine) {
      await useSlicer.getState().switchProject(engine);
      // The engine is part of the project: saving it again records the new one.
      if (useSlicer.getState().flavor === engine && useSlicer.getState().project?.objects.length) {
        paintedSinceSave = true;
        set({ dirty: true });
      }
    },

    async leaveOk() {
      const { dirty, current, elsewhere } = get();
      // View only: nothing here is ours to keep (changes made here were offered as a copy).
      if (elsewhere || !hasObjects()) return true;
      if (!savesOnline()) return discardOk(dirty, current.name);
      // A new project: like Word on close.
      if (!current.id) {
        const choice = await askSave(current.name);
        if (choice === 'cancel') return false;
        if (choice === 'discard') return true;
        let ok = false;
        await queue(async () => {
          ok = await upload({ name: freeName(current.name === UNTITLED ? 'My project' : current.name, await takenNames(null)), id: null, version: 0 }, 0);
        });
        return ok;
      }
      if (!dirty) return true;
      return discardOk(dirty, current.name);
    },

    async editHere() {
      const e = get().elsewhere;
      if (!e) return;
      let latest = e.project;
      try {
        latest = await api.project(e.project.id);
      } catch (err) {
        // Deleted on the other device: there is nothing to load, so keep what is here.
        if (err instanceof ApiError && err.status === 404) return keepGone(e.project.deviceName);
      }
      await get().openOnline(latest);
    },

    async keepMineAsCopy() {
      const e = get().elsewhere;
      if (!e) return;
      const cur = get().current;
      const taken = await api.projects().then((l) => l.projects.map((p) => p.name)).catch(() => [cur.name]);
      set({ elsewhere: null });
      await queue(async () => {
        if (await upload({ name: copyName(cur.name, taken), id: null, version: 0 }, 0)) await copyHistory(cur.id);
        else set({ elsewhere: e });
      });
    },

    async findOffer() {
      if (offerSettled) return set({ offerChecked: true });
      const offer = await offerNow().catch(() => null);
      // Startup asks more than once (engine ready, signed in): an answer that comes
      // back after the card was answered or a project opened is dropped.
      if (offerSettled || get().busy || get().offer) return set({ offerChecked: true });
      // "Not now" holds until that project changes again.
      if (offer && untouchedProject() && offerKey(offer) !== readDismissed()) set({ offer, offerChecked: true });
      else set({ offerChecked: true });
    },

    async acceptOffer() {
      const offer = get().offer;
      offerSettled = true;
      if (offer?.kind === 'local') await openLocal(offer.copy);
      else if (offer) await get().openOnline(offer.project);
    },

    async dismissOffer(discard) {
      const offer = get().offer;
      offerSettled = true;
      set({ offer: null });
      if (offer?.kind === 'local') return void (await clearLocalCopy());
      if (offer && !discard) writeDismissed(offerKey(offer));
    },

    async removeGone() {
      const p = get().gone;
      if (!p) return;
      // Delete first: closing the popup reloads the open list, which must not race the delete.
      await api.deleteProject(p.id).catch(() => {});
      set({ gone: null });
      get().onlineChanged({ id: p.id, deleted: true });
      set({ message: `Removed “${p.name}” from your projects`, messageWarn: false });
    },

    setListOpen: (listOpen) => set({ listOpen }),
    setSaveAsOpen: (saveAsOpen) => set({ saveAsOpen }),
    clearMessage: () => set({ message: '' }),
  };
});

// ---- the Continue card ---------------------------------------------------------------

/** The card is offered once a visit: true once it was answered or a project was opened. */
let offerSettled = false;

/** What the Continue card would offer now: work kept in this browser first, then the account's (null: busy with a project). */
async function offerNow(): Promise<ContinueOffer | null> {
  if (!untouchedProject()) return null;
  const copy = await loadLocalCopy();
  if (copy && untouchedProject()) return { kind: 'local', copy };
  return onlineOfferNow();
}

/** A project from the account (null when signed out, busy with a project, or offline). */
async function onlineOfferNow(): Promise<OnlineOffer | null> {
  if (!signedIn() || !untouchedProject()) return null;
  try {
    return continueOffer((await api.projects()).projects, deviceId(), Date.now(), loadOpenProject());
  } catch {
    return null;
  }
}
// The saved project open here is remembered, so a reload offers it again; a new
// project, a file opened from the device or a deleted project forgets it.
useProjects.subscribe((p, prev) => {
  if (p.current !== prev.current) saveOpenProject(p.current.id);
});
const DISMISSED_KEY = 'cloud-slicer:continue-dismissed:v1';
const offerKey = (o: ContinueOffer) => (o.kind === 'local' ? `local:${o.copy.savedAt}` : `${o.project.id}:${o.project.version}`);
function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}
function writeDismissed(key: string) {
  try {
    localStorage.setItem(DISMISSED_KEY, key);
  } catch {
    // only this visit forgets it
  }
}

// ---- the questions asked before leaving a project ---------------------------------
// Set by the dialogs (components/AskDialog.tsx) so this file stays free of React.
let discardOk: (dirty: boolean, name: string) => Promise<boolean> = async () => true;
let askSave: (name: string) => Promise<'save' | 'discard' | 'cancel'> = async () => 'discard';
let askAddTo: (what: string, project: string) => Promise<'add' | 'new' | 'cancel'> = async () => 'new';
export function setLeaveQuestions(q: { discardOk: typeof discardOk; askSave: typeof askSave; askAddTo: typeof askAddTo }) {
  discardOk = q.discardOk;
  askSave = q.askSave;
  askAddTo = q.askAddTo;
}

// ---- files shared to the app (Android's Share menu) -------------------------------

const accountKnown = () =>
  new Promise<void>((resolve) => {
    if (useAccount.getState().status !== 'loading') return resolve();
    const stop = useAccount.subscribe((a) => {
      if (a.status === 'loading') return;
      stop();
      resolve();
    });
    setTimeout(() => {
      stop();
      resolve();
    }, 15_000);
  });

// The page was opened by sharing files to it: add them to the project open here
// before or changed on another device, or start a new project with them.
async function openShared() {
  const { open, skipped } = splitShared(await takeSharedFiles());
  if (skipped.length) useProjects.setState({ message: `Cloud Slicer can't open ${skipped.join(', ')}`, messageWarn: true });
  await accountKnown();
  if (!open.length) return void useProjects.getState().findOffer();
  // The question replaces the Continue card: it isn't shown as well.
  try {
    const offer = await onlineOfferNow();
    if (offer) {
      const choice = await askAddTo(open.length === 1 ? open[0].name : `${open.length} files`, offer.project.name);
      if (choice === 'cancel') return;
      if (choice === 'add') await useProjects.getState().openOnline(offer.project);
    }
    await useProjects.getState().openFiles(open);
  } finally {
    useProjects.setState({ offerChecked: true });
  }
}

// ---- AutoSave: unsaved work kept in this browser ---------------------------------------
// Always, signed in or not: lib/local-copy.ts. Never uploaded; dropped once the
// work is saved.

let localTimer: ReturnType<typeof setTimeout> | undefined;
let lastLocal = 0;
let localSize = 0;
// One write at a time, so a drop never runs before an older write.
let localQueue: Promise<void> = Promise.resolve();
const inLocalQueue = (fn: () => Promise<void>) => (localQueue = localQueue.then(fn, fn));

// Not while slicing or opening: the engine does one thing at a time, and
// writing a big project's 3MF takes it many seconds, which the slice (or the
// opening) would wait behind. It is kept once that is done.
const engineBusy = (kind: string) => kind === 'slicing' || kind === 'loading';

function localWanted() {
  const p = useProjects.getState();
  const s = useSlicer.getState();
  return p.dirty && hasObjects() && !p.busy && !p.elsewhere && s.engine === 'ready' && !engineBusy(s.job.kind);
}

async function keepLocal() {
  localTimer = undefined;
  await inLocalQueue(async () => {
    if (!localWanted()) return;
    try {
      const started = lastChange;
      const bytes = await useSlicer.getState().projectFile(null);
      // Saved while the file was being made: nothing to keep.
      if (!useProjects.getState().dirty) return;
      const cur = useProjects.getState().current;
      const file = new Blob([bytes], { type: 'model/3mf' });
      if (!(await saveLocalCopy({ file, picture: null, name: cur.name, id: cur.id, version: cur.version, engine: useSlicer.getState().flavor, savedAt: Date.now() }))) return;
      lastLocal = Date.now();
      localSize = file.size;
      // Kept here, unless it changed again while the file was being made (the next keep covers that).
      if (lastChange === started && useProjects.getState().dirty) useProjects.setState({ keptHere: true });
    } catch (e) {
      console.warn('Unsaved work not kept in this browser:', e);
    }
  });
  scheduleLocal();
}

function scheduleLocal() {
  if (localTimer) clearTimeout(localTimer);
  localTimer = undefined;
  if (!localWanted()) return;
  localTimer = setTimeout(() => void keepLocal(), autosaveDelay(Date.now(), lastChange, lastLocal, localSize));
}

function dropLocal() {
  if (localTimer) clearTimeout(localTimer);
  localTimer = undefined;
  void inLocalQueue(clearLocalCopy);
}

/** Leaving the tab: keep what is waiting now. */
function flushLocal() {
  if (!localTimer) return;
  clearTimeout(localTimer);
  void keepLocal();
}

// Another device took the project over? Asked when the tab comes back into view.
let lastCheck = 0;
async function checkElsewhere() {
  const p = useProjects.getState();
  const id = p.current.id;
  if (!id || p.elsewhere || !signedIn() || Date.now() - lastCheck < 10_000) return;
  lastCheck = Date.now();
  try {
    const online = await api.project(id);
    if (online.device && online.device !== deviceId() && useProjects.getState().current.id === id) {
      useProjects.setState({ elsewhere: { project: online, unsaved: useProjects.getState().dirty } });
    }
  } catch {
    // Offline, or the project was deleted: the next save says so.
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushLocal();
    else void checkElsewhere();
  });
  window.addEventListener('focus', () => void checkElsewhere());
}

// Unsaved changes: anything a save keeps, or paint (which the signature can't see).
// An empty plate never counts as unsaved.
useSlicer.subscribe((s, prev) => {
  // A slice or an opening done: AutoSave can go ahead.
  if (engineBusy(prev.job.kind) && !engineBusy(s.job.kind)) scheduleLocal();
  const same = s.project === prev.project && s.selection === prev.selection && s.overrides === prev.overrides && s.mixDefinitions === prev.mixDefinitions;
  if (same && s.preview === prev.preview && s.overlay === prev.overlay) return;
  const painted = Boolean(s.paint && ((s.preview !== prev.preview && prev.preview) || (s.overlay !== prev.overlay && prev.overlay)));
  if (painted) {
    paintedSinceSave = true;
    paintCount++;
  }
  const dirty = Boolean(s.project?.objects.length) && (paintedSinceSave || signature() !== savedSignature);
  // A new preview after a slice isn't a change to keep.
  if (dirty && (!same || painted)) {
    // A new change isn't kept here yet.
    lastChange = Date.now();
    useProjects.setState({ dirty, keptHere: false });
    scheduleLocal();
  } else if (useProjects.getState().dirty) useProjects.setState({ dirty, keptHere: false });
});
// A fresh page starts clean once the engine has its presets and selection, and
// offers to continue unsaved work or a project from before.
useSlicer.subscribe((s, prev) => {
  if (s.engine === 'ready' && prev.engine !== 'ready') {
    markClean();
    if (sharedOnLoad()) void openShared();
    else void useProjects.getState().findOffer();
  }
});
// AutoSave starts again when what held it back clears (a save done, view only ended...).
useProjects.subscribe((p, prev) => {
  // Saved (or back as it was saved): the copy kept here isn't needed.
  if (prev.dirty && !p.dirty) dropLocal();
  else if (p.dirty !== prev.dirty || p.elsewhere !== prev.elsewhere || p.busy !== prev.busy) scheduleLocal();
  // A project taken over elsewhere: nothing stays selected to edit.
  if (p.elsewhere && !prev.elsewhere) useSlicer.getState().select(null);
});

// The default engine reaches this browser's memory, so the next page starts it
// right away; and a page still on its first, empty project switches to it once
// the account says what it is.
useAccount.subscribe((a, prev) => {
  if (a.status !== prev.status && a.status === 'signedIn' && !sharedOnLoad()) {
    useProjects.setState({ offerChecked: false });
    void useProjects.getState().findOffer();
  }
  if (a.settings === prev.settings) return;
  const engine = defaultEngine();
  saveDefaultEngine(engine);
  const s = useSlicer.getState();
  if (engine !== s.flavor && untouchedProject() && s.engine === 'ready' && !engineFromUrl()) void s.switchEngine(engine);
});

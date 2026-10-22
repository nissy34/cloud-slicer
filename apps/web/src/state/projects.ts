// The open project as a document: its name, where it is saved, whether it has
// unsaved changes, and saving / opening it.
//
// A project is saved as Orca's own 3MF (the engine's store_bbs_3mf, like
// desktop's Save project). Signed in, Save keeps it in the account's online
// projects (R2 + D1, functions/_lib/projects.ts); signed out, Save downloads
// the file. Download 3MF always downloads.
//
// AutoSave, like Word (signed in, switch on by default): a new project is kept
// as the person's one draft until the first Save names it; after that every
// change saves into the project a few seconds later (lib/autosave.ts has the
// timing). One device edits a project at a time: opening it elsewhere takes it
// over, and this tab then only views it (`elsewhere`) until "Edit here instead".
import { create } from 'zustand';
import { api, ApiError, type OnlineProject } from '../account/api';
import { autosaveDelay, continueOffer, deviceNameFrom, THUMBNAIL_EVERY_MS, type ContinueOffer } from '../lib/autosave';
import { copyName, freeName, nameFromFile, newProjectId, projectFileName, projectSignature, UNTITLED } from '../lib/projects';
import { engineFromUrl, engineName, engineOf3mf, type EngineFlavor } from '../lib/engines';
import { SETUP_KEY, type Setup } from '../lib/setup';
import { sharedOnLoad, splitShared, takeSharedFiles } from '../lib/share-target';
import { snapshot } from '../lib/snapshot';
import { deviceId, saveDefaultEngine } from '../lib/storage';
import { getUserSetting, saveUserSetting, useAccount } from './account';
import { useSlicer, type OpenMode } from './store';

export interface CurrentProject {
  name: string;
  /** Online project id, or null when it isn't saved online. */
  id: string | null;
  /** Online version this copy started from (0 when not online). */
  version: number;
  /** The person's unsaved draft (online, but not named and saved yet). */
  draft: boolean;
}

/** What AutoSave is doing, shown next to the project name. */
export type SaveState = 'idle' | 'saving' | 'offline' | 'failed';

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
  /** A project from the account being downloaded: bytes so far, of `total` (0 when unknown). */
  downloading: { name: string; loaded: number; total: number } | null;
  /** The last problem or result, shown under the project menu. */
  message: string;
  messageWarn: boolean;
  /** A save found a newer version saved from another device. */
  conflict: { theirs: OnlineProject | null } | null;
  /** The Projects list is open. */
  listOpen: boolean;
  /** Save is asking for a name: 'name' names the open project, 'copy' saves a copy. */
  saveAsOpen: false | 'name' | 'copy';
  /** AutoSave's state (signed in). */
  saveState: SaveState;
  /** Why AutoSave stopped for this project (too big, storage full...), or ''. */
  autosaveStopped: string;
  elsewhere: Elsewhere | null;
  /** The Continue card: a draft or a project changed on another device. */
  offer: ContinueOffer | null;
  /** The first look for a Continue card is done (the setup wizard waits for it). */
  offerChecked: boolean;

  /** Online when signed in (and the site has project storage), else a download. */
  canSaveOnline(): boolean;
  /** AutoSave's switch (an account setting, on unless turned off). */
  autosaveOn(): boolean;
  setAutosave(on: boolean): Promise<void>;
  /** Ctrl+S: names a new project or draft, else saves now. Signed out: downloads. */
  save(): Promise<void>;
  /** Names the open project (mode 'name') or saves a copy and continues in it ('copy'). */
  saveAs(name: string): Promise<void>;
  download(): Promise<void>;
  resolveConflict(choice: 'overwrite' | 'copy' | 'cancel'): Promise<void>;
  /** Adds model files, or opens a 3MF as the project (see the slicer store's openFiles). */
  openFiles(files: File[], mode?: OpenMode): Promise<void>;
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
  /** Looks for a draft or a project changed on another device (the Continue card). */
  findOffer(): Promise<void>;
  acceptOffer(): Promise<void>;
  /** "Not now", or "Discard" for a draft (deletes it). */
  dismissOffer(discard: boolean): Promise<void>;
  setListOpen(open: boolean): void;
  setSaveAsOpen(open: false | 'name' | 'copy'): void;
  clearMessage(): void;
}

const blank = (): CurrentProject => ({ name: UNTITLED, id: null, version: 0, draft: false });

/** Still the page's first project: nothing on the plate, never named or saved. */
export function untouchedProject(): boolean {
  const p = useProjects.getState().current;
  return !useSlicer.getState().project?.objects.length && p.name === UNTITLED && !p.id;
}

/** The engine new projects use: the setup wizard's choice, else Snapmaker Orca. */
export const defaultEngine = (): EngineFlavor => getUserSetting<Setup>(SETUP_KEY)?.engine ?? 'snapmaker';

export const AUTOSAVE_KEY = 'autosave';

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
  useProjects.setState({ dirty: false });
}
// After a save of what the project was when it started (`sig`, `paints`): clean
// unless it changed while the file was being made and sent.
function markSaved(sig: string, paints: number) {
  savedSignature = sig;
  paintedSinceSave = paintCount !== paints;
  const dirty = paintedSinceSave || signature() !== sig;
  useProjects.setState({ dirty });
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
const hasObjects = () => Boolean(useSlicer.getState().project?.objects.length);
const signedIn = () => useAccount.getState().status === 'signedIn';

// AutoSave's clock: the last change, the last save and its size, the last thumbnail.
let lastChange = 0;
let lastSave = 0;
let lastSize = 0;
let lastThumbnail = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
// One save at a time; a save asked for meanwhile runs after it.
let saving: Promise<void> = Promise.resolve();
const queue = (fn: () => Promise<void>) => (saving = saving.then(fn, fn));
// AutoSave's way into the store's upload (set when the store is made).
let uploadFromOutside: (target: CurrentProject, base: number) => Promise<boolean> = async () => false;

export const useProjects = create<ProjectsState>((set, get) => {
  interface UploadOptions {
    /** AutoSave: no toast, no busy text, problems shown next to the name. */
    auto?: boolean;
    /** Send the thumbnail too (always on a Save; AutoSave every few minutes). */
    thumbnail?: boolean;
  }

  // Saves online as `target`. baseVersion undefined overwrites what is there. True when saved.
  async function upload(target: CurrentProject, baseVersion: number | undefined, opts: UploadOptions = {}): Promise<boolean> {
    const auto = Boolean(opts.auto);
    if (auto) set({ saveState: 'saving' });
    else set({ busy: 'Saving…', message: '' });
    const sig = signature();
    const paints = paintCount;
    try {
      const { file, png } = await buildFile();
      const id = target.id ?? newProjectId();
      const saved = await api.saveProject(id, target.name, file, baseVersion, useSlicer.getState().flavor, { draft: target.draft, device: thisDevice() });
      lastSave = Date.now();
      lastSize = file.size;
      // The project is saved even if its picture isn't.
      if (png && (opts.thumbnail || !auto || lastSave - lastThumbnail > THUMBNAIL_EVERY_MS)) {
        lastThumbnail = lastSave;
        await api.saveProjectThumbnail(id, png).catch(() => {});
      }
      set({ current: { name: saved.name, id: saved.id, version: saved.version, draft: saved.draft }, conflict: null, saveState: 'idle' });
      if (!auto) set({ message: `Saved “${saved.name}” to your projects`, messageWarn: false });
      markSaved(sig, paints);
      return true;
    } catch (e) {
      const code = e instanceof ApiError ? (e.body.code as string | undefined) : undefined;
      if (e instanceof ApiError && e.status === 409 && code === 'elsewhere') {
        set({ elsewhere: { project: e.body.current as OnlineProject, unsaved: get().dirty }, saveState: 'idle' });
        return false;
      }
      if (e instanceof ApiError && e.status === 409) {
        set({ conflict: { theirs: (e.body.current as OnlineProject | null) ?? null }, saveState: 'idle' });
        return false;
      }
      if (!(e instanceof ApiError) && auto) {
        // No connection: try again in a while.
        set({ saveState: 'offline' });
        return false;
      }
      if (auto) set({ saveState: 'failed', autosaveStopped: `Not saved: ${errorText(e)}` });
      else set({ message: `Not saved: ${errorText(e)}`, messageWarn: true });
      return false;
    } finally {
      if (!auto) set({ busy: '' });
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

  // The open project as a named project: a draft keeps its id, anything else is new.
  const named = (name: string): CurrentProject => {
    const cur = get().current;
    return cur.draft ? { ...cur, name, draft: false } : { name, id: null, version: 0, draft: false };
  };

  const dropDraft = async (p: Pick<CurrentProject, 'id' | 'draft'>) => {
    if (p.draft && p.id) await api.deleteProject(p.id).catch(() => {});
  };

  uploadFromOutside = (target, base) => upload(target, base, { auto: true });

  /** Names other saved projects have, so a new save doesn't repeat one (`except`: the open project's own id). */
  const takenNames = (except: string | null) =>
    api
      .projects()
      .then((l) => l.projects.filter((p) => p.id !== except && !p.draft).map((p) => p.name))
      .catch(() => [] as string[]);

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
    saveState: 'idle',
    autosaveStopped: '',
    elsewhere: null,
    offer: null,
    offerChecked: false,

    canSaveOnline: () => signedIn(),
    autosaveOn: () => getUserSetting<boolean>(AUTOSAVE_KEY) !== false,

    async setAutosave(on) {
      await saveUserSetting(AUTOSAVE_KEY, on);
      scheduleAutosave();
    },

    async save() {
      if (get().busy) return;
      const cur = get().current;
      if (!get().canSaveOnline()) {
        if (await downloadAs(cur.name)) {
          set({ current: { ...cur, id: null, version: 0, draft: false } });
          markClean();
        }
        return;
      }
      if (get().elsewhere) return;
      // Like Word: the first Save names the project.
      if (!cur.id || cur.draft) return set({ saveAsOpen: 'name' });
      await queue(async () => {
        const now = get().current;
        await upload(now, now.version, { thumbnail: true });
      });
    },

    async saveAs(name) {
      const mode = get().saveAsOpen || 'copy';
      set({ saveAsOpen: false });
      const clean = name.trim() || UNTITLED;
      if (!get().canSaveOnline()) {
        if (await downloadAs(clean)) {
          set({ current: { name: clean, id: null, version: 0, draft: false } });
          markClean();
        }
        return;
      }
      await queue(async () => {
        if (mode === 'name') {
          const target = named(freeName(clean, await takenNames(get().current.id)));
          await upload(target, target.id ? get().current.version : 0, { thumbnail: true });
        } else {
          const from = get().current;
          if (await upload({ name: freeName(clean, await takenNames(null)), id: null, version: 0, draft: false }, 0, { thumbnail: true })) await dropDraft(from);
        }
      });
    },

    download: async () => void (await downloadAs(get().current.name)),

    async resolveConflict(choice) {
      const cur = get().current;
      const theirs = get().conflict?.theirs;
      set({ conflict: null });
      await queue(async () => {
        if (choice === 'overwrite') await upload(cur, undefined);
        if (choice === 'copy') {
          const taken = await api.projects().then((l) => l.projects.map((p) => p.name)).catch(() => [theirs?.name ?? cur.name]);
          await upload({ name: copyName(cur.name, taken), id: null, version: 0, draft: false }, 0);
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
      if (await useSlicer.getState().openFiles(files, mode)) {
        offerSettled = true;
        set({ current: { name: nameFromFile(project!.name), id: null, version: 0, draft: false }, elsewhere: null, offer: null });
        markClean();
        // Not saved anywhere yet: AutoSave keeps it as the draft.
        paintedSinceSave = true;
        set({ dirty: true });
        if (switched) switchedNotice(switched);
      } else if (wasEmpty && files.length && get().current.name === UNTITLED && !get().current.id) {
        // Like desktop: a new project is named after its first model.
        offerSettled = true;
        set({ current: { name: nameFromFile(files[0].name), id: null, version: 0, draft: false }, offer: null });
      }
    },

    async openOnline(p) {
      offerSettled = true;
      set({ busy: `Opening “${p.name}”…`, message: '', listOpen: false, offer: null });
      try {
        set({ downloading: { name: p.name, loaded: 0, total: 0 } });
        // This device edits it from now on; another device that had it open only views it.
        await api.takeOverProject(p.id, thisDevice()).catch(() => {});
        const { bytes, version } = await api.projectFile(p.id, (loaded, total) => set({ downloading: { name: p.name, loaded, total } }));
        set({ downloading: null });
        if (await useEngineOf(p.engine ?? 'snapmaker')) switchedNotice(p.engine);
        await useSlicer.getState().openFiles([new File([bytes], projectFileName(p.name), { type: 'model/3mf' })], 'project');
        set({ current: { name: p.name, id: p.id, version: version || p.version, draft: p.draft }, elsewhere: null, conflict: null, autosaveStopped: '', saveState: 'idle' });
        lastSize = bytes.byteLength;
        lastSave = Date.now();
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
      if ('deleted' in p) set({ current: { ...cur, id: null, version: 0, draft: false }, dirty: true });
      else set({ current: { ...cur, name: p.name, version: p.version } });
    },

    async newProject(engine = defaultEngine()) {
      const was = get().current;
      if (engine !== useSlicer.getState().flavor) await useSlicer.getState().switchEngine(engine);
      else await useSlicer.getState().clearProject();
      set({ current: blank(), message: '', elsewhere: null, conflict: null, autosaveStopped: '', saveState: 'idle' });
      markClean();
      // The draft was what was just cleared away.
      await dropDraft(was);
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
      if (!signedIn()) return discardOk(dirty, current.name);
      // A new project or the draft: like Word on close.
      if (!current.id || current.draft) {
        const choice = await askSave(current.name);
        if (choice === 'cancel') return false;
        if (choice === 'discard') {
          await dropDraft(current);
          return true;
        }
        let ok = false;
        await queue(async () => {
          const target = named(freeName(current.name === UNTITLED ? 'My project' : current.name, await takenNames(current.id)));
          ok = await upload(target, target.id ? get().current.version : 0, { thumbnail: true });
        });
        return ok;
      }
      if (!dirty) return true;
      if (get().autosaveOn() && !get().autosaveStopped) {
        await flushAutosave();
        if (!get().dirty) return true;
      }
      return discardOk(get().dirty, current.name);
    },

    async editHere() {
      const e = get().elsewhere;
      if (!e) return;
      const latest = await api.project(e.project.id).catch(() => e.project);
      await get().openOnline(latest);
    },

    async keepMineAsCopy() {
      const e = get().elsewhere;
      if (!e) return;
      const cur = get().current;
      const taken = await api.projects().then((l) => l.projects.map((p) => p.name)).catch(() => [cur.name]);
      set({ elsewhere: null });
      await queue(async () => {
        if (!(await upload({ name: copyName(cur.name, taken), id: null, version: 0, draft: false }, 0, { thumbnail: true }))) set({ elsewhere: e });
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
      if (offer) await get().openOnline(offer.project);
    },

    async dismissOffer(discard) {
      const offer = get().offer;
      offerSettled = true;
      set({ offer: null });
      if (offer && !discard) writeDismissed(offerKey(offer));
      if (discard && offer?.kind === 'draft') await api.deleteProject(offer.project.id).catch(() => {});
    },

    setListOpen: (listOpen) => set({ listOpen }),
    setSaveAsOpen: (saveAsOpen) => set({ saveAsOpen }),
    clearMessage: () => set({ message: '' }),
  };
});

// ---- the Continue card ---------------------------------------------------------------

/** The card is offered once a visit: true once it was answered or a project was opened. */
let offerSettled = false;

/** What the Continue card would offer now (null when signed out, busy with a project, or offline). */
async function offerNow(): Promise<ContinueOffer | null> {
  if (!signedIn() || !untouchedProject()) return null;
  try {
    return continueOffer((await api.projects()).projects, deviceId());
  } catch {
    return null;
  }
}
const DISMISSED_KEY = 'cloud-slicer:continue-dismissed:v1';
const offerKey = (o: ContinueOffer) => `${o.project.id}:${o.project.version}`;
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

// The page was opened by sharing files to it: add them to the draft or the
// project from another device, or start a new project with them.
async function openShared() {
  const { open, skipped } = splitShared(await takeSharedFiles());
  if (skipped.length) useProjects.setState({ message: `Cloud Slicer can't open ${skipped.join(', ')}`, messageWarn: true });
  await accountKnown();
  if (!open.length) return void useProjects.getState().findOffer();
  // The question replaces the Continue card: it isn't shown as well.
  try {
    const offer = await offerNow();
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

// ---- AutoSave ----------------------------------------------------------------------

function autosaveWanted() {
  const p = useProjects.getState();
  return (
    signedIn() &&
    p.autosaveOn() &&
    !p.autosaveStopped &&
    !p.elsewhere &&
    !p.conflict &&
    !p.busy &&
    p.dirty &&
    hasObjects() &&
    useSlicer.getState().engine === 'ready'
  );
}

async function autosave() {
  timer = undefined;
  await queue(async () => {
    if (!autosaveWanted()) return;
    const p = useProjects.getState();
    const cur = p.current;
    // A new project goes online as the draft.
    const target = cur.id ? cur : { ...cur, draft: true };
    const ok = await uploadFromOutside(target, cur.id ? cur.version : 0);
    // No connection: try again later.
    if (!ok && useProjects.getState().saveState === 'offline') timer = setTimeout(() => void autosave(), 30_000);
  });
  scheduleAutosave();
}

function scheduleAutosave() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!autosaveWanted()) return;
  timer = setTimeout(() => void autosave(), autosaveDelay(Date.now(), lastChange, lastSave, lastSize));
}

/** Saves now if AutoSave has something waiting (leaving the project or the tab). */
async function flushAutosave() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (autosaveWanted()) await autosave();
  else await saving;
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
    // offline or deleted: the next save says so
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAutosave();
    else void checkElsewhere();
  });
  window.addEventListener('focus', () => void checkElsewhere());
  window.addEventListener('online', () => {
    if (useProjects.getState().saveState === 'offline') scheduleAutosave();
  });
}

// Unsaved changes: anything a save keeps, or paint (which the signature can't see).
// An empty plate never counts as unsaved.
useSlicer.subscribe((s, prev) => {
  const same = s.project === prev.project && s.selection === prev.selection && s.overrides === prev.overrides && s.mixDefinitions === prev.mixDefinitions;
  if (same && s.preview === prev.preview && s.overlay === prev.overlay) return;
  if (s.paint && ((s.preview !== prev.preview && prev.preview) || (s.overlay !== prev.overlay && prev.overlay))) {
    paintedSinceSave = true;
    paintCount++;
  }
  const dirty = Boolean(s.project?.objects.length) && (paintedSinceSave || signature() !== savedSignature);
  if (dirty !== useProjects.getState().dirty) useProjects.setState({ dirty });
  if (dirty) {
    lastChange = Date.now();
    scheduleAutosave();
  }
});
// A fresh page starts clean once the engine has its presets and selection, and
// offers to continue a draft or a project from another device.
useSlicer.subscribe((s, prev) => {
  if (s.engine === 'ready' && prev.engine !== 'ready') {
    markClean();
    if (sharedOnLoad()) void openShared();
    else void useProjects.getState().findOffer();
  }
});
// AutoSave starts again when what held it back clears (a conflict answered, signing in...).
useProjects.subscribe((p, prev) => {
  if (p.dirty !== prev.dirty || p.conflict !== prev.conflict || p.elsewhere !== prev.elsewhere || p.busy !== prev.busy) scheduleAutosave();
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
  scheduleAutosave();
  const engine = defaultEngine();
  saveDefaultEngine(engine);
  const s = useSlicer.getState();
  if (engine !== s.flavor && untouchedProject() && s.engine === 'ready' && !engineFromUrl()) void s.switchEngine(engine);
});

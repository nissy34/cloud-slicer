import { useCallback, useEffect, useRef, useState } from 'react';
import { api, projectThumbnailUrl, type OnlineProject, type ProjectList } from '../account/api';
import { filesInDrive } from '../account/drive';
import { useDriveOpen } from '../account/useDriveOpen';
import { engineName } from '../lib/engines';
import { copyName, findProjects, formatBytes, formatWhen, PROJECT_SORTS, UNTITLED, type ProjectSort } from '../lib/projects';
import { MODEL_EXTENSIONS } from '../lib/presets';
import { useAccount } from '../state/account';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';
import { AiAppsDialog } from './AiAppsDialog';
import { continueOffer, yourDevice } from '../lib/autosave';
import { deviceId } from '../lib/storage';
import { Note } from './Note';
import { Empty } from './Empty';
import { Menu } from './Menu';
import { Picker } from './Picker';
import { PrintLoader } from './PrintLoader';
import { SaveBar } from './SaveBar';
import { IconButton } from './IconButton';
import { FolderOpen, LoaderCircle, MoreHorizontal, Search } from 'lucide-react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

/** What is said next to the project name ('' when there is nothing to say). */
function useSaveStatus(): string {
  const online = useProjects((s) => s.current.id !== null);
  const dirty = useProjects((s) => s.dirty);
  const keptHere = useProjects((s) => s.keptHere);
  const elsewhere = useProjects((s) => s.elsewhere);
  const hasModel = useSlicer((s) => Boolean(s.project?.objects.length));
  if (!hasModel) return '';
  if (elsewhere) return 'View only';
  // AutoSave keeps unsaved changes in this browser; Save puts them online.
  if (dirty) return keptHere ? 'Saved in this browser' : 'Not saved';
  return online ? 'Saved' : '';
}

/** The top bar's Project menu (New, Open, Projects, Save, Save a copy, Download 3MF) and its dialogs. */
export function ProjectMenu() {
  const ready = useSlicer((s) => s.engine === 'ready');
  const name = useProjects((s) => s.current.name);
  const online = useProjects((s) => s.current.id !== null);
  const dirty = useProjects((s) => s.dirty);
  const busy = useProjects((s) => s.busy);
  const saving = useProjects((s) => s.saving);
  const saveCancel = useProjects((s) => s.saveCancel);
  const signedIn = useAccount((s) => s.status === 'signedIn');
  // Signed in without Google Drive: there are no online projects to show (Connect is in the account menu).
  const noDrive = useAccount((s) => s.status === 'signedIn' && (s.user?.drive !== true || s.user.projects === false));
  const projectsOff = useAccount((s) => s.user?.projects === false);
  const savesOnline = signedIn && !noDrive;
  const engineInfo = useSlicer((s) => s.engineInfo);
  const status = useSaveStatus();
  const p = useProjects.getState();
  const [open, setOpen] = useState(false);
  const [aiApps, setAiApps] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const driveOpen = useDriveOpen();

  // Ctrl+S / Ctrl+Shift+S / Ctrl+O, like desktop.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !ready) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        if (e.shiftKey) useProjects.getState().setSaveAsOpen('copy');
        else void useProjects.getState().save();
      } else if (k === 'o' && !e.shiftKey) {
        e.preventDefault();
        input.current?.click();
      }
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [ready]);

  // Leaving with unsaved changes asks first (they stay in this browser, but not online).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const run = (fn: () => unknown) => () => {
    setOpen(false);
    void fn();
  };
  const leaveOk = () => useProjects.getState().leaveOk();

  return (
    <div className="project-menu">
      <Menu
        label="Project"
        open={open}
        onOpenChange={setOpen}
        button={(props) => (
          <button
            {...props}
            className="project-button"
            disabled={!ready}
            title={status ? `${name} (${status})` : dirty ? `${name} (unsaved changes)` : name}
          >
            <span className="project-label">Project</span>
            <span className="project-name">
              <span className="project-name-text">{name}</span>
              {online && <span className="project-cloud" aria-label="saved online" title="Saved in your online projects" />}
            </span>
            {saving && <LoaderCircle className="spin project-spin" size={14} aria-label="saving" data-testid="save-spinner" />}
            {dirty && !saving && <span className="project-dirty" aria-label="unsaved changes" />}
            {status && !busy && <span className="project-status" data-testid="save-status">{status}</span>}
            {busy && <span className="project-busy">{busy}</span>}
          </button>
        )}
      >
        {/* The default engine; the sidebar's Slicer engine dropdown picks the other one. */}
        <button role="menuitem" className="menu-item" onClick={run(() => p.startNew())}>
          New project
        </button>
        <button role="menuitem" className="menu-item" onClick={run(() => input.current?.click())}>
          Open from this device…<kbd>{MOD}O</kbd>
        </button>
        <button
          role="menuitem"
          className="menu-item"
          disabled={!driveOpen.available || !!busy}
          title={driveOpen.reason || undefined}
          data-testid="open-from-drive"
          onClick={run(() => driveOpen.open('project'))}
        >
          Open from Google Drive…
        </button>
        <button role="menuitem" className="menu-item" disabled={noDrive} onClick={run(() => p.setListOpen(true))}>
          Online projects…
        </button>
        {/* Drive connected but the site lacks Google's key: say so (the other reasons share the note below). */}
        {!noDrive && signedIn && !driveOpen.available && <p className="menu-note">{driveOpen.reason}</p>}
        {noDrive && (
          <p className="menu-note" data-testid="online-projects-off">
            {projectsOff
              ? 'Online projects are turned off for your account.'
              : 'Connect Google Drive in the account menu to open files from it and keep projects online. Until then, Save downloads the 3MF.'}
          </p>
        )}
        <hr />
        {/* While a save runs its rows wait, and say why; how far it got, and Cancel. */}
        {saving && (
          <div className="menu-note menu-working" data-testid="menu-saving">
            <LoaderCircle className="spin" size={16} aria-hidden />
            <span>
              <b>{busy}</b> Save, Save a copy and Download 3MF wait until it is done.
              <SaveBar />
            </span>
          </div>
        )}
        {saving && saveCancel && (
          <button role="menuitem" className="menu-item" data-testid="menu-cancel-save" onClick={run(() => p.cancelSave())}>
            Cancel saving
          </button>
        )}
        {/* Signed out or without Drive, Save downloads the 3MF: one row for both. */}
        {savesOnline && (
          <button role="menuitem" className="menu-item" disabled={!!busy} onClick={run(() => p.save())}>
            Save
            <kbd>{MOD}S</kbd>
          </button>
        )}
        <button role="menuitem" className="menu-item" disabled={!!busy} onClick={run(() => p.setSaveAsOpen('copy'))}>
          Save a copy…
        </button>
        <button role="menuitem" className="menu-item" disabled={!!busy} onClick={run(() => (savesOnline ? p.download() : p.save()))}>
          Download 3MF
          {!savesOnline && <kbd>{MOD}S</kbd>}
        </button>
        <hr />
        {/* Also in the account menu; here too because it needs no account (signed-out people never see that menu's item). */}
        <button role="menuitem" className="menu-item" onClick={run(() => setAiApps(true))}>
          Use with an AI app…
        </button>
        {engineInfo && (
          <p className="menu-note" data-testid="project-engine">
            This project slices with {engineInfo.name} {engineInfo.version}.
          </p>
        )}
        <p className="menu-note" data-testid="autosave-note">
          {savesOnline
            ? 'AutoSave keeps your changes in this browser as you work. They go to your Google Drive when you Save.'
            : 'AutoSave keeps your changes in this browser as you work.'}
        </p>
        {!signedIn && <p className="menu-note">Sign in to keep projects online and open them on any device.</p>}
      </Menu>
      <input
        ref={input}
        type="file"
        multiple
        accept={MODEL_EXTENSIONS.join(',')}
        hidden
        data-testid="project-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          void (async () => {
            if (!files.some((f) => /\.3mf$/i.test(f.name)) || (await leaveOk())) await useProjects.getState().openFiles(files, 'project');
          })();
        }}
      />
      {aiApps && <AiAppsDialog onClose={() => setAiApps(false)} />}
      <SaveAsDialog />
      <ConflictDialog />
      <GoneDialog />
      <ProjectsDialog />
    </div>
  );
}

function SaveAsDialog() {
  const open = useProjects((s) => s.saveAsOpen);
  if (!open) return null;
  // The name box starts with the project's name when the dialog opens, and keeps what is typed after.
  const current = useProjects.getState().current.name;
  const name = current === UNTITLED ? '' : open === 'copy' ? copyName(current, []) : current;
  return <SaveAsForm copy={open === 'copy'} initial={name} />;
}

function SaveAsForm({ copy, initial }: { copy: boolean; initial: string }) {
  const signedIn = useAccount((s) => s.status === 'signedIn');
  const online = useProjects((s) => s.canSaveOnline());
  // Opened from Google Drive: the first Save says plainly that it makes a copy and leaves the Drive file alone.
  const fromDrive = useProjects((s) => (online && !copy ? s.current.fromDrive : undefined));
  const [name, setName] = useState(initial);
  const close = () => useProjects.getState().setSaveAsOpen(false);
  const trimmed = name.trim();
  return (
    <Dialog
      title={fromDrive ? 'Save a copy to Cloud Slicer' : copy ? 'Save a copy' : 'Save project'}
      testId="save-as-dialog"
      onClose={close}
      footer={
        <>
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" form="save-as-form" className="primary" disabled={!trimmed}>
            {fromDrive ? 'Save copy' : online ? 'Save' : 'Download'}
          </button>
        </>
      }
    >
      <form
        id="save-as-form"
        className="win-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) void useProjects.getState().saveAs(trimmed);
        }}
      >
        <label className="field">
          <span>Name</span>
          <input aria-label="Project name" autoFocus maxLength={128} value={name} placeholder="My project" onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="muted small" data-testid="save-as-note">
          {fromDrive ? (
            <>
              Saves a copy in the Cloud Slicer folder in your Google Drive, with its plates, settings and paint.{' '}
              {/\.\w+$/.test(fromDrive) ? (
                <>
                  Your file <b>{fromDrive}</b> in Drive is not changed.
                </>
              ) : (
                <>Your {fromDrive} in Drive are not changed.</>
              )}{' '}
              After this, Save updates the copy.
            </>
          ) : !signedIn
            ? 'Downloaded as a 3MF project file. Sign in to keep projects online.'
            : !online
              ? 'Downloaded as a 3MF project file. Connect Google Drive in the account menu to keep projects online.'
            : copy
              ? 'Saved as a new project in your online projects, with its plates, settings and paint. You carry on in the copy.'
              : 'Kept in your online projects with its plates, settings and paint. After this, Save puts your changes there.'}
        </p>
      </form>
    </Dialog>
  );
}

function ConflictDialog() {
  const conflict = useProjects((s) => s.conflict);
  const name = useProjects((s) => s.current.name);
  if (!conflict) return null;
  const { resolveConflict } = useProjects.getState();
  const when = conflict.theirs ? formatWhen(conflict.theirs.updatedAt) : null;
  return (
    <Dialog
      title={conflict.inDrive ? 'Changed in your Google Drive' : 'Saved on another device'}
      role="alertdialog"
      onClose={() => void resolveConflict('cancel')}
      footer={
        <>
          <button className="secondary" onClick={() => void resolveConflict('cancel')}>
            Cancel
          </button>
          <button className="secondary" onClick={() => void resolveConflict('copy')}>
            Save as a copy
          </button>
          <button className="primary" onClick={() => void resolveConflict('overwrite')}>
            Overwrite
          </button>
        </>
      }
    >
      <p>
        {conflict.inDrive
          ? `“${name}” was changed in your Google Drive (by another app, say) after you opened it here.`
          : conflict.theirs
          ? `“${conflict.theirs.name}” was saved again ${when}, after you opened it here.`
          : `“${name}” was deleted from your online projects after you opened it here.`}{' '}
        Overwrite it with this version, or keep both?
      </p>
    </Dialog>
  );
}

/** A project whose file was deleted in Google Drive: remove it from the list too? */
function GoneDialog() {
  const gone = useProjects((s) => s.gone);
  if (!gone) return null;
  const { removeGone } = useProjects.getState();
  const close = () => useProjects.setState({ gone: null });
  return (
    <Dialog
      title="Not in your Google Drive"
      role="alertdialog"
      testId="project-gone"
      onClose={close}
      footer={
        <>
          <button className="secondary" onClick={close}>
            Keep in the list
          </button>
          <button className="primary" onClick={() => void removeGone()}>
            Remove
          </button>
        </>
      }
    >
      <p>“{gone.name}” is no longer in your Google Drive. It was deleted there, or is in Drive’s bin. Remove it from your projects?</p>
    </Dialog>
  );
}

const SORT_KEY = 'cloud-slicer:projects-sort:v1';
const VIEW_KEY = 'cloud-slicer:projects-view:v1';
type ProjectView = 'cards' | 'list';

/** A choice of this window kept in this browser (Sort, Cards or List); the default without storage. */
function useRemembered<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key) as T | null;
      return v && allowed.includes(v) ? v : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // storage unavailable: remembered until the window closes
    }
  };
  return [value, set];
}

function ProjectsDialog() {
  const open = useProjects((s) => s.listOpen);
  const status = useAccount((s) => s.status);
  const currentId = useProjects((s) => s.current.id);
  const [list, setList] = useState<ProjectList | null>(null);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState<OnlineProject | null>(null);
  const [deleting, setDeleting] = useState<OnlineProject | null>(null);
  // The project being opened while the open one is saved or asked about first.
  const [opening, setOpening] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useRemembered<ProjectSort>(SORT_KEY, PROJECT_SORTS.map((s) => s.value), 'newest');
  const [view, setView] = useRemembered<ProjectView>(VIEW_KEY, ['cards', 'list'], 'cards');

  // Projects whose file was deleted in Google Drive (null until Drive answers).
  const [inDrive, setInDrive] = useState<Set<string> | null>(null);
  const load = () =>
    api
      .projects()
      .then((l) => {
        setList(l);
        setError('');
        // One Google call for the whole list: which files are still in their Drive.
        if (l.drive?.connected) void filesInDrive().then(setInDrive, () => setInDrive(null));
      })
      .catch((e: Error) => setError(e.message));
  // A project removed from the "not in your Google Drive" popup leaves the list.
  const gone = useProjects((s) => s.gone);
  const wasGone = useRef(gone);
  useEffect(() => {
    if (open && wasGone.current && !gone) void load();
    wasGone.current = gone;
  }, [gone]);
  useEffect(() => {
    if (open && status === 'signedIn') void load();
    if (!open) {
      setRenaming(null);
      setDeleting(null);
      setOpening(null);
      setSearch('');
    }
  }, [open, status]);
  const close = useCallback(() => useProjects.getState().setListOpen(false), []);
  if (!open) return null;
  const p = useProjects.getState();

  const missing = (proj: OnlineProject) => !proj.driveFile || (inDrive !== null && !inDrive.has(proj.driveFile));
  const openProject = async (proj: OnlineProject) => {
    if (opening) return;
    if (missing(proj)) return useProjects.setState({ gone: proj });
    setOpening(proj.id);
    try {
      if (!(await useProjects.getState().leaveOk())) return;
      void p.openOnline(proj);
    } finally {
      setOpening(null);
    }
  };
  const saved = list?.projects ?? [];
  const shown = findProjects(saved, search, sort);

  const actions = (proj: OnlineProject) => (
    <Menu
      label={`${proj.name} menu`}
      placement="bottom-end"
      button={(props) => <IconButton {...props} icon={MoreHorizontal} label="More" aria-label={`More for ${proj.name}`} className="project-more" disabled={!!opening} />}
    >
      {(closeMenu) => (
        <>
          <button role="menuitem" className="menu-item" onClick={() => (closeMenu(), void openProject(proj))}>
            Open
          </button>
          <button role="menuitem" className="menu-item" onClick={() => (closeMenu(), setRenaming(proj))}>
            Rename…
          </button>
          <button role="menuitem" className="menu-item danger" onClick={() => (closeMenu(), setDeleting(proj))}>
            Delete…
          </button>
        </>
      )}
    </Menu>
  );
  const thumb = (proj: OnlineProject, small?: boolean) => (
    <button
      className={small ? 'project-thumb small' : 'project-thumb'}
      title={`Open ${proj.name}`}
      aria-label={small ? `Open ${proj.name}` : undefined}
      disabled={!!opening}
      onClick={() => void openProject(proj)}
    >
      {proj.hasThumbnail ? <img src={projectThumbnailUrl(proj)} alt="" loading="lazy" /> : <span aria-hidden>3MF</span>}
      {opening === proj.id && (
        <span className="project-opening" role="status">
          <LoaderCircle className="spin" size={16} aria-hidden />
          Opening…
        </span>
      )}
    </button>
  );
  const name = (proj: OnlineProject) => (
    <button className="project-card-name" title={proj.name} disabled={!!opening} onClick={() => void openProject(proj)}>
      {proj.name}
    </button>
  );
  const details = (proj: OnlineProject) => (
    <>
      {missing(proj) && (
        <div className="small project-gone" data-testid="project-not-in-drive">
          Not in your Google Drive{' '}
          <button className="quiet small-btn" onClick={() => useProjects.setState({ gone: proj })}>
            Remove…
          </button>
        </div>
      )}
      <div className="muted small">
        {formatWhen(proj.updatedAt)} · {formatBytes(proj.size)} · {engineName(proj.engine ?? 'snapmaker')}
      </div>
      {Boolean(proj.printedPlates) && (
        <div className="small print-count" data-testid="project-printed">
          {printedText(proj.printedPlates!, proj.plates ?? null)}
        </div>
      )}
    </>
  );

  return (
    <Dialog
      title="Online projects"
      wide
      className="projects-dialog"
      onClose={close}
      footer={
        <>
          {list && status === 'signedIn' && <DriveNote list={list} />}
          <button className="secondary" onClick={close}>
            Close
          </button>
        </>
      }
    >
      {status !== 'signedIn' ? (
        <Empty
          icon={FolderOpen}
          text="Sign in to keep projects online and open them on any device."
          action={
            status === 'signedOut' && (
              <button className="primary" onClick={() => void useAccount.getState().signIn('google')}>
                Sign in with Google
              </button>
            )
          }
        >
          {status === 'unavailable' && <Note tone="info">Accounts aren't set up on this site yet. Save still downloads the 3MF.</Note>}
        </Empty>
      ) : !list ? (
        error ? (
          <ErrorNote message={`Couldn't load your projects: ${error}`} />
        ) : (
          <div className="projects-loading" role="status">
            <PrintLoader loading={{ label: 'Loading your projects…' }} />
          </div>
        )
      ) : (
        <>
          {!list.enabled && <Note tone="warn">Online projects are turned off for your account. Save downloads the 3MF instead.</Note>}
          {error && <ErrorNote message={error} />}
          <ContinueRow list={list} onOpen={(proj) => void openProject(proj)} />
          {saved.length === 0 ? (
            <Empty icon={FolderOpen} text="No projects yet. Use Save in the Project menu to keep the open project here." />
          ) : (
            <>
              <div className="projects-bar">
                <label className="projects-search">
                  <Search size={16} aria-hidden />
                  <input type="search" aria-label="Search projects" placeholder="Search projects" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
                <Picker label="Sort" value={sort} options={PROJECT_SORTS} onChange={(v) => setSort(v as ProjectSort)} testId="projects-sort" />
                <div className="chooser" role="radiogroup" aria-label="Show as">
                  {(['cards', 'list'] as const).map((v) => (
                    <button key={v} role="radio" aria-checked={view === v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                      {v === 'cards' ? 'Cards' : 'List'}
                    </button>
                  ))}
                </div>
              </div>
              {shown.length === 0 ? (
                <p className="muted">No projects match “{search.trim()}”.</p>
              ) : view === 'cards' ? (
                <ul className="projects-grid">
                  {shown.map((proj) => (
                    <li key={proj.id} className={proj.id === currentId ? 'card project-card current' : 'card project-card'}>
                      {thumb(proj)}
                      <div className="project-card-head">
                        {name(proj)}
                        {actions(proj)}
                      </div>
                      {details(proj)}
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="projects-list">
                  {shown.map((proj) => (
                    <li key={proj.id} className={proj.id === currentId ? 'project-row current' : 'project-row'}>
                      {thumb(proj, true)}
                      <div className="project-row-text">
                        {name(proj)}
                        {details(proj)}
                      </div>
                      {actions(proj)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
      {renaming && (
        <RenameProjectDialog
          project={renaming}
          onClose={() => setRenaming(null)}
          onDone={(updated) => {
            setRenaming(null);
            p.onlineChanged(updated);
            setList((l) => l && { ...l, projects: l.projects.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)) });
            void load();
          }}
        />
      )}
      {deleting && (
        <DeleteProjectDialog
          project={deleting}
          isOpen={deleting.id === currentId}
          onClose={() => setDeleting(null)}
          onDone={() => {
            const gone = deleting;
            setDeleting(null);
            p.onlineChanged({ id: gone.id, deleted: true });
            setList((l) => l && { ...l, projects: l.projects.filter((x) => x.id !== gone.id) });
            void load();
          }}
        />
      )}
    </Dialog>
  );
}

/** Projects are kept in the person's own Google Drive (Connect is in the account menu, for anyone who said no at sign-in). */
function DriveNote({ list }: { list: ProjectList }) {
  return (
    <p className="muted small projects-usage" data-testid="projects-storage">
      {list.drive?.connected
        ? `Saved in your own Google Drive, “Cloud Slicer” folder. Projects take up your Google storage space (shared with Gmail and Photos) · ${list.count} ${list.count === 1 ? 'project' : 'projects'}`
        : 'Connect Google Drive in the account menu to save projects online.'}
    </p>
  );
}

/** A red note with what went wrong and a Copy button for the words. */
function ErrorNote({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(message).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  return (
    <Note tone="error" className="error-note">
      {message}{' '}
      <button type="button" className="quiet small-btn" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </Note>
  );
}

/** A window's main button while the server works: a spinner and "Deleting…"; every button locked. */
function Working({ busy, idle, working }: { busy: boolean; idle: string; working: string }) {
  return busy ? (
    <>
      <LoaderCircle className="spin" size={16} aria-hidden />
      {working}
    </>
  ) : (
    <>{idle}</>
  );
}

function RenameProjectDialog({ project, onClose, onDone }: { project: OnlineProject; onClose(): void; onDone(updated: OnlineProject): void }) {
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trimmed = name.trim();
  const ready = !!trimmed && trimmed !== project.name && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      onDone(await api.renameProject(project.id, trimmed));
    } catch (e) {
      setError(`Couldn't rename: ${(e as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Rename project"
      testId="rename-project"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="rename-project-form" className="primary" disabled={!ready && !busy} aria-busy={busy}>
            <Working busy={busy} idle="Rename" working="Renaming…" />
          </button>
        </>
      }
    >
      <form
        id="rename-project-form"
        className="win-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input aria-label="Project name" autoFocus maxLength={128} value={name} disabled={busy} onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <ErrorNote message={error} />}
      </form>
    </Dialog>
  );
}

function DeleteProjectDialog({ project, isOpen, onClose, onDone }: { project: OnlineProject; isOpen: boolean; onClose(): void; onDone(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await api.deleteProject(project.id);
      onDone();
    } catch (e) {
      setError(`Couldn't delete: ${(e as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Delete “${project.name}”?`}
      role="alertdialog"
      describedBy="delete-project-text"
      testId="delete-project"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary danger" aria-busy={busy} onClick={() => !busy && void remove()}>
            <Working busy={busy} idle="Delete" working="Deleting…" />
          </button>
        </>
      }
    >
      <p id="delete-project-text">
        {isOpen
          ? "It's removed from your online projects for good. You have it open: it stays open here as an unsaved project."
          : "It's removed from your online projects for good. Files you downloaded stay."}
      </p>
      {error && <ErrorNote message={error} />}
    </Dialog>
  );
}

/** "6/10 printed" for a project card (lib/prints.ts); the plate count is missing on projects saved before it was kept. */
function printedText(printed: number, plates: number | null): string {
  if (plates === 1) return '✓ Printed';
  return plates ? `✓ ${Math.min(printed, plates)}/${plates} printed` : `✓ ${printed} ${printed === 1 ? 'plate' : 'plates'} printed`;
}

/** The top of Online projects: the newest project changed on another device. */
function ContinueRow({ list, onOpen }: { list: ProjectList; onOpen(p: OnlineProject): void }) {
  const currentId = useProjects((s) => s.current.id);
  const offer = continueOffer(list.projects, deviceId());
  if (!offer || offer.project.id === currentId) return null;
  const proj = offer.project;
  return (
    <div className="continue-row" data-testid="continue-row">
      <div className="project-thumb small" aria-hidden>
        {proj.hasThumbnail ? <img src={projectThumbnailUrl(proj)} alt="" loading="lazy" /> : <span>3MF</span>}
      </div>
      <div className="continue-text">
        <b>{`Continue ${proj.name}`}</b>
        <span className="muted small">{`Edited ${formatWhen(proj.updatedAt)} on ${yourDevice(proj.deviceName)}`}</span>
      </div>
      <button className="primary" onClick={() => onOpen(proj)}>
        Continue
      </button>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, projectThumbnailUrl, type OnlineProject, type ProjectList } from '../account/api';
import { engineName } from '../lib/engines';
import { copyName, findProjects, formatBytes, formatWhen, PROJECT_SORTS, UNTITLED, type ProjectSort } from '../lib/projects';
import { MODEL_EXTENSIONS } from '../lib/presets';
import { useAccount } from '../state/account';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';
import { continueOffer, yourDevice } from '../lib/autosave';
import { deviceId } from '../lib/storage';
import { Note } from './Note';
import { Empty } from './Empty';
import { Menu } from './Menu';
import { Picker } from './Picker';
import { IconButton } from './IconButton';
import { FolderOpen, LoaderCircle, MoreHorizontal, Search } from 'lucide-react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

/** What AutoSave shows next to the project name ('' when there is nothing to say). */
function useSaveStatus(): string {
  const signedIn = useAccount((s) => s.status === 'signedIn');
  const autosave = useAccount((s) => s.settings.autosave?.value !== false);
  const cur = useProjects((s) => s.current);
  const dirty = useProjects((s) => s.dirty);
  const state = useProjects((s) => s.saveState);
  const stopped = useProjects((s) => s.autosaveStopped);
  const elsewhere = useProjects((s) => s.elsewhere);
  const hasModel = useSlicer((s) => Boolean(s.project?.objects.length));
  if (!signedIn || !hasModel) return '';
  if (elsewhere) return 'View only';
  if (state === 'saving') return 'Saving…';
  if (state === 'offline') return 'Not saved: no connection';
  if (stopped) return 'Not saved';
  if (!cur.id || cur.draft) return 'Draft, not saved yet';
  if (!dirty) return 'Saved';
  return autosave ? 'Saving…' : 'Not saved';
}

/** The top bar's Project menu (New, Open, Projects, Save, Save a copy, Download 3MF, AutoSave) and its dialogs. */
export function ProjectMenu() {
  const ready = useSlicer((s) => s.engine === 'ready');
  const name = useProjects((s) => s.current.name);
  const online = useProjects((s) => s.current.id !== null && !s.current.draft);
  const dirty = useProjects((s) => s.dirty);
  const busy = useProjects((s) => s.busy);
  const signedIn = useAccount((s) => s.status === 'signedIn');
  const engineInfo = useSlicer((s) => s.engineInfo);
  const autosave = useAccount((s) => s.settings.autosave?.value !== false);
  const autosaveBusy = useProjects((s) => s.saveState === 'saving');
  const stopped = useProjects((s) => s.autosaveStopped);
  const status = useSaveStatus();
  const p = useProjects.getState();
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

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

  // Leaving with unsaved changes asks first (AutoSave saves as the tab goes away instead).
  const autosaving = signedIn && autosave && !stopped;
  useEffect(() => {
    if (!dirty || autosaving) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, autosaving]);

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
            {dirty && !autosaveBusy && <span className="project-dirty" aria-label="unsaved changes" />}
            {status && !busy && <span className="project-status" data-testid="save-status">{status}</span>}
            {busy && <span className="project-busy">{busy}</span>}
          </button>
        )}
      >
        {/* The default engine; the sidebar's Slicer engine dropdown picks the other one. */}
        <button role="menuitem" className="menu-item" onClick={run(async () => (await leaveOk()) && p.newProject())}>
          New project
        </button>
        <button role="menuitem" className="menu-item" onClick={run(() => input.current?.click())}>
          Open from this device…<kbd>{MOD}O</kbd>
        </button>
        <button role="menuitem" className="menu-item" onClick={run(() => p.setListOpen(true))}>
          Online projects…
        </button>
        <hr />
        {/* Signed out, Save downloads the 3MF: one row for both. */}
        {signedIn && (
          <button role="menuitem" className="menu-item" disabled={!!busy} onClick={run(() => p.save())}>
            Save
            <kbd>{MOD}S</kbd>
          </button>
        )}
        <button role="menuitem" className="menu-item" disabled={!!busy} onClick={run(() => p.setSaveAsOpen('copy'))}>
          Save a copy…
        </button>
        <button role="menuitem" className="menu-item" disabled={!!busy} onClick={run(() => (signedIn ? p.download() : p.save()))}>
          Download 3MF
          {!signedIn && <kbd>{MOD}S</kbd>}
        </button>
        {engineInfo && (
          <p className="menu-note" data-testid="project-engine">
            This project slices with {engineInfo.name} {engineInfo.version}.
          </p>
        )}
        {signedIn && (
          <button
            role="menuitemcheckbox"
            aria-checked={autosave}
            className="menu-item menu-switch"
            onClick={() => void useProjects.getState().setAutosave(!autosave)}
          >
            AutoSave
            <span className={autosave ? 'switch on' : 'switch'} aria-hidden />
          </button>
        )}
        {signedIn && (
          <p className="menu-note">
            {autosave
              ? 'AutoSave keeps changes in your online projects a few seconds after you make them. A new project stays a draft until you Save it.'
              : 'AutoSave is off: changes wait for Save.'}
          </p>
        )}
        {stopped && <Note tone="warn" className="menu-note-box">{stopped}</Note>}
        {!signedIn && <p className="menu-note">Sign in to keep projects online and open them on any device.</p>}
      </Menu>
      {signedIn && (
        <button
          className={autosave ? 'autosave-pill on' : 'autosave-pill'}
          role="switch"
          aria-checked={autosave}
          title={autosave ? 'AutoSave is on: changes save by themselves' : 'AutoSave is off: changes wait for Save'}
          onClick={() => void useProjects.getState().setAutosave(!autosave)}
        >
          AutoSave <span className={autosave ? 'switch on' : 'switch'} aria-hidden />
        </button>
      )}
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
      <SaveAsDialog />
      <ConflictDialog />
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
  const [name, setName] = useState(initial);
  const close = () => useProjects.getState().setSaveAsOpen(false);
  const trimmed = name.trim();
  return (
    <Dialog
      title={copy ? 'Save a copy' : 'Save project'}
      testId="save-as-dialog"
      onClose={close}
      footer={
        <>
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" form="save-as-form" className="primary" disabled={!trimmed}>
            {signedIn ? 'Save' : 'Download'}
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
        <p className="muted small">
          {!signedIn
            ? 'Downloaded as a 3MF project file. Sign in to keep projects online.'
            : copy
              ? 'Saved as a new project in your online projects, with its plates, settings and paint. You carry on in the copy.'
              : 'Kept in your online projects with its plates, settings and paint. After this, AutoSave saves your changes.'}
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
      title="Saved on another device"
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
        {conflict.theirs
          ? `“${conflict.theirs.name}” was saved again ${when}, after you opened it here.`
          : `“${name}” was deleted from your online projects after you opened it here.`}{' '}
        Overwrite it with this version, or keep both?
      </p>
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

  const load = () =>
    api
      .projects()
      .then((l) => {
        setList(l);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
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

  const openProject = async (proj: OnlineProject) => {
    if (opening) return;
    setOpening(proj.id);
    try {
      if (!(await useProjects.getState().leaveOk())) return;
      void p.openOnline(proj);
    } finally {
      setOpening(null);
    }
  };
  const saved = list?.projects.filter((x) => !x.draft) ?? [];
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
          {list &&
            status === 'signedIn' &&
            (list.limits.userBytes ? (
              <p className="muted small projects-usage">
                {formatBytes(list.usage.bytes)} of {formatBytes(list.limits.userBytes)} used · {list.usage.count} of {list.limits.userProjects} projects · up to{' '}
                {formatBytes(list.limits.projectBytes)} each
              </p>
            ) : (
              <p className="muted small projects-usage">
                Online projects are off for your account: your presets and printers still save to it. Download a project to keep it.
              </p>
            ))}
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
        <p className="muted">{error || 'Loading…'}</p>
      ) : (
        <>
          {!list.enabled && <Note tone="warn">Online projects aren't set up on this site yet. Save as a download instead.</Note>}
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

/** The top of Online projects: the draft, or the newest project changed on another device. */
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
        <b>{offer.kind === 'draft' ? 'Your unsaved project' : `Continue ${proj.name}`}</b>
        <span className="muted small">
          {offer.kind === 'draft' ? `${proj.name}, changed ${formatWhen(proj.updatedAt)}` : `Edited ${formatWhen(proj.updatedAt)} on ${yourDevice(proj.deviceName)}`}
        </span>
      </div>
      <button className="primary" onClick={() => onOpen(proj)}>
        Continue
      </button>
    </div>
  );
}

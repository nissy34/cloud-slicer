import { useCallback, useEffect, useRef, useState } from 'react';
import { api, projectThumbnailUrl, type OnlineProject, type ProjectList } from '../account/api';
import { engineName } from '../lib/engines';
import { copyName, formatBytes, formatWhen, UNTITLED } from '../lib/projects';
import { MODEL_EXTENSIONS } from '../lib/presets';
import { useAccount } from '../state/account';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';
import { continueOffer, yourDevice } from '../lib/autosave';
import { deviceId } from '../lib/storage';
import { Note } from './Note';
import { Empty } from './Empty';
import { FolderOpen } from 'lucide-react';

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
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

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
    <div className="project-menu" ref={root}>
      <button
        className="project-button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!ready}
        title={status ? `${name} (${status})` : dirty ? `${name} (unsaved changes)` : name}
        onClick={() => setOpen(!open)}
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
      {open && (
        <div className="menu-pop" role="menu" aria-label="Project">
          {/* The default engine; the sidebar's Slicer engine dropdown picks the other one. */}
          <button role="menuitem" onClick={run(async () => (await leaveOk()) && p.newProject())}>
            New project
          </button>
          <button role="menuitem" onClick={run(() => input.current?.click())}>
            Open from this device…<kbd>{MOD}O</kbd>
          </button>
          <button role="menuitem" onClick={run(() => p.setListOpen(true))}>
            Online projects…
          </button>
          <hr />
          <button role="menuitem" disabled={!!busy} onClick={run(() => p.save())}>
            {signedIn ? 'Save' : 'Save (download)'}
            <kbd>{MOD}S</kbd>
          </button>
          <button role="menuitem" disabled={!!busy} onClick={run(() => p.setSaveAsOpen('copy'))}>
            Save a copy…
          </button>
          <button role="menuitem" disabled={!!busy} onClick={run(() => p.download())}>
            Download 3MF
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
              className="menu-switch"
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
        </div>
      )}
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

function ProjectsDialog() {
  const open = useProjects((s) => s.listOpen);
  const status = useAccount((s) => s.status);
  const currentId = useProjects((s) => s.current.id);
  const [list, setList] = useState<ProjectList | null>(null);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

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
    }
  }, [open, status]);
  const close = useCallback(() => useProjects.getState().setListOpen(false), []);
  if (!open) return null;
  const p = useProjects.getState();

  const rename = async (proj: OnlineProject, name: string) => {
    setRenaming(null);
    if (!name.trim() || name.trim() === proj.name) return;
    try {
      const updated = await api.renameProject(proj.id, name.trim());
      p.onlineChanged(updated);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (proj: OnlineProject) => {
    setDeleting(null);
    try {
      await api.deleteProject(proj.id);
      p.onlineChanged({ id: proj.id, deleted: true });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openProject = async (proj: OnlineProject) => {
    if (!(await useProjects.getState().leaveOk())) return;
    void p.openOnline(proj);
  };

  return (
    <Dialog
      title="Online projects"
      wide
      className="projects-dialog"
      onClose={close}
      footer={
        <button className="secondary" onClick={close}>
          Close
        </button>
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
          {error && <Note tone="error">{error}</Note>}
          <ContinueRow list={list} onOpen={(proj) => void openProject(proj)} />
          {list.projects.filter((x) => !x.draft).length === 0 ? (
            <Empty icon={FolderOpen} text="No projects yet. Use Save in the Project menu to keep the open project here." />
          ) : (
            <ul className="projects-grid">
              {list.projects.filter((x) => !x.draft).map((proj) => (
                <li key={proj.id} className={proj.id === currentId ? 'card project-card current' : 'card project-card'}>
                  <button className="project-thumb" title={`Open ${proj.name}`} onClick={() => void openProject(proj)}>
                    {proj.hasThumbnail ? <img src={projectThumbnailUrl(proj)} alt="" loading="lazy" /> : <span aria-hidden>3MF</span>}
                  </button>
                  {renaming?.id === proj.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void rename(proj, renaming.name);
                      }}
                    >
                      <input
                        aria-label="New name"
                        autoFocus
                        maxLength={128}
                        value={renaming.name}
                        onChange={(e) => setRenaming({ id: proj.id, name: e.target.value })}
                        onBlur={() => void rename(proj, renaming.name)}
                      />
                    </form>
                  ) : (
                    <div className="project-card-name" title={proj.name}>
                      {proj.name}
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
                  {deleting === proj.id ? (
                    <div className="project-card-actions">
                      <span className="small">Delete?</span>
                      <button className="quiet" onClick={() => setDeleting(null)}>
                        Keep
                      </button>
                      <button className="quiet danger" onClick={() => void remove(proj)}>
                        Delete
                      </button>
                    </div>
                  ) : (
                    <div className="project-card-actions">
                      <button className="quiet" onClick={() => void openProject(proj)}>
                        Open
                      </button>
                      <button className="quiet" onClick={() => setRenaming({ id: proj.id, name: proj.name })}>
                        Rename
                      </button>
                      <button className="quiet danger" aria-label={`Delete ${proj.name}`} onClick={() => setDeleting(proj.id)}>
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {list.limits.userBytes ? (
            <p className="muted small">
              {formatBytes(list.usage.bytes)} of {formatBytes(list.limits.userBytes)} used · {list.usage.count} of {list.limits.userProjects} projects · up to{' '}
              {formatBytes(list.limits.projectBytes)} each
            </p>
          ) : (
            <p className="muted small">
              Online projects are off for your account: your presets and printers still save to it. Download a project to keep it.
            </p>
          )}
        </>
      )}
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

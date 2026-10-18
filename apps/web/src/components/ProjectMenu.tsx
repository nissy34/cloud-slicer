import { useEffect, useRef, useState } from 'react';
import { api, projectThumbnailUrl, type OnlineProject, type ProjectList } from '../account/api';
import { formatBytes, formatWhen, UNTITLED } from '../lib/projects';
import { MODEL_EXTENSIONS } from '../lib/presets';
import { useAccount } from '../state/account';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

/** The top bar's Project menu (New, Open, Projects, Save, Save as, Download 3MF) and its dialogs. */
export function ProjectMenu() {
  const ready = useSlicer((s) => s.engine === 'ready');
  const name = useProjects((s) => s.current.name);
  const online = useProjects((s) => s.current.id !== null);
  const dirty = useProjects((s) => s.dirty);
  const busy = useProjects((s) => s.busy);
  const message = useProjects((s) => s.message);
  const messageWarn = useProjects((s) => s.messageWarn);
  const signedIn = useAccount((s) => s.status === 'signedIn');
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
        if (e.shiftKey) useProjects.getState().setSaveAsOpen(true);
        else void useProjects.getState().save();
      } else if (k === 'o' && !e.shiftKey) {
        e.preventDefault();
        input.current?.click();
      }
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [ready]);

  // Leaving with unsaved changes asks first.
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
  const discardOk = () => !useProjects.getState().dirty || confirm(`Discard the unsaved changes to “${useProjects.getState().current.name}”?`);

  return (
    <div className="project-menu" ref={root}>
      <button
        className="project-button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!ready}
        title={dirty ? `${name} (unsaved changes)` : name}
        onClick={() => setOpen(!open)}
      >
        <span className="project-label">Project</span>
        <span className="project-name">
          {name}
          {online && <span className="project-cloud" aria-label="saved online" title="Saved in your online projects" />}
        </span>
        {dirty && <span className="project-dirty" aria-label="unsaved changes" />}
        {busy && <span className="project-busy">{busy}</span>}
      </button>
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
          if (files.length && (!files.some((f) => /\.3mf$/i.test(f.name)) || discardOk())) void useProjects.getState().openFiles(files);
        }}
      />
      {open && (
        <div className="menu-pop" role="menu" aria-label="Project">
          <button role="menuitem" onClick={run(() => discardOk() && p.newProject())}>
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
          <button role="menuitem" disabled={!!busy} onClick={run(() => p.setSaveAsOpen(true))}>
            Save as…
          </button>
          <button role="menuitem" disabled={!!busy} onClick={run(() => p.download())}>
            Download 3MF
          </button>
          {!signedIn && <p className="menu-note">Sign in to keep projects online and open them on any device.</p>}
        </div>
      )}
      {message && !open && (
        <div className={messageWarn ? 'project-toast warn' : 'project-toast'} role="status">
          {message}
          <button className="account-link" onClick={() => useProjects.getState().clearMessage()}>
            Dismiss
          </button>
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
  const current = useProjects((s) => s.current.name);
  const signedIn = useAccount((s) => s.status === 'signedIn');
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) setName(current === UNTITLED ? '' : current);
  }, [open, current]);
  if (!open) return null;
  const close = () => useProjects.getState().setSaveAsOpen(false);
  const trimmed = name.trim();
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-as-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) void useProjects.getState().saveAs(trimmed);
        }}
      >
        <h2 id="save-as-title">Save project as</h2>
        <label className="field">
          <span>Name</span>
          <input aria-label="Project name" autoFocus maxLength={128} value={name} placeholder="My project" onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="muted small">
          {signedIn
            ? 'Saved as a new project in your online projects, with its plates, settings and paint.'
            : 'Downloaded as a 3MF project file. Sign in to keep projects online.'}
        </p>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!trimmed}>
            {signedIn ? 'Save' : 'Download'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConflictDialog() {
  const conflict = useProjects((s) => s.conflict);
  const name = useProjects((s) => s.current.name);
  if (!conflict) return null;
  const { resolveConflict } = useProjects.getState();
  const when = conflict.theirs ? formatWhen(conflict.theirs.updatedAt) : null;
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title">
        <h2 id="conflict-title">Saved on another device</h2>
        <p>
          {conflict.theirs
            ? `“${conflict.theirs.name}” was saved again ${when}, after you opened it here.`
            : `“${name}” was deleted from your online projects after you opened it here.`}{' '}
          Overwrite it with this version, or keep both?
        </p>
        <div className="dialog-actions wrap">
          <button className="secondary" onClick={() => void resolveConflict('cancel')}>
            Cancel
          </button>
          <button className="secondary" onClick={() => void resolveConflict('copy')}>
            Save as a copy
          </button>
          <button className="primary" onClick={() => void resolveConflict('overwrite')}>
            Overwrite
          </button>
        </div>
      </div>
    </div>
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
  if (!open) return null;
  const close = () => useProjects.getState().setListOpen(false);
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
  const openProject = (proj: OnlineProject) => {
    if (useProjects.getState().dirty && !confirm(`Discard the unsaved changes to “${useProjects.getState().current.name}”?`)) return;
    void p.openOnline(proj);
  };

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog projects-dialog" role="dialog" aria-modal="true" aria-labelledby="projects-title">
        <div className="projects-head">
          <h2 id="projects-title">Online projects</h2>
          <button className="ghost" onClick={close}>
            Close
          </button>
        </div>
        {status !== 'signedIn' ? (
          <div className="projects-empty">
            <p>Sign in to keep projects online and open them on any device.</p>
            {status === 'signedOut' && (
              <button className="primary" onClick={() => void useAccount.getState().signIn('google')}>
                Sign in with Google
              </button>
            )}
            {status === 'unavailable' && <p className="muted small">Accounts aren't set up on this site yet. Save still downloads the 3MF.</p>}
          </div>
        ) : !list ? (
          <p className="muted">{error || 'Loading…'}</p>
        ) : (
          <>
            {!list.enabled && <p className="account-error">Online projects aren't set up on this site yet. Save as a download instead.</p>}
            {error && <p className="account-error">{error}</p>}
            {list.projects.length === 0 ? (
              <p className="projects-empty muted">No projects yet. Use Save in the Project menu to keep the open project here.</p>
            ) : (
              <ul className="projects-grid">
                {list.projects.map((proj) => (
                  <li key={proj.id} className={proj.id === currentId ? 'project-card current' : 'project-card'}>
                    <button className="project-thumb" title={`Open ${proj.name}`} onClick={() => openProject(proj)}>
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
                      {formatWhen(proj.updatedAt)} · {formatBytes(proj.size)}
                    </div>
                    {deleting === proj.id ? (
                      <div className="project-card-actions">
                        <span className="small">Delete?</span>
                        <button className="account-link" onClick={() => setDeleting(null)}>
                          Keep
                        </button>
                        <button className="account-link danger" onClick={() => void remove(proj)}>
                          Delete
                        </button>
                      </div>
                    ) : (
                      <div className="project-card-actions">
                        <button className="account-link" onClick={() => openProject(proj)}>
                          Open
                        </button>
                        <button className="account-link" onClick={() => setRenaming({ id: proj.id, name: proj.name })}>
                          Rename
                        </button>
                        <button className="account-link danger" aria-label={`Delete ${proj.name}`} onClick={() => setDeleting(proj.id)}>
                          Delete
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">
              {formatBytes(list.usage.bytes)} of {formatBytes(list.limits.userBytes)} used · {list.usage.count} of {list.limits.userProjects} projects · up to{' '}
              {formatBytes(list.limits.projectBytes)} each
            </p>
          </>
        )}
      </div>
    </div>
  );
}

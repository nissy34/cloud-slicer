import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
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
  const { t } = useTranslation();
  const online = useProjects((s) => s.current.id !== null);
  const dirty = useProjects((s) => s.dirty);
  const keptHere = useProjects((s) => s.keptHere);
  const elsewhere = useProjects((s) => s.elsewhere);
  const hasModel = useSlicer((s) => Boolean(s.project?.objects.length));
  if (!hasModel) return '';
  if (elsewhere) return t('projectMenu.viewOnly');
  // AutoSave keeps unsaved changes in this browser; Save puts them online.
  if (dirty) return keptHere ? t('projectMenu.savedHere') : t('projectMenu.notSaved');
  return online ? t('projectMenu.saved') : '';
}

/** The top bar's Project menu (New, Open, Projects, Save, Save a copy, Download 3MF) and its dialogs. */
export function ProjectMenu() {
  const { t } = useTranslation();
  const ready = useSlicer((s) => s.engine === 'ready');
  // A new project's stored name is English ("Untitled"); it is shown in the page's language.
  const name = useProjects((s) => (s.current.name === UNTITLED ? t('projectMenu.untitled') : s.current.name));
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
        label={t('projectMenu.project')}
        open={open}
        onOpenChange={setOpen}
        button={(props) => (
          <button
            {...props}
            className="project-button"
            disabled={!ready}
            title={status ? t('projectMenu.nameStatus', { name, status }) : dirty ? t('projectMenu.nameUnsaved', { name }) : name}
          >
            <span className="project-label">{t('projectMenu.project')}</span>
            <span className="project-name">
              <span className="project-name-text">{name}</span>
              {online && <span className="project-cloud" aria-label={t('projectMenu.savedOnline')} title={t('projectMenu.savedOnlineTip')} />}
            </span>
            {saving && <LoaderCircle className="spin project-spin" size={14} aria-label={t('projectMenu.savingLabel')} data-testid="save-spinner" />}
            {dirty && !saving && <span className="project-dirty" aria-label={t('projectMenu.unsavedLabel')} />}
            {status && !busy && <span className="project-status" data-testid="save-status">{status}</span>}
            {busy && <span className="project-busy">{busy}</span>}
          </button>
        )}
      >
        {/* The default engine; the sidebar's Slicer engine dropdown picks the other one. */}
        <button role="menuitem" className="menu-item" onClick={run(() => p.startNew())}>
          {t('projectMenu.newProject')}
        </button>
        <button role="menuitem" className="menu-item" onClick={run(() => input.current?.click())}>
          {t('projectMenu.openDevice')}
          <kbd>{MOD}O</kbd>
        </button>
        <button
          role="menuitem"
          className="menu-item"
          disabled={!driveOpen.available || !!busy}
          title={driveOpen.reason || undefined}
          data-testid="open-from-drive"
          onClick={run(() => driveOpen.open('project'))}
        >
          {t('projectMenu.openDrive')}
        </button>
        <button role="menuitem" className="menu-item" disabled={noDrive} onClick={run(() => p.setListOpen(true))}>
          {t('projectMenu.onlineProjects')}
        </button>
        {/* Drive connected but the site lacks Google's key: say so (the other reasons share the note below). */}
        {!noDrive && signedIn && !driveOpen.available && <p className="menu-note">{driveOpen.reason}</p>}
        {noDrive && (
          <p className="menu-note" data-testid="online-projects-off">
            {projectsOff
              ? t('projectMenu.projectsOff')
              : t('projectMenu.connectDriveMenu')}
          </p>
        )}
        <hr />
        {/* While a save runs its rows wait, and say why; how far it got, and Cancel. */}
        {saving && (
          <div className="menu-note menu-working" data-testid="menu-saving">
            <LoaderCircle className="spin" size={16} aria-hidden />
            <span>
              <b>{busy}</b> {t('projectMenu.savingWait')}
              <SaveBar />
            </span>
          </div>
        )}
        {saving && saveCancel && (
          <button role="menuitem" className="menu-item" data-testid="menu-cancel-save" onClick={run(() => p.cancelSave())}>
            {t('projectMenu.cancelSaving')}
          </button>
        )}
        {/* Signed out or without Drive, Save downloads the 3MF: one row for both. */}
        {savesOnline && (
          <button role="menuitem" className="menu-item" disabled={!!busy} onClick={run(() => p.save())}>
            {t('projectMenu.save')}
            <kbd>{MOD}S</kbd>
          </button>
        )}
        <button role="menuitem" className="menu-item" disabled={!!busy} onClick={run(() => p.setSaveAsOpen('copy'))}>
          {t('projectMenu.saveCopyMenu')}
        </button>
        <button role="menuitem" className="menu-item" disabled={!!busy} onClick={run(() => (savesOnline ? p.download() : p.save()))}>
          {t('projectMenu.download3mf')}
          {!savesOnline && <kbd>{MOD}S</kbd>}
        </button>
        {engineInfo && (
          <p className="menu-note" data-testid="project-engine">
            {t('projectMenu.slicesWith', { name: engineInfo.name, version: engineInfo.version })}
          </p>
        )}
        <p className="menu-note" data-testid="autosave-note">
          {savesOnline
            ? t('projectMenu.autosaveDrive')
            : t('projectMenu.autosave')}
        </p>
        {!signedIn && <p className="menu-note">{t('projectMenu.signInNote')}</p>}
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
  const { t } = useTranslation();
  const signedIn = useAccount((s) => s.status === 'signedIn');
  const online = useProjects((s) => s.canSaveOnline());
  // Opened from Google Drive: the first Save says plainly that it makes a copy and leaves the Drive file alone.
  const fromDrive = useProjects((s) => (online && !copy ? s.current.fromDrive : undefined));
  const [name, setName] = useState(initial);
  const close = () => useProjects.getState().setSaveAsOpen(false);
  const trimmed = name.trim();
  return (
    <Dialog
      title={fromDrive ? t('projectMenu.saveCopyToCloud') : copy ? t('projectMenu.saveCopy') : t('projectMenu.saveProject')}
      testId="save-as-dialog"
      onClose={close}
      footer={
        <>
          <button type="button" className="secondary" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="save-as-form" className="primary" disabled={!trimmed}>
            {fromDrive ? t('projectMenu.saveCopyButton') : online ? t('projectMenu.save') : t('projectMenu.download')}
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
          <span>{t('projectMenu.name')}</span>
          <input aria-label={t('projectMenu.projectName')} autoFocus maxLength={128} value={name} placeholder={t('projectMenu.myProject')} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="muted small" data-testid="save-as-note">
          {fromDrive ? (
            <>
              {t('projectMenu.fromDriveSaves')}{' '}
              {/\.\w+$/.test(fromDrive) ? (
                <Trans i18nKey={'projectMenu.fromDriveFile'} values={{ name: fromDrive }} components={{ b: <b /> }} />
              ) : (
                t('projectMenu.fromDriveFiles', { name: fromDrive })
              )}{' '}
              {t('projectMenu.fromDriveAfter')}
            </>
          ) : !signedIn
            ? t('projectMenu.downloadedSignIn')
            : !online
              ? t('projectMenu.downloadedConnect')
            : copy
              ? t('projectMenu.savedAsCopy')
              : t('projectMenu.keptOnline')}
        </p>
      </form>
    </Dialog>
  );
}

function ConflictDialog() {
  const { t } = useTranslation();
  const conflict = useProjects((s) => s.conflict);
  const name = useProjects((s) => s.current.name);
  if (!conflict) return null;
  const { resolveConflict } = useProjects.getState();
  const when = conflict.theirs ? formatWhen(conflict.theirs.updatedAt) : null;
  return (
    <Dialog
      title={conflict.inDrive ? t('projectMenu.changedInDrive') : t('projectMenu.savedElsewhere')}
      role="alertdialog"
      onClose={() => void resolveConflict('cancel')}
      footer={
        <>
          <button className="secondary" onClick={() => void resolveConflict('cancel')}>
            {t('common.cancel')}
          </button>
          <button className="secondary" onClick={() => void resolveConflict('copy')}>
            {t('projectMenu.saveAsCopy')}
          </button>
          <button className="primary" onClick={() => void resolveConflict('overwrite')}>
            {t('projectMenu.overwrite')}
          </button>
        </>
      }
    >
      <p>
        {conflict.inDrive
          ? t('projectMenu.conflictDrive', { name })
          : conflict.theirs
          ? t('projectMenu.conflictSaved', { name: conflict.theirs.name, when })
          : t('projectMenu.conflictDeleted', { name })}{' '}
        {t('projectMenu.conflictAsk')}
      </p>
    </Dialog>
  );
}

/** A project whose file was deleted in Google Drive: remove it from the list too? */
function GoneDialog() {
  const { t } = useTranslation();
  const gone = useProjects((s) => s.gone);
  if (!gone) return null;
  const { removeGone } = useProjects.getState();
  const close = () => useProjects.setState({ gone: null });
  return (
    <Dialog
      title={t('projectMenu.notInDrive')}
      role="alertdialog"
      testId="project-gone"
      onClose={close}
      footer={
        <>
          <button className="secondary" onClick={close}>
            {t('projectMenu.keepInList')}
          </button>
          <button className="primary" onClick={() => void removeGone()}>
            {t('projectMenu.remove')}
          </button>
        </>
      }
    >
      <p>{t('projectMenu.goneAsk', { name: gone.name })}</p>
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
  const { t } = useTranslation();
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
      label={t('projectMenu.itemMenu', { name: proj.name })}
      placement="bottom-end"
      button={(props) => <IconButton {...props} icon={MoreHorizontal} label={t('projectMenu.more')} aria-label={t('projectMenu.moreFor', { name: proj.name })} className="project-more" disabled={!!opening} />}
    >
      {(closeMenu) => (
        <>
          <button role="menuitem" className="menu-item" onClick={() => (closeMenu(), void openProject(proj))}>
            {t('projectMenu.open')}
          </button>
          <button role="menuitem" className="menu-item" onClick={() => (closeMenu(), setRenaming(proj))}>
            {t('projectMenu.renameMenu')}
          </button>
          <button role="menuitem" className="menu-item danger" onClick={() => (closeMenu(), setDeleting(proj))}>
            {t('projectMenu.deleteMenu')}
          </button>
        </>
      )}
    </Menu>
  );
  const thumb = (proj: OnlineProject, small?: boolean) => (
    <button
      className={small ? 'project-thumb small' : 'project-thumb'}
      title={t('projectMenu.openName', { name: proj.name })}
      aria-label={small ? t('projectMenu.openName', { name: proj.name }) : undefined}
      disabled={!!opening}
      onClick={() => void openProject(proj)}
    >
      {proj.hasThumbnail ? <img src={projectThumbnailUrl(proj)} alt="" loading="lazy" /> : <span aria-hidden>3MF</span>}
      {opening === proj.id && (
        <span className="project-opening" role="status">
          <LoaderCircle className="spin" size={16} aria-hidden />
          {t('projectMenu.opening')}
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
          {t('projectMenu.notInDrive')}{' '}
          <button className="quiet small-btn" onClick={() => useProjects.setState({ gone: proj })}>
            {t('projectMenu.removeMenu')}
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
      title={t('projectMenu.title')}
      wide
      className="projects-dialog"
      onClose={close}
      footer={
        <>
          {list && status === 'signedIn' && <DriveNote list={list} />}
          <button className="secondary" onClick={close}>
            {t('common.close')}
          </button>
        </>
      }
    >
      {status !== 'signedIn' ? (
        <Empty
          icon={FolderOpen}
          text={t('projectMenu.signInNote')}
          action={
            status === 'signedOut' && (
              <button className="primary" onClick={() => void useAccount.getState().signIn('google')}>
                {t('projectMenu.signInGoogle')}
              </button>
            )
          }
        >
          {status === 'unavailable' && <Note tone="info">{t('projectMenu.accountsUnavailable')}</Note>}
        </Empty>
      ) : !list ? (
        error ? (
          <ErrorNote message={t('projectMenu.loadFailed', { error })} />
        ) : (
          <div className="projects-loading" role="status">
            <PrintLoader loading={{ label: t('projectMenu.loading') }} />
          </div>
        )
      ) : (
        <>
          {!list.enabled && <Note tone="warn">{t('projectMenu.turnedOff')}</Note>}
          {error && <ErrorNote message={error} />}
          <ContinueRow list={list} onOpen={(proj) => void openProject(proj)} />
          {saved.length === 0 ? (
            <Empty icon={FolderOpen} text={t('projectMenu.noProjects')} />
          ) : (
            <>
              <div className="projects-bar">
                <label className="projects-search">
                  <Search size={16} aria-hidden />
                  <input type="search" aria-label={t('projectMenu.search')} placeholder={t('projectMenu.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
                <Picker label={t('projectMenu.sort')} value={sort} options={PROJECT_SORTS.map((o) => ({ ...o, label: t(o.label) }))} onChange={(v) => setSort(v as ProjectSort)} testId="projects-sort" />
                <div className="chooser" role="radiogroup" aria-label={t('projectMenu.showAs')}>
                  {(['cards', 'list'] as const).map((v) => (
                    <button key={v} role="radio" aria-checked={view === v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                      {v === 'cards' ? t('projectMenu.cards') : t('projectMenu.list')}
                    </button>
                  ))}
                </div>
              </div>
              {shown.length === 0 ? (
                <p className="muted">{t('projectMenu.noMatch', { search: search.trim() })}</p>
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
  const { t } = useTranslation();
  return (
    <p className="muted small projects-usage" data-testid="projects-storage">
      {list.drive?.connected
        ? t('projectMenu.inDrive', { count: list.count })
        : t('projectMenu.connectDriveList')}
    </p>
  );
}

/** A red note with what went wrong and a Copy button for the words. */
function ErrorNote({ message }: { message: string }) {
  const { t } = useTranslation();
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
        {copied ? t('common.copied') : t('projectMenu.copy')}
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
  const { t } = useTranslation();
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
      setError(t('projectMenu.renameFailed', { error: (e as Error).message }));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t('projectMenu.renameTitle')}
      testId="rename-project"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="rename-project-form" className="primary" disabled={!ready && !busy} aria-busy={busy}>
            <Working busy={busy} idle={t('projectMenu.rename')} working={t('projectMenu.renaming')} />
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
          <span>{t('projectMenu.name')}</span>
          <input aria-label={t('projectMenu.projectName')} autoFocus maxLength={128} value={name} disabled={busy} onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <ErrorNote message={error} />}
      </form>
    </Dialog>
  );
}

function DeleteProjectDialog({ project, isOpen, onClose, onDone }: { project: OnlineProject; isOpen: boolean; onClose(): void; onDone(): void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await api.deleteProject(project.id);
      onDone();
    } catch (e) {
      setError(t('projectMenu.deleteFailed', { error: (e as Error).message }));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={t('projectMenu.deleteTitle', { name: project.name })}
      role="alertdialog"
      describedBy="delete-project-text"
      testId="delete-project"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="secondary" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary danger" aria-busy={busy} onClick={() => !busy && void remove()}>
            <Working busy={busy} idle={t('projectMenu.delete')} working={t('projectMenu.deleting')} />
          </button>
        </>
      }
    >
      <p id="delete-project-text">
        {isOpen
          ? t('projectMenu.deleteOpen')
          : t('projectMenu.deleteClosed')}
      </p>
      {error && <ErrorNote message={error} />}
    </Dialog>
  );
}

/** "6/10 printed" for a project card (lib/prints.ts); the plate count is missing on projects saved before it was kept. */
function printedText(printed: number, plates: number | null): string {
  if (plates === 1) return i18n.t('projectMenu.printed');
  return plates ? i18n.t('projectMenu.printedOf', { printed: Math.min(printed, plates), plates }) : i18n.t('projectMenu.printedPlates', { count: printed });
}

/** The top of Online projects: the newest project changed on another device. */
function ContinueRow({ list, onOpen }: { list: ProjectList; onOpen(p: OnlineProject): void }) {
  const { t } = useTranslation();
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
        <b>{t('continue.project', { name: proj.name })}</b>
        <span className="muted small">{t('continue.editedOn', { when: formatWhen(proj.updatedAt), device: yourDevice(proj.deviceName) })}</span>
      </div>
      <button className="primary" onClick={() => onOpen(proj)}>
        {t('continue.continue')}
      </button>
    </div>
  );
}

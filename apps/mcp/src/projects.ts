// The person's online projects (the site's Online projects window), for the AI
// app add-on: list them, open one, save to them, and their print history.
// The files live in the person's own Google Drive: like the page, the add-on
// gets a short Drive key from the site and downloads and uploads straight to
// Google (web/src/account/drive.ts), so a project never passes through Cloud
// Slicer. The site keeps the list, versions and print history (functions/_lib/
// projects.ts, prints.ts) and refuses a save over a newer one.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OnlineProject, ProjectList } from '../../web/src/account/api';
import { downloadFromDrive, setDriveKeySource, uploadToDrive } from '../../web/src/account/drive';
import { newProjectId, projectFileName } from '../../web/src/lib/projects';
import { statusWords, type PlateSummary, type PrintRecord } from '../../web/src/lib/prints';
import { ApiError, type Account } from './account';
import { pngOf } from './png';
import type { Slicer } from './slicer';

/** This computer, as a device editing a project (the site's "being edited on …"). */
const DEVICE = { id: `ai-app-${createHash('sha256').update(`${hostname()}:${homedir()}`).digest('hex').slice(0, 20)}`, name: 'AI app' };

export interface OpenProject {
  id: string;
  name: string;
  version: number;
}

/** A sliced plate of the open online project, so a send can go into its print history. */
export interface PlateOrigin {
  projectId: string;
  plate: number;
  fingerprint: string;
  summary: PlateSummary;
}

// Tests point Google Drive at a stand-in, as CLOUD_SLICER_SITE does for the site.
const GOOGLE = process.env.CLOUD_SLICER_GOOGLE?.replace(/\/+$/, '');
if (GOOGLE) {
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => real(typeof url === 'string' ? url.replace('https://www.googleapis.com', GOOGLE) : url, init);
}

const when = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');

export class OnlineProjects {
  /** The online project open in the add-on now, or null (a file from this computer, or nothing). */
  current: OpenProject | null = null;
  private dir = mkdtempSync(join(tmpdir(), 'cloud-slicer-projects-'));

  constructor(
    private readonly account: Account,
    private readonly slicer: Slicer,
  ) {
    setDriveKeySource(() => this.account.api<{ accessToken: string; expiresAt: number }>('/drive/token', { method: 'POST' }));
  }

  private async all(): Promise<ProjectList> {
    const list = await this.account.api<ProjectList>('/projects');
    if (!list.enabled) throw new Error('Online projects are turned off for this account.');
    return list;
  }

  /** The person's online projects, newest first. */
  async list() {
    const list = await this.all();
    return {
      ...(list.drive && !list.drive.connected && { note: 'Google Drive is not connected: connect it from the site\'s account menu to open or save projects.' }),
      projects: list.projects.map((p) => ({
        name: p.name,
        changed: when(p.updatedAt),
        engine: p.engine,
        ...(p.plates && { plates: p.plates }),
        ...(p.printedPlates && { printedPlates: p.printedPlates }),
        ...(p.deviceName && { editedOn: p.deviceName }),
        ...(this.current?.id === p.id && { openHere: true }),
      })),
    };
  }

  private async find(which: string | undefined): Promise<OnlineProject> {
    const { projects } = await this.all();
    if (!which) {
      const open = this.current && projects.find((p) => p.id === this.current!.id);
      if (open) return open;
      throw new Error('Say which project (from online_projects).');
    }
    const w = which.trim().toLowerCase();
    const exact = projects.filter((p) => p.id === which || p.name.toLowerCase() === w);
    const near = exact.length ? exact : projects.filter((p) => p.name.toLowerCase().includes(w));
    if (near.length === 1) return near[0];
    if (!near.length) throw new Error(`No online project called "${which}".`);
    throw new Error(`Say which: ${near.map((p) => p.name).join(', ')}.`);
  }

  /** Downloads the project from the person's Drive and opens it; the site's tab with it open only views it from now on. */
  async open(which: string) {
    const p = await this.find(which);
    await this.account.api(`/projects/${encodeURIComponent(p.id)}/device`, { method: 'POST', body: JSON.stringify({ device: DEVICE.id, deviceName: DEVICE.name }) }).catch(() => {});
    const latest = (await this.account.api<{ project: OnlineProject }>(`/projects/${encodeURIComponent(p.id)}`).catch(() => ({ project: p }))).project;
    let bytes: ArrayBuffer;
    try {
      bytes = await downloadFromDrive(latest.driveFile, undefined, latest.size);
    } catch (e) {
      throw new Error(`Couldn't download "${p.name}" from Google Drive: ${(e as Error).message}`);
    }
    const file = join(this.dir, projectFileName(p.name));
    writeFileSync(file, new Uint8Array(bytes));
    const opened = await this.slicer.open(file, { engine: latest.engine ?? 'snapmaker' });
    this.current = { id: p.id, name: p.name, version: latest.version };
    return opened;
  }

  /**
   * Saves what is open to the online projects: over the project it came from (refused when it
   * changed on the site meanwhile), or as a new one. `confirm` asks the person first.
   */
  async save(opts: { name?: string; asNew?: boolean }, confirm: (what: string) => Promise<boolean>) {
    if (!this.slicer.model) throw new Error('Open a model first.');
    const over = opts.asNew ? null : this.current;
    const name = (opts.name ?? over?.name ?? '').trim();
    if (!name) throw new Error('Give the project a name.');
    const what = over ? `Save the changes over the online project "${over.name}"` : `Save this as a new online project "${name}"`;
    if (!(await confirm(`${what}? It goes to your Google Drive (Cloud Slicer folder).`))) return { saved: false, note: 'The person said no; nothing was saved.' };
    const file = join(this.dir, `save-${Date.now()}.3mf`);
    await this.slicer.save(file);
    const bytes = readFileSync(file);
    rmSync(file, { force: true });
    const driveFile = await uploadToDrive(new Blob([bytes], { type: 'model/3mf' }), name);
    const id = over?.id ?? newProjectId();
    const q = new URLSearchParams({ drive: driveFile, name, engine: this.slicer.flavor, baseVersion: String(over?.version ?? 0), device: DEVICE.id, deviceName: DEVICE.name });
    const plates = this.slicer.model.plates.length;
    if (plates) q.set('plates', String(plates));
    let saved: OnlineProject;
    try {
      saved = (await this.account.api<{ project: OnlineProject }>(`/projects/${encodeURIComponent(id)}?${q}`, { method: 'PUT' })).project;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        throw new Error(`Not saved: "${over?.name ?? name}" was changed or opened elsewhere since. Save it as a new project, or open it again to get the latest.`);
      throw e;
    }
    // The list picture, as the page saves it; the project is saved even without it.
    const picture = await this.slicer.picture(0, 256).catch(() => null);
    if (picture) {
      await this.account
        .api(`/projects/${encodeURIComponent(id)}/thumbnail`, { method: 'PUT', body: new Uint8Array(pngOf(picture)), headers: { 'content-type': 'image/png' } })
        .catch(() => {});
    }
    this.current = { id: saved.id, name: saved.name, version: saved.version };
    return { saved: true, project: saved.name, version: saved.version };
  }

  /** A project's print history (default the open one), newest first. */
  async history(which?: string) {
    const p = await this.find(which);
    const { prints } = await this.account.api<{ prints: PrintRecord[] }>(`/projects/${encodeURIComponent(p.id)}/prints`);
    return {
      project: p.name,
      prints: prints
        .slice()
        .reverse()
        .map((r) => ({ plate: r.plate + 1, result: statusWords(r), at: when(r.at), ...(r.printerName && { printer: r.printerName }), ...(r.file && { file: r.file }) })),
    };
  }

  /** Records a send of a plate of an online project, as the page does after a send (state/prints.ts). */
  async recordSend(origin: PlateOrigin, printId: string, sent: { printer: string; printerName: string; file: string; started: boolean }) {
    await this.account
      .api(`/projects/${encodeURIComponent(origin.projectId)}/prints`, {
        method: 'POST',
        body: JSON.stringify({
          plate: origin.plate,
          id: printId,
          status: sent.started ? 'sent' : 'uploaded',
          printer: sent.printer,
          printerName: sent.printerName,
          file: sent.file,
          fingerprint: origin.fingerprint,
          summary: origin.summary,
        }),
      })
      .catch((e) => console.error('Print history not recorded:', (e as Error).message));
  }

  close() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

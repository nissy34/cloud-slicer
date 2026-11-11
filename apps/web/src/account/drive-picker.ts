// Open from Google Drive. Google's own file window (the Google Picker) runs in a
// small window of its own, public/drive-picker.html: the app's page is
// cross-origin isolated for the engine, which blocks Google's frames, and cuts
// the link to a window it opens. So that window answers over a
// BroadcastChannel, tagged with a one-time code so two tabs don't mix answers.
// Picking a file gives the app that one file under its drive.file permission;
// the app then downloads it like a project (account/drive.ts).
import { i18n } from '../i18n';
import { MODEL_EXTENSIONS } from '../lib/presets';
import { downloadFromDrive } from './drive';

export const PICKER_CHANNEL = 'cloud-slicer:drive-picker';
export const PICKER_PAGE = '/drive-picker.html';

/** A file picked in Google's window. */
export interface PickedFile {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes: number;
}

type Answer = { nonce: string; files?: PickedFile[]; cancelled?: boolean; error?: string };

/** Whether the app can open this file (by its name, as Drive often calls 3MF and STL files "octet-stream"). */
export const canOpen = (name: string) => MODEL_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

/**
 * Opens Google's file window and resolves with what was picked ([] when closed or cancelled).
 * Call it straight from the click: browsers only allow a new window from one.
 */
export function pickFromDrive(): Promise<PickedFile[]> {
  const nonce = crypto.randomUUID();
  const channel = new BroadcastChannel(PICKER_CHANNEL);
  const narrow = matchMedia('(max-width: 760px)').matches;
  const w = Math.min(1050, screen.availWidth - 40);
  const h = Math.min(700, screen.availHeight - 80);
  // A phone opens it as a tab; a computer as a window over the app.
  const features = narrow ? '' : `popup,width=${w},height=${h},left=${Math.round((screen.availWidth - w) / 2)},top=${Math.round((screen.availHeight - h) / 2)}`;
  const win = window.open(`${PICKER_PAGE}#${nonce}`, 'cloud-slicer-drive-picker', features);
  if (!win) {
    channel.close();
    return Promise.reject(new Error(i18n.t('accountErrors.pickerBlocked')));
  }
  return new Promise((resolve, reject) => {
    channel.onmessage = (e: MessageEvent<Answer>) => {
      if (e.data?.nonce !== nonce) return;
      channel.close();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data.files ?? []);
    };
  });
}

/**
 * The picked files as File objects the app opens like files from the device. Files the app can't open are left out
 * and named in `skipped`. `onProgress`: bytes so far of all of them (0 total when Drive doesn't say).
 */
export async function downloadPicked(
  picked: PickedFile[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ files: File[]; skipped: string[] }> {
  const wanted = picked.filter((p) => canOpen(p.name));
  const skipped = picked.filter((p) => !canOpen(p.name)).map((p) => p.name);
  const total = wanted.reduce((sum, p) => sum + p.sizeBytes, 0);
  let done = 0;
  const files: File[] = [];
  for (const p of wanted) {
    const bytes = await downloadFromDrive(p.id, (loaded) => onProgress?.(done + loaded, total), p.sizeBytes);
    done += bytes.byteLength;
    files.push(new File([bytes], p.name, { type: p.mimeType && p.mimeType !== 'application/octet-stream' ? p.mimeType : '' }));
  }
  return { files, skipped };
}

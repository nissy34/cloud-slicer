// Small rules for AutoSave and Continue on another device, kept apart from the
// state so they can be tested (state/projects.ts uses them).
import type { OnlineProject } from '../account/api';

/** Projects this big save less often: each AutoSave uploads the whole 3MF, on the person's own data. */
export const BIG_PROJECT_BYTES = 5 * 1024 * 1024;
/** Quiet time after the last change before AutoSave sends the project. */
export const QUIET_MS = 5_000;
/** The thumbnail is sent again at most this often (and on every Save). */
export const THUMBNAIL_EVERY_MS = 10 * 60_000;
/** The Continue card offers projects changed on another device within this long. */
export const CONTINUE_WITHIN_MS = 24 * 3600_000;

/** Least time between two AutoSaves of a project of `bytes` (its last saved size). */
export function autosaveGap(bytes: number): number {
  return bytes < BIG_PROJECT_BYTES ? 30_000 : 180_000;
}

/** How long to wait before AutoSave sends: QUIET_MS after the last change, and not sooner than the gap after the last save. */
export function autosaveDelay(now: number, lastChange: number, lastSave: number, bytes: number): number {
  return Math.max(0, lastChange + QUIET_MS - now, lastSave + autosaveGap(bytes) - now);
}

/** A name for this device people recognise: "phone", "iPad", "Windows computer"... */
export function deviceNameFrom(userAgent: string, maxTouchPoints = 0): string {
  const ua = userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'phone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'phone' : 'tablet';
  if (/Windows/.test(ua)) return 'Windows computer';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux computer';
  return 'other device';
}

export type ContinueOffer =
  /** The person's unsaved project, from this device or another. */
  | { kind: 'draft'; project: OnlineProject }
  /** A saved project last changed on another device. */
  | { kind: 'elsewhere'; project: OnlineProject };

/**
 * What the Continue card offers when the app opens with nothing loaded: the
 * draft if there is one, else the newest project changed on another device in
 * the last day. Projects last changed here aren't offered (they're one click
 * away in Online projects).
 */
export function continueOffer(projects: OnlineProject[], device: string, now = Date.now()): ContinueOffer | null {
  const draft = projects.find((p) => p.draft);
  if (draft) return { kind: 'draft', project: draft };
  const newest = [...projects].filter((p) => !p.draft).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (newest && newest.device && newest.device !== device && now - newest.updatedAt < CONTINUE_WITHIN_MS) return { kind: 'elsewhere', project: newest };
  return null;
}

/** "your phone", or "another device" when the name isn't known. */
export const yourDevice = (name: string | null | undefined) => (name ? `your ${name}` : 'another device');

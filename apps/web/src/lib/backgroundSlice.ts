/**
 * Slicing while the page is in the background (docs/architecture/background-slicing.md):
 * what the tab title says during a slice, and what the "slicing finished"
 * notification says. The parts that touch the browser are in state/backgroundSlice.ts.
 */
import { i18n } from '../i18n';

/** The tab title while slicing, so the progress shows in the tab strip and app switcher. */
export function slicingTitle(pct: number, title: string): string {
  return i18n.t('backgroundSlice.tabTitle', { pct: Math.max(0, Math.min(100, Math.round(pct))), title });
}

export type SliceEnd = { kind: 'done'; plate: number } | { kind: 'failed'; message: string } | { kind: 'question' };

/** The notification for a slice that ended while the page was hidden. */
export function endNotice(end: SliceEnd, plates: number): { title: string; body: string } {
  if (end.kind === 'done')
    return {
      title: i18n.t('backgroundSlice.doneTitle'),
      body: plates > 1 ? i18n.t('backgroundSlice.plateSliced', { plate: end.plate + 1 }) : i18n.t('backgroundSlice.tapToSee'),
    };
  if (end.kind === 'question') return { title: i18n.t('backgroundSlice.questionTitle'), body: i18n.t('backgroundSlice.questionBody') };
  const line = end.message.split('\n')[0].trim();
  return { title: i18n.t('backgroundSlice.failedTitle'), body: line.length > 140 ? `${line.slice(0, 139)}…` : line || i18n.t('backgroundSlice.tapToSeeWhy') };
}

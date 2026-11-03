/**
 * Slicing while the page is in the background (docs/architecture/background-slicing.md):
 * what the tab title says during a slice, and what the "slicing finished"
 * notification says. The parts that touch the browser are in state/backgroundSlice.ts.
 */

/** The tab title while slicing, so the progress shows in the tab strip and app switcher. */
export function slicingTitle(pct: number, title: string): string {
  return `${Math.max(0, Math.min(100, Math.round(pct)))}% · Slicing · ${title}`;
}

export type SliceEnd = { kind: 'done'; plate: number } | { kind: 'failed'; message: string } | { kind: 'question' };

/** The notification for a slice that ended while the page was hidden. */
export function endNotice(end: SliceEnd, plates: number): { title: string; body: string } {
  if (end.kind === 'done')
    return { title: 'Slicing done', body: plates > 1 ? `Plate ${end.plate + 1} is sliced. Tap to see it.` : 'Tap to see it.' };
  if (end.kind === 'question') return { title: 'Slicing needs you', body: 'It has a question before it can finish. Tap to answer.' };
  const line = end.message.split('\n')[0].trim();
  return { title: 'Slicing failed', body: line.length > 140 ? `${line.slice(0, 139)}…` : line || 'Tap to see why.' };
}

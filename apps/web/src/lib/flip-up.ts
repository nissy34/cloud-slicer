import { useLayoutEffect, useState, type RefObject } from 'react';

/** The nearest ancestor that scrolls (and so clips what hangs out of it), or null for the page. */
function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === 'auto' || y === 'scroll' || y === 'hidden') return p;
  }
  return null;
}

/**
 * Whether a pop-up hung below its anchor should open upward instead: true
 * when it doesn't fit below, within the window and whatever scrolls around it,
 * and there's more room above. Rechecked as the pop-up's size changes.
 */
export function useFlipUp(anchor: RefObject<HTMLElement>, pop: RefObject<HTMLElement>, open: boolean): boolean {
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    const a = anchor.current, p = pop.current;
    if (!open || !a || !p) return setUp(false);
    const check = () => {
      const box = a.getBoundingClientRect();
      const clip = scroller(a)?.getBoundingClientRect();
      const bottom = Math.min(window.innerHeight, clip?.bottom ?? Infinity);
      const top = Math.max(0, clip?.top ?? 0);
      const below = bottom - box.bottom, above = box.top - top;
      setUp(p.offsetHeight + 8 > below && above > below);
    };
    check();
    const watch = new ResizeObserver(check);
    watch.observe(p);
    return () => watch.disconnect();
  }, [anchor, pop, open]);
  return up;
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';

// Buttons whose title becomes a tip: every button, and anything that acts like one.
const TIPPED = 'button[title], [role="button"][title], a[title]';
const HOVER_MS = 400;
const PRESS_MS = 500;
const SHOWN_MS = 2000;

/** Takes a button's title while its tip shows, so the browser's own grey one stays away. */
function borrow(el: HTMLElement): string {
  const text = el.getAttribute('title') ?? '';
  el.removeAttribute('title');
  el.dataset.tip = text;
  // The title was its name to screen readers (and tests) if it had no other.
  if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) {
    el.setAttribute('aria-label', text);
    el.dataset.tipLabel = '';
  }
  return text;
}

function giveBack(el: HTMLElement) {
  const text = el.dataset.tip;
  if (text === undefined) return;
  // React may have set a new title meanwhile; that one wins.
  if (!el.hasAttribute('title')) el.setAttribute('title', text);
  if ('tipLabel' in el.dataset) el.removeAttribute('aria-label');
  delete el.dataset.tip;
  delete el.dataset.tipLabel;
}

/**
 * The app's one tooltip (docs/architecture/design-system.md): any button's
 * title, styled, after a short hover with a mouse, or on a long press on a
 * phone (the press then doesn't tap the button). Mounted once for the page.
 */
export function Tips() {
  const [tip, setTip] = useState<{ el: HTMLElement; text: string } | null>(null);
  const { refs, floatingStyles } = useFloating({
    elements: { reference: tip?.el ?? null },
    placement: 'top',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  useEffect(() => {
    let timer = 0;
    let hideTimer = 0;
    let shown: HTMLElement | null = null;
    let lastHidden = 0;
    let press: { el: HTMLElement; x: number; y: number } | null = null;
    let swallowClick = false;

    const show = (el: HTMLElement) => {
      if (!el.isConnected) return;
      const text = el.dataset.tip ?? borrow(el);
      if (!text) return;
      shown = el;
      setTip({ el, text });
    };
    const hide = () => {
      clearTimeout(timer);
      clearTimeout(hideTimer);
      if (shown) {
        giveBack(shown);
        shown = null;
        lastHidden = Date.now();
        setTip(null);
      }
    };
    const target = (e: Event) => (e.target instanceof Element ? (e.target.closest(TIPPED) as HTMLElement | null) : null);

    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = target(e);
      if (el === shown) return;
      hide();
      if (!el) return;
      // Moving along a row of buttons shows each tip straight away.
      const wait = Date.now() - lastHidden < 300 ? 0 : HOVER_MS;
      borrow(el);
      shown = el;
      timer = window.setTimeout(() => show(el), wait);
    };
    const out = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !shown) return;
      const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      if (!to || !shown.contains(to)) hide();
    };
    const down = (e: PointerEvent) => {
      hide();
      if (e.pointerType === 'mouse') return;
      const el = target(e);
      if (!el) return;
      press = { el, x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        if (!press) return;
        swallowClick = true;
        show(press.el);
        hideTimer = window.setTimeout(hide, SHOWN_MS);
      }, PRESS_MS);
    };
    const move = (e: PointerEvent) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) {
        press = null;
        if (!swallowClick) clearTimeout(timer);
      }
    };
    const up = () => {
      press = null;
      if (!swallowClick) clearTimeout(timer);
    };
    // A long press shows the tip; it doesn't also press the button or open the phone's menu.
    const click = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const context = (e: MouseEvent) => {
      if (swallowClick || (press && target(e))) e.preventDefault();
    };
    const away = () => hide();

    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('click', click, true);
    document.addEventListener('contextmenu', context, true);
    document.addEventListener('keydown', away, true);
    window.addEventListener('scroll', away, true);
    window.addEventListener('blur', away);
    return () => {
      hide();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('contextmenu', context, true);
      document.removeEventListener('keydown', away, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('blur', away);
    };
  }, []);

  // In the page's top layer, so a tip over a window's button isn't behind the window.
  const box = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (tip) box.current?.showPopover?.();
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={(el) => {
        // (React 18 doesn't know the popover attribute yet.)
        el?.setAttribute('popover', 'manual');
        box.current = el;
        refs.setFloating(el);
      }}
      className="tip"
      role="tooltip"
      style={floatingStyles}
    >
      {tip.text}
    </div>
  );
}

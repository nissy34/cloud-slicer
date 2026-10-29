import { useEffect, useRef } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { IconButton } from './IconButton';
import { SIDEBAR_DEFAULT, useSidebar } from '../state/sidebar';

/**
 * The sidebar's right edge: drag it to widen or narrow the sidebar, like
 * desktop Orca's. Double-click puts it back to the usual width; with the
 * keyboard, the arrow keys move it. Desktop only (phone.css hides it).
 */
export function SidebarResize() {
  const width = useSidebar((s) => s.width);
  const setWidth = useSidebar((s) => s.setWidth);
  const drag = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className="side-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        // From the width as drawn: the window may have capped the saved one.
        drag.current = { x: e.clientX, w: (e.currentTarget.previousElementSibling as HTMLElement | null)?.offsetWidth ?? width };
        e.currentTarget.classList.add('dragging');
      }}
      onPointerMove={(e) => drag.current && setWidth(drag.current.w + e.clientX - drag.current.x)}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.classList.remove('dragging');
      }}
      onPointerCancel={(e) => {
        drag.current = null;
        e.currentTarget.classList.remove('dragging');
      }}
      onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
        if (!step) return;
        e.preventDefault();
        setWidth(width + step);
      }}
    />
  );
}

/** Hide or show the sidebar, from the 3D view's top-left corner; Shift+Tab too, like desktop Orca's "Collapse sidebar". */
export function SidebarToggle() {
  const hidden = useSidebar((s) => s.hidden);
  const toggle = useSidebar((s) => s.toggle);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      // Only while nothing has the focus (or the 3D view has it): elsewhere
      // Shift+Tab keeps moving the focus back, as in any page.
      const t = document.activeElement;
      if (t && t !== document.body && !t.closest('.viewport')) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
  return (
    <IconButton
      className="side-toggle"
      icon={hidden ? PanelLeftOpen : PanelLeftClose}
      label={hidden ? 'Show sidebar (Shift+Tab)' : 'Hide sidebar (Shift+Tab)'}
      aria-expanded={!hidden}
      onClick={toggle}
    />
  );
}

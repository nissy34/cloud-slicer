import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PaintKind } from '../engine/protocol';
import { NO_COLOURS, useSlicer, type Tool } from '../state/store';
import { DEFAULT_PAINT, PaintPanel } from './PaintPanel';
import { ToolPanel } from './ToolPanel';

// Desktop Snapmaker Orca's toolbar icons (resources/images, AGPL-3.0 like this
// app). Their dark grey and teal become the page's text and accent colours.
const ICONS = import.meta.glob<string>('../assets/orca-toolbar/*.svg', { query: '?raw', import: 'default', eager: true });
const icon = (name: string) =>
  (ICONS[`../assets/orca-toolbar/${name}.svg`] ?? '')
    .replace(/#2b3436/gi, 'currentColor')
    .replace(/#009688/gi, 'var(--tool-accent)')
    .replace(/ width="40" height="40"/, '');

interface Item {
  id: string;
  icon: string;
  label: string;
  /** Desktop's keyboard shortcut, where this tool has one here too. */
  key?: string;
  /** Not in the web app yet: shown greyed out, like desktop greys out tools it can't use. */
  missing?: boolean;
  /** Works on the selected object. */
  needsSelection?: boolean;
  tool?: Tool;
  paint?: PaintKind;
}

// Desktop's order: undo and redo (on desktop they sit in the title bar), the
// plate toolbar, then the object gizmos, then the view.
const GROUPS: Item[][] = [
  [
    { id: 'undo', icon: 'topbar_undo', label: 'Undo', key: 'Ctrl+Z' },
    { id: 'redo', icon: 'topbar_redo', label: 'Redo', key: 'Ctrl+Y' },
  ],
  [
    { id: 'add', icon: 'toolbar_open', label: 'Add models', key: 'Ctrl+I' },
    { id: 'addplate', icon: 'toolbar_add_plate', label: 'Add plate' },
    { id: 'orient', icon: 'toolbar_orient', label: 'Auto orient', key: 'Q' },
    { id: 'arrange', icon: 'toolbar_arrange', label: 'Arrange all objects', key: 'A' },
    { id: 'splitobjects', icon: 'split_objects', label: 'Split to objects', needsSelection: true },
    { id: 'splitparts', icon: 'split_parts', label: 'Split to parts', needsSelection: true },
    { id: 'layers', icon: 'toolbar_variable_layer_height', label: 'Variable layer height', tool: 'layers', needsSelection: true },
  ],
  [
    { id: 'move', icon: 'toolbar_move', label: 'Move', key: 'M', tool: 'move', needsSelection: true },
    { id: 'rotate', icon: 'toolbar_rotate', label: 'Rotate', key: 'R', tool: 'rotate', needsSelection: true },
    { id: 'scale', icon: 'toolbar_scale', label: 'Scale', key: 'S', tool: 'scale', needsSelection: true },
    { id: 'flatten', icon: 'toolbar_flatten', label: 'Lay on face', key: 'F', tool: 'flatten', needsSelection: true },
    { id: 'cut', icon: 'toolbar_cut', label: 'Cut', key: 'C', tool: 'cut', needsSelection: true },
    { id: 'boolean', icon: 'toolbar_meshboolean', label: 'Mesh boolean', missing: true },
    { id: 'support', icon: 'toolbar_support', label: 'Support painting', key: 'L', paint: 'support' },
    { id: 'seam', icon: 'toolbar_seam', label: 'Seam painting', key: 'P', paint: 'seam' },
    { id: 'fuzzy', icon: 'toolbar_fuzzy_skin_paint', label: 'Fuzzy skin painting', key: 'H', paint: 'fuzzy' },
    { id: 'color', icon: 'mmu_segmentation', label: 'Colour painting', key: 'N', paint: 'color' },
    { id: 'text', icon: 'toolbar_text', label: 'Text shape', missing: true },
    { id: 'measure', icon: 'toolbar_measure', label: 'Measure', key: 'U', tool: 'measure' },
    { id: 'assembly', icon: 'toolbar_assembly', label: 'Assemble', missing: true },
    { id: 'brimears', icon: 'toolbar_brimears', label: 'Brim ears', missing: true },
  ],
  [{ id: 'assemblyview', icon: 'toolbar_assemble', label: 'Assembly view', missing: true }],
];
const ALL = GROUPS.flat();

/** The tool row over the 3D view, like desktop Orca's top toolbar. Scrolls sideways on a phone. */
export function Toolbar({ onAdd }: { onAdd(): void }) {
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  const selected = useSlicer((s) => s.selected);
  const tool = useSlicer((s) => s.tool);
  const paint = useSlicer((s) => s.paint);
  const colourCount = useSlicer((s) => (s.selection?.colours ?? NO_COLOURS).length);
  const history = useSlicer((s) => s.history);
  const onPlate = useMemo(() => project?.plates[plate]?.objects ?? [], [project, plate]);
  const bar = useRef<HTMLDivElement>(null);
  const svgs = useMemo(() => Object.fromEntries(ALL.map((i) => [i.id, icon(i.icon)])), []);

  // With nothing selected, the object tools work on the only object on the plate.
  const target =
    selected ??
    (onPlate.length === 1
      ? {
          object: onPlate[0],
          instance: Math.max(
            0,
            project!.objects[onPlate[0]].instances.findIndex((i) => i.plate === plate),
          ),
        }
      : null);

  const active = (item: Item) => (item.tool ? tool === item.tool : item.paint ? paint?.kind === item.paint : false);
  const disabled = (item: Item) =>
    item.id === 'undo' || item.id === 'redo'
      ? !history[item.id]
      : item.missing || (item.needsSelection && !target) || (!onPlate.length && item.id !== 'add' && item.id !== 'addplate');

  const run = (item: Item) => {
    if (disabled(item)) return;
    const s = useSlicer.getState();
    if (item.needsSelection && target && !selected) s.select(target);
    if (item.tool) return s.setTool(tool === item.tool ? null : item.tool);
    if (item.paint) {
      if (paint?.kind === item.paint) return void s.setPaint(null);
      const state = item.paint === 'color' ? Math.min(2, colourCount) : 1;
      return void s.setPaint({
        ...DEFAULT_PAINT,
        ...(paint ?? {}),
        kind: item.paint,
        state,
        tool: paint?.tool === 'bucket' && item.paint !== 'color' ? 'circle' : (paint?.tool ?? 'circle'),
      });
    }
    switch (item.id) {
      case 'undo':
        return void s.undo();
      case 'redo':
        return void s.redo();
      case 'add':
        return onAdd();
      case 'addplate':
        return void s.addPlate();
      case 'orient':
        return void s.orient(selected?.object);
      case 'arrange':
        return void s.arrange();
      case 'splitobjects':
        return void s.splitObject(target!.object);
      case 'splitparts':
        return void s.splitParts(target!.object);
    }
  };

  // Desktop's single-key shortcuts, while the 3D view (not a text field) has the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]') || e.altKey) return;
      // Ctrl+Shift+Z redoes too, and Cmd works for Ctrl on a Mac.
      const key = e.shiftKey && e.key.toUpperCase() === 'Z' ? 'Y' : e.key.toUpperCase();
      const combo = (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + key;
      const item = ALL.find((i) => i.key === combo && !i.missing);
      if (item) {
        e.preventDefault();
        run(item);
      } else if (e.key === 'Escape' && tool) useSlicer.getState().setTool(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <div className="toolbar" role="toolbar" aria-label="Object tools" ref={bar}>
        {GROUPS.map((group, g) => (
          <div className="toolbar-group" key={g}>
            {group.map((item) => {
              const off = disabled(item);
              const step = item.id === 'undo' || item.id === 'redo' ? history[item.id] : null;
              const title = item.missing
                ? `${item.label}: not in the web app yet`
                : `${item.label}${step ? ` ${step}` : ''}${item.key ? ` (${item.key})` : ''}${item.needsSelection && !target ? ': select an object first' : ''}`;
              return (
                <button
                  key={item.id}
                  className={active(item) ? 'tool on' : 'tool'}
                  aria-label={item.label}
                  aria-pressed={item.tool || item.paint ? active(item) : undefined}
                  aria-disabled={off || undefined}
                  data-missing={item.missing || undefined}
                  data-tool={item.id}
                  title={title}
                  onClick={() => run(item)}
                >
                  <span className="tool-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svgs[item.id] }} />
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {/* A tool without a button here (Simplify, from the object list) still gets the card. */}
      <ToolPopover bar={bar} anchor={ALL.find((i) => active(i))?.id ?? tool ?? null} />
    </>
  );
}

const PHONE = '(max-width: 760px)';

/** Whether the page has the phone layout (one column: 3D view, then the settings). */
function usePhone() {
  const [phone, setPhone] = useState(() => typeof matchMedia === 'function' && matchMedia(PHONE).matches);
  useEffect(() => {
    const q = matchMedia(PHONE);
    const on = () => setPhone(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return phone;
}

/**
 * The open tool's options in a card under its toolbar button, like desktop's
 * gizmo panels. On a phone the card goes right under the 3D view (the
 * sidebar's tool slot), so it never covers the plate.
 */
function ToolPopover({ bar, anchor }: { bar: React.RefObject<HTMLDivElement>; anchor: string | null }) {
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const phone = usePhone();
  const slot = phone ? document.getElementById('tool-slot') : null;

  // On a phone, bring the card into view under the 3D view when a tool opens.
  useEffect(() => {
    if (slot && anchor) pop.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [slot, anchor]);

  useLayoutEffect(() => {
    if (slot) return;
    const place = () => {
      const button = anchor && bar.current?.querySelector<HTMLElement>(`[data-tool="${anchor}"]`);
      const area = bar.current?.offsetParent?.getBoundingClientRect();
      if (!anchor || !area || !pop.current) return setAt(null);
      const width = pop.current.offsetWidth;
      // Under its button, or at the right of the view for a tool without one.
      const b = button ? button.getBoundingClientRect() : null;
      const left = b ? Math.min(Math.max(8, b.left - area.left + b.width / 2 - width / 2), area.width - width - 8) : area.width - width - 8;
      setAt({ left: Math.max(8, left), top: bar.current!.getBoundingClientRect().bottom - area.top + 6 });
    };
    place();
    const el = bar.current;
    el?.addEventListener('scroll', place);
    window.addEventListener('resize', place);
    return () => {
      el?.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [anchor, bar, slot]);

  if (!anchor) return null;
  if (slot)
    return createPortal(
      <div className="tool-pop docked" ref={pop}>
        <ToolPanel />
        <PaintPanel />
      </div>,
      slot,
    );
  return (
    <div className="tool-pop" ref={pop} style={at ? { left: at.left, top: at.top } : { visibility: 'hidden' }}>
      <ToolPanel />
      <PaintPanel />
    </div>
  );
}

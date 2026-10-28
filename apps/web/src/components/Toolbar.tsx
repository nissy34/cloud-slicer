import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePhone } from '../lib/usePhone';
import type { PaintKind } from '../engine/protocol';
import { sentence } from '../lib/format';
import { editKey, nudgeKey } from '../lib/transform';
import { NO_COLOURS, useSlicer, type Tool } from '../state/store';
import { DEFAULT_PAINT, PaintPanel } from './PaintPanel';
import { startText } from './TextPanel';
import { ToolPanel } from './ToolPanel';
import { Note } from './Note';

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
  /** More in its tooltip, after the key. */
  more?: string;
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
    { id: 'arrange', icon: 'toolbar_arrange', label: 'Arrange all objects', key: 'A', more: 'Shift+A: only this plate' },
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
    { id: 'boolean', icon: 'toolbar_meshboolean', label: 'Mesh boolean', tool: 'boolean', needsSelection: true },
    { id: 'support', icon: 'toolbar_support', label: 'Support painting', key: 'L', paint: 'support' },
    { id: 'seam', icon: 'toolbar_seam', label: 'Seam painting', key: 'P', paint: 'seam' },
    { id: 'fuzzy', icon: 'toolbar_fuzzy_skin_paint', label: 'Fuzzy skin painting', key: 'H', paint: 'fuzzy' },
    { id: 'color', icon: 'mmu_segmentation', label: 'Colour painting', key: 'N', paint: 'color' },
    { id: 'text', icon: 'toolbar_text', label: 'Text shape', key: 'T', tool: 'text' },
    { id: 'measure', icon: 'toolbar_measure', label: 'Measure', key: 'U', tool: 'measure' },
    { id: 'assembly', icon: 'toolbar_assembly', label: 'Assemble', tool: 'assemble' },
    { id: 'brimears', icon: 'toolbar_brimears', label: 'Brim ears', tool: 'brim', needsSelection: true },
  ],
  [{ id: 'assemblyview', icon: 'toolbar_assemble', label: 'Assembly view', missing: true }],
];
const ALL = GROUPS.flat();
// What works on several chosen objects at once; the other object tools need one.
const GROUP_TOOLS = new Set(['move', 'rotate', 'scale']);

/** The tool row over the 3D view, like desktop Orca's top toolbar. Scrolls sideways on a phone. */
export function Toolbar({ onAdd }: { onAdd(): void }) {
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  const selected = useSlicer((s) => s.selected);
  const several = useSlicer((s) => s.group.length > 1);
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
      : item.missing || (item.needsSelection && (several ? !GROUP_TOOLS.has(item.id) : !target)) || (!onPlate.length && item.id !== 'add' && item.id !== 'addplate' && item.id !== 'text');

  // Tools waiting for a model say so when tapped (a phone shows no tooltip).
  const needsModel = (item: Item) => !onPlate.length && !item.missing && item.id !== 'undo' && item.id !== 'redo' && disabled(item);

  const run = (item: Item) => {
    if (needsModel(item)) return useSlicer.setState({ notice: `${item.label} works on a model: open one first.`, noticeWarn: false });
    if (several && item.needsSelection && !GROUP_TOOLS.has(item.id))
      return useSlicer.setState({ notice: `${item.label} works on one model: pick just one.`, noticeWarn: false });
    if (disabled(item)) return;
    const s = useSlicer.getState();
    if (item.needsSelection && target && !selected) s.select(target);
    // Text, like desktop: edits the picked text, else adds one (to the picked object, or as an object).
    if (item.id === 'text' && tool !== 'text') {
      const v = selected?.volume !== undefined ? project?.objects[selected.object]?.volumes[selected.volume] : undefined;
      const lone = selected && project?.objects[selected.object]?.volumes.length === 1 ? project.objects[selected.object].volumes[0] : undefined;
      if (v?.text || lone?.text) return s.setTool('text');
      return void startText(selected?.object ?? null);
    }
    if (item.tool) return s.setTool(tool === item.tool ? null : item.tool);
    if (item.paint) {
      if (paint?.kind === item.paint) return void s.setPaint(null);
      const state = item.paint === 'color' ? Math.min(2, colourCount) : 1;
      return void s.setPaint({
        ...DEFAULT_PAINT,
        ...(paint ?? {}),
        kind: item.paint,
        state,
        tool: (paint?.tool === 'bucket' || paint?.tool === 'height') && item.paint !== 'color' ? 'circle' : (paint?.tool ?? 'circle'),
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
        return void (several ? s.groupAction({ op: 'orient' }) : s.orient(selected?.object));
      case 'arrange':
        return void s.arrange(true);
      case 'splitobjects':
        return void s.splitObject(target!.object);
      case 'splitparts':
        return void s.splitParts(target!.object);
    }
  };

  // Desktop's editing keys: Delete, Ctrl+C / Ctrl+X / Ctrl+V, Ctrl+K (clone) and + / - (a copy more or less).
  const runEdit = (edit: NonNullable<ReturnType<typeof editKey>>) => {
    const s = useSlicer.getState();
    if (edit === 'paste') return void s.paste();
    if (several) {
      if (edit === 'delete') return void s.groupAction({ op: 'delete' });
      if (edit === 'copy') return void s.groupAction({ op: 'copy' });
      if (edit === 'cut') return void s.groupAction({ op: 'cut' });
      if (edit === 'clone') {
        const box = bar.current?.getBoundingClientRect();
        return s.openGroupMenu({ x: box ? box.left + 8 : 16, y: box ? box.bottom + 8 : 80, form: 'clone' });
      }
      return;
    }
    if (!selected || !project?.objects[selected.object]?.instances[selected.instance]) return;
    const { object: o, instance: i, volume: v } = selected;
    const obj = project.objects[o];
    switch (edit) {
      case 'delete': {
        // A picked part goes (not the object's last one); else the picked copy, the object with its last.
        const vol = v !== undefined ? obj.volumes[v] : undefined;
        if (vol && (vol.kind !== 'part' || obj.volumes.filter((x) => x.kind === 'part').length > 1))
          return void s.volumeAction(o, { op: 'delete', volume: v! }, 'Delete part');
        return void (obj.instances.length > 1 ? s.removeInstance(o, i) : s.deleteObject(o));
      }
      case 'copy':
        return void s.copyToClipboard(o, i);
      case 'cut':
        return void s.cutToClipboard(o, i);
      case 'clone': {
        // Desktop's Ctrl+K asks how many copies: the object menu's Clone form, over the plate.
        const box = bar.current?.getBoundingClientRect();
        return s.openObjectMenu({ object: o, instance: i, x: box ? box.left + 8 : 16, y: box ? box.bottom + 8 : 80, form: 'clone' });
      }
      case 'addCopy':
        return void s.copyInstance(o, i);
      case 'removeCopy':
        if (obj.instances.length > 1) return void s.removeInstance(o, i);
    }
  };

  // Desktop's single-key shortcuts, while the 3D view (not a text field) has the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      // Typing goes to text boxes; a ticked checkbox or a slider keeps the shortcuts working.
      // A picker's list (components/Picker.tsx) takes keys like a <select> does.
      if (el.closest('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select, [role="combobox"], [role="listbox"], [contenteditable="true"]') || e.altKey) return;
      // Ctrl+Shift+Z redoes too, and Cmd works for Ctrl on a Mac.
      const key = e.shiftKey && e.key.toUpperCase() === 'Z' ? 'Y' : e.key.toUpperCase();
      const combo = (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + key;
      const item = ALL.find((i) => i.key === combo && !i.missing);
      const edit = editKey(e);
      const nudge = nudgeKey(e);
      const s = useSlicer.getState();
      if (nudge) {
        // Arrows on a slider or a list keep working there.
        if (el.closest('input, select, [role="slider"], [role="listbox"], [role="menu"]') || (!several && (!selected || selected.volume !== undefined))) return;
        e.preventDefault();
        void s.nudge(nudge);
      } else if (combo === 'Ctrl+A') {
        // Desktop's Select all: every object on this plate.
        if (!onPlate.length) return;
        e.preventDefault();
        s.selectAll();
      } else if (edit) {
        if (edit === 'paste' || selected || several) e.preventDefault();
        runEdit(edit);
      } else if (item?.id === 'arrange' && e.shiftKey) {
        // Desktop's Shift+A: arrange the objects on this plate only.
        e.preventDefault();
        void s.arrange();
      } else if (item) {
        e.preventDefault();
        run(item);
      } else if (combo === 'Ctrl+E') {
        // Desktop's Show labels.
        e.preventDefault();
        useSlicer.getState().setLabels(!useSlicer.getState().labels);
      } else if (e.key === 'Escape') {
        // Desktop's Esc: closes the open tool, then lets go of what is chosen.
        if (tool) s.setTool(null);
        // Esc closing a menu, pop-up or window leaves what is chosen alone.
        else if (s.groupMenu || s.objectMenu || s.plateMenu || el.closest('[role="dialog"], [role="menu"], .popover') || document.querySelector('[role="dialog"]')) return;
        else if (several || selected || s.choosing) {
          s.setChoosing(false);
          s.choose([]);
        }
      }
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
              const why = needsModel(item)
                ? ': add a model first'
                : several && item.needsSelection && !GROUP_TOOLS.has(item.id)
                  ? ': works on one model, pick just one'
                  : item.needsSelection && !target && !several
                    ? ': select an object first'
                    : '';
              const title = item.missing
                ? `${item.label}: not in the web app yet`
                : `${item.label}${step ? ` ${step}` : ''}${item.key ? ` (${item.key})` : ''}${item.more && !why ? ` · ${item.more}` : ''}${why}`;
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



/**
 * The open tool's options in a card at the left of the 3D view, like desktop's
 * gizmo panels. On a phone the card is docked between the toolbar and the 3D
 * view (the settings column hides until Done), so it never covers the plate.
 */
function ToolPopover({ bar, anchor }: { bar: React.RefObject<HTMLDivElement>; anchor: string | null }) {
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const docked = usePhone();

  // On a phone the column stops scrolling while a tool is open: put it back at
  // the top so the toolbar, the card and the 3D view are all on screen.
  useEffect(() => {
    if (docked && anchor) pop.current?.closest('.body')?.scrollTo({ top: 0 });
  }, [docked, anchor]);

  useLayoutEffect(() => {
    if (docked) return;
    const place = () => {
      const area = bar.current?.offsetParent?.getBoundingClientRect();
      if (!anchor || !area || !pop.current) return setAt(null);
      // At the left of the view under the toolbar, as desktop's tool panels
      // sit at the side, so the model in the middle stays in sight.
      setAt({ left: 8, top: bar.current!.getBoundingClientRect().bottom - area.top + 6 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, bar, docked]);

  if (!anchor) return null;
  return (
    <div className={docked ? 'tool-pop docked' : 'tool-pop'} ref={pop} style={docked ? undefined : at ? { left: at.left, top: at.top } : { visibility: 'hidden' }}>
      <ToolPanel />
      <PaintPanel />
      <ToolError />
    </div>
  );
}

/** A problem with the open tool, at the foot of its card (kept in view while the card scrolls). */
function ToolError() {
  const message = useSlicer((s) => (s.job.kind === 'error' && s.job.inTool ? s.job.message : ''));
  if (!message) return null;
  return (
    <Note tone="error" className="tool-error">
      {sentence(message)}
    </Note>
  );
}

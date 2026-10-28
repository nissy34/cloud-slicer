import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { menuPosition, unitConversions } from '../lib/objectMenu';
import { ALL } from '../lib/boolean';
import { ADD_MENUS, KIND_LABELS, keepsAPart, SHAPES, type VolumeKind } from '../lib/volumes';
import { NO_COLOURS, useSlicer } from '../state/store';
import { startSvg } from './SvgPanel';
import { startText } from './TextPanel';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Swatch } from './Swatch';
import { scrollMotion } from '../lib/motion';

type Sub = 'split' | 'mirror' | 'filament' | 'units' | 'type' | 'copies' | 'plate' | `add-${VolumeKind}` | null;
type Form = 'rename' | 'clone' | 'instances' | null;
/** Mesh files the engine reads as a part (Model::read_from_file). */
const MESH_FILES = '.stl,.obj,.3mf,.amf';

/**
 * Desktop Orca's right-click menu on an object (MenuFactory's object menu):
 * opened by a right click or a long press on the object in the 3D view, or
 * the ⋯ button in the object list. Submenus open in place, so it works the
 * same with a finger.
 */
export function ObjectMenu() {
  const menu = useSlicer((s) => s.objectMenu);
  const project = useSlicer((s) => s.project);
  const obj = menu ? project?.objects[menu.object] : undefined;
  const inst = menu && obj?.instances[menu.instance];
  if (!menu || !obj || !inst) return null;
  if (menu.volume !== undefined && !obj.volumes[menu.volume]) return null;
  return <MenuCard key={`${menu.object}-${menu.instance}-${menu.volume}-${menu.x}-${menu.y}`} />;
}

function MenuCard() {
  const menu = useSlicer((s) => s.objectMenu)!;
  const project = useSlicer((s) => s.project)!;
  const colours = useSlicer((s) => (s.palette.length ? s.palette : (s.selection?.colours ?? NO_COLOURS)));
  const physical = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const height = useSlicer((s) => Number(s.overrides.printable_height ?? s.baseConfig.printable_height) || 0);
  const plate = useSlicer((s) => s.plate);
  const copied = useSlicer((s) => s.copied);
  const s = useSlicer.getState();
  const { object: o, instance: i, volume: vi } = menu;
  const obj = project.objects[o];
  const inst = obj.instances[i];
  const vol = vi === undefined ? undefined : obj.volumes[vi];
  const parts = obj.volumes.map((v, k) => ({ v, k })).filter(({ v }) => v.kind === 'part');
  const card = useRef<HTMLDivElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const addType = useRef<VolumeKind>('part');
  const [sub, setSub] = useState<Sub>(null);
  const [form, setForm] = useState<Form>(menu.form ?? null);
  const [name, setName] = useState(vol ? vol.name : obj.name);
  const [count, setCount] = useState(1);
  const [arrange, setArrange] = useState(true);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  // A long press opens the menu under the finger; lifting it must not pick
  // the item that appeared there. Items work once a press starts on the menu.
  const armed = useRef(false);

  const close = () => s.openObjectMenu(null);
  const run = (f: () => unknown) => () => {
    close();
    void f();
  };

  // Closes on a press elsewhere or Escape, like any menu.
  useEffect(() => {
    const away = (e: PointerEvent) => !card.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
    };
  });

  // Stays on screen as submenus open.
  useLayoutEffect(() => {
    const el = card.current;
    if (el) setAt(menuPosition(menu.x, menu.y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight));
  }, [menu.x, menu.y, sub, form]);

  const item = (label: string, onClick: () => void, extra?: { checked?: boolean; disabled?: boolean; title?: string }) => (
    <button
      role={extra?.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={extra?.checked}
      className="menu-item"
      disabled={extra?.disabled}
      title={extra?.title}
      onClick={onClick}
    >
      {extra?.checked !== undefined && <span className="menu-check" aria-hidden="true">{extra.checked ? '✓' : ''}</span>}
      {label}
    </button>
  );
  const submenu = (id: Exclude<Sub, null>, label: string, children: ReactNode) => (
    <>
      <button role="menuitem" aria-haspopup="menu" aria-expanded={sub === id} className="menu-item submenu" onClick={() => setSub(sub === id ? null : id)}>
        {label}
        <span className="menu-arrow" aria-hidden="true">
          {sub === id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {sub === id && (
        <div role="menu" aria-label={label} className="menu-sub">
          {children}
        </div>
      )}
    </>
  );

  return (
    <div
      ref={card}
      className="menu object-menu"
      role="menu"
      aria-label={`${vol ? vol.name : obj.name || `Object ${o + 1}`} menu`}
      style={at ?? { left: menu.x, top: menu.y, visibility: 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDownCapture={() => (armed.current = true)}
      onKeyDownCapture={() => (armed.current = true)}
      onClickCapture={(e) => {
        if (armed.current) return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="menu-title" title={vol ? vol.name : obj.name}>
        {vol ? vol.name : obj.name || `Object ${o + 1}`}
        {vol && <span className="muted"> · {KIND_LABELS[vol.kind]}</span>}
      </div>
      {form === 'rename' ? (
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (vi !== undefined) run(() => s.volumeAction(o, { op: 'rename', volume: vi, name: name.trim() }, 'Rename'))();
            else run(() => s.objectAction(o, i, { op: 'rename', name: name.trim() }, 'Rename'))();
          }}
        >
          <label>
            Name
            <input aria-label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setForm(null)}>
              Back
            </button>
            <button type="submit" className="primary" disabled={!name.trim()}>
              Rename
            </button>
          </div>
        </form>
      ) : form === 'clone' ? (
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => s.cloneObject(o, count, arrange))();
          }}
        >
          <label>
            Number of copies
            <input aria-label="Number of copies" type="number" min={1} max={1000} value={count} autoFocus onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
          </label>
          <label className="menu-check-row">
            <input type="checkbox" checked={arrange} onChange={(e) => setArrange(e.target.checked)} />
            Arrange the plate after cloning
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setForm(null)}>
              Back
            </button>
            <button type="submit" className="primary">
              Clone
            </button>
          </div>
        </form>
      ) : form === 'instances' ? (
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => s.setInstanceCount(o, count))();
          }}
        >
          <label>
            Number of instances
            <input aria-label="Number of instances" type="number" min={1} max={1000} value={count} autoFocus onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setForm(null)}>
              Back
            </button>
            <button type="submit" className="primary">
              Set
            </button>
          </div>
        </form>
      ) : vol && vi !== undefined ? (
        <>
          {vol.text &&
            item('Edit text', run(() => {
              s.select({ object: o, instance: i, volume: vi });
              s.setTool('text');
            }), { title: 'Change the words, font or size' })}
          {vol.svg &&
            item('Edit SVG', run(() => {
              s.select({ object: o, instance: i, volume: vi });
              s.setTool('svg');
            }), { title: 'Change its depth or size' })}
          {item('Rename…', () => setForm('rename'))}
          {submenu(
            'type',
            'Change type',
            <>
              {ADD_MENUS.map(({ type }) => (
                <button
                  key={type}
                  role="menuitemradio"
                  aria-checked={vol.kind === type}
                  className="menu-item"
                  disabled={vol.kind !== type && type !== 'part' && !keepsAPart(obj.volumes, vi)}
                  onClick={run(() => vol.kind !== type && s.volumeAction(o, { op: 'type', volume: vi, type }, 'Change type'))}
                >
                  {KIND_LABELS[type]}
                </button>
              ))}
            </>,
          )}
          {(vol.kind === 'part' || vol.kind === 'modifier') &&
            submenu(
              'filament',
              'Change filament',
              <>
                {Array.from({ length: Math.max(physical, colours.length) }, (_, k) => (
                  <button key={k} role="menuitemradio" aria-checked={(vol.extruder || obj.extruder || 1) === k + 1} className="menu-item" onClick={run(() => s.setObjectFilament(o, vi, k + 1))}>
                    <Swatch colour={colours[k]} size="sm" />
                    {k < physical ? `Filament ${k + 1}` : `Mix ${k + 1}`}
                  </button>
                ))}
              </>,
            )}
          {vol.kind !== 'supportBlocker' &&
            vol.kind !== 'supportEnforcer' &&
            item(
              vol.kind === 'modifier' ? 'Modifier settings' : 'Part settings',
              run(() => {
                s.select({ object: o, instance: i, volume: vi });
                setTimeout(() => document.querySelector('.object-settings')?.scrollIntoView({ block: 'nearest', behavior: scrollMotion() }), 50);
              }),
              { title: vol.kind === 'modifier' ? 'Settings for where the modifier overlaps the object' : 'Settings for this part only' },
            )}
          <hr />
          {item('Delete', run(() => s.volumeAction(o, { op: 'delete', volume: vi }, 'Delete part')), {
            disabled: !keepsAPart(obj.volumes, vi),
            title: keepsAPart(obj.volumes, vi) ? undefined : 'An object keeps at least one part',
          })}
        </>
      ) : (
        <>
          {item(
            'Choose several',
            run(() => {
              s.setChoosing(true);
              s.choose([o]);
            }),
            { title: 'Then tap more models to choose them together, or drag on the plate for a rectangle (Ctrl+click and Shift+drag with a mouse)' },
          )}
          <hr />
          {ADD_MENUS.map(({ type, label }) => (
            <Fragment key={type}>
              {submenu(
                `add-${type}`,
                label,
                <>
                  {item('Load…', () => {
                    addType.current = type;
                    addInput.current?.click();
                  }, { title: 'A mesh file (STL, OBJ, 3MF)' })}
                  {SHAPES.map((shape) => (
                    <Fragment key={shape}>{item(shape, run(() => s.volumeAction(o, { op: 'add', type, shape, instance: i }, label)))}</Fragment>
                  ))}
                  {(type === 'part' || type === 'negative' || type === 'modifier') &&
                    item('Text', run(() => {
                      s.select({ object: o, instance: i });
                      return startText(o, type);
                    }), { title: 'Letters in a font, edited in the Text shape tool' })}
                  {(type === 'part' || type === 'negative' || type === 'modifier') &&
                    item('SVG…', run(() => {
                      s.select({ object: o, instance: i });
                      return startSvg(o, type);
                    }), { title: 'The paths of an .svg file, like a logo' })}
                </>,
              )}
            </Fragment>
          ))}
          <input
            ref={addInput}
            type="file"
            accept={MESH_FILES}
            hidden
            data-testid="add-part-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              const label = ADD_MENUS.find((m) => m.type === addType.current)!.label;
              if (file) run(() => s.volumeAction(o, { op: 'add', type: addType.current }, label, file))();
            }}
          />
          <hr />
          {item('Clone…', () => setForm('clone'), { title: 'Copies of this object, as new objects (Ctrl+K)' })}
          {item('Center', run(() => s.objectAction(o, i, { op: 'center' }, 'Center')), { title: 'Move it to the middle of its plate' })}
          {submenu(
            'split',
            'Split',
            <>
              {item('To objects', run(() => s.splitObject(o)))}
              {item('To parts', run(() => s.splitParts(o)))}
            </>,
          )}
          {submenu(
            'mirror',
            'Mirror',
            <>
              {item('Along X axis', run(() => s.mirror(o, i, 0)))}
              {item('Along Y axis', run(() => s.mirror(o, i, 1)))}
              {item('Along Z axis', run(() => s.mirror(o, i, 2)))}
            </>,
          )}
          {submenu(
            'copies',
            'Instances',
            <>
              {item('Add instance', run(() => s.copyInstance(o, i)), { title: 'One more copy of it, beside it (+)' })}
              {item('Remove instance', run(() => s.removeInstance(o, i)), {
                disabled: obj.instances.length < 2,
                title: obj.instances.length < 2 ? 'It has no other copies; Delete removes it' : 'Remove this copy, keeping the others (-)',
              })}
              {item('Set number of instances…', () => {
                setCount(obj.instances.length);
                setForm('instances');
              }, { title: `How many copies of it in all (now ${obj.instances.length})` })}
            </>,
          )}
          {submenu(
            'plate',
            'Move to plate',
            <>
              {project.plates.map((p, k) => (
                <Fragment key={k}>
                  {item(p.name ? `Plate ${k + 1}: ${p.name}` : `Plate ${k + 1}`, run(() => s.moveToPlate([{ object: o, instance: i }], k)), {
                    disabled: k === plate,
                    title: k === plate ? 'It is on this plate' : 'The same spot on that plate',
                  })}
                </Fragment>
              ))}
              {item('New plate', run(() => s.moveToPlate([{ object: o, instance: i }], 'new')), { title: 'A new plate after the last, with this on it' })}
            </>,
          )}
          <hr />
          {item('Copy', run(() => s.copyToClipboard(o, i)), { title: 'Paste makes it a new object (Ctrl+C)' })}
          {item('Cut', run(() => s.cutToClipboard(o, i)), { title: 'Copy it and remove it; Paste puts it back (Ctrl+X)' })}
          {item('Paste', run(() => s.paste()), { disabled: !copied, title: copied ? 'What you copied, as a new object (Ctrl+V)' : 'Copy or cut an object first' })}
          {item('Delete', run(() => s.deleteObject(o)), { title: obj.instances.length > 1 ? 'The object with all its copies' : 'Delete (Del)' })}
          <hr />
          {item('Auto orient', run(() => s.orientObject(o)))}
          {item(
            'Simplify model',
            run(() => {
              s.select({ object: o, instance: i });
              s.setTool('simplify');
            }),
            { title: 'Fewer triangles, keeping the shape' },
          )}
          {/* Joins all the object's parts into one (the toolbar's Mesh boolean works on two). */}
          {item(
            'Mesh boolean',
            run(() => {
              s.select({ object: o, instance: i });
              return s.meshBoolean(o, { op: 'union', a: obj.volumes.findIndex((v) => v.kind === 'part'), b: ALL });
            }),
            obj.volumes.filter((v) => v.kind === 'part').length < 2
              ? { disabled: true, title: 'It has only one part: add a part first' }
              : { title: 'Join all its parts into one part' },
          )}
          {item('Printable', run(() => s.objectAction(o, i, { op: 'printable', value: !inst.printable }, 'Printable')), { checked: inst.printable })}
          {item('Rename…', () => setForm('rename'))}
          {submenu(
            'filament',
            'Change filament',
            <>
              {Array.from({ length: Math.max(physical, colours.length) }, (_, k) => (
                <button key={k} role="menuitemradio" aria-checked={(obj.extruder || 1) === k + 1} className="menu-item" onClick={run(() => s.setObjectFilament(o, -1, k + 1))}>
                  <Swatch colour={colours[k]} size="sm" />
                  {k < physical ? `Filament ${k + 1}` : `Mix ${k + 1}`}
                </button>
              ))}
            </>,
          )}
          {item(
            'Object settings',
            run(() => {
              s.select({ object: o, instance: i });
              setTimeout(() => document.querySelector('.object-settings')?.scrollIntoView({ block: 'nearest', behavior: scrollMotion() }), 50);
            }),
            { title: 'Settings for this object only, on top of the process' },
          )}
          <hr />
          {item('Scale to fit the plate', run(() => s.objectAction(o, i, { op: 'scaleToFit', height }, 'Scale to fit')), {
            title: 'As large as the plate (and printer height) allows',
          })}
          {submenu(
            'units',
            'Units',
            <>
              {unitConversions(obj.units).map((c) => (
                <Fragment key={c.to}>{item(c.label, run(() => s.objectAction(o, i, { op: 'convert', to: c.to }, c.label)))}</Fragment>
              ))}
            </>,
          )}
          {item('Replace with STL…', () => replaceInput.current?.click(), {
            disabled: parts.length !== 1,
            title: parts.length === 1 ? 'Another mesh in its place' : 'Only for an object with one part',
          })}
          {item('Export as STL', run(() => s.exportStl(o, i)))}
          <input
            ref={replaceInput}
            type="file"
            accept=".stl,.obj"
            hidden
            data-testid="replace-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file && parts.length === 1) run(() => s.replaceWithStl(o, parts[0].k, file))();
            }}
          />
        </>
      )}
    </div>
  );
}

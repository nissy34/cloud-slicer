import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { menuPosition, unitConversions } from '../lib/objectMenu';
import { NO_COLOURS, useSlicer } from '../state/store';

type Sub = 'split' | 'mirror' | 'filament' | 'units' | null;
type Form = 'rename' | 'clone' | null;

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
  return <MenuCard key={`${menu.object}-${menu.instance}-${menu.x}-${menu.y}`} />;
}

function MenuCard() {
  const menu = useSlicer((s) => s.objectMenu)!;
  const project = useSlicer((s) => s.project)!;
  const colours = useSlicer((s) => (s.palette.length ? s.palette : (s.selection?.colours ?? NO_COLOURS)));
  const physical = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const height = useSlicer((s) => Number(s.overrides.printable_height ?? s.baseConfig.printable_height) || 0);
  const s = useSlicer.getState();
  const { object: o, instance: i } = menu;
  const obj = project.objects[o];
  const inst = obj.instances[i];
  const parts = obj.volumes.map((v, k) => ({ v, k })).filter(({ v }) => v.kind === 'part');
  const card = useRef<HTMLDivElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [sub, setSub] = useState<Sub>(null);
  const [form, setForm] = useState<Form>(null);
  const [name, setName] = useState(obj.name);
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
          {sub === id ? '▾' : '▸'}
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
      className="object-menu"
      role="menu"
      aria-label={`${obj.name || `Object ${o + 1}`} menu`}
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
      <div className="menu-title" title={obj.name}>
        {obj.name || `Object ${o + 1}`}
      </div>
      {form === 'rename' ? (
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) run(() => s.objectAction(o, i, { op: 'rename', name: name.trim() }, 'Rename'))();
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
      ) : (
        <>
          {item('Clone…', () => setForm('clone'), { title: 'Copies of this object, as new objects' })}
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
          {item('Delete', run(() => s.deleteObject(o)))}
          <hr />
          {item('Auto orient', run(() => s.orientObject(o)))}
          {item('Printable', run(() => s.objectAction(o, i, { op: 'printable', value: !inst.printable }, 'Printable')), { checked: inst.printable })}
          {item('Rename…', () => setForm('rename'))}
          {submenu(
            'filament',
            'Change filament',
            <>
              {Array.from({ length: Math.max(physical, colours.length) }, (_, k) => (
                <button key={k} role="menuitemradio" aria-checked={(obj.extruder || 1) === k + 1} className="menu-item" onClick={run(() => s.setObjectFilament(o, -1, k + 1))}>
                  <span className="menu-swatch" style={{ background: colours[k] }} aria-hidden="true" />
                  {k < physical ? `Filament ${k + 1}` : `Mix ${k + 1}`}
                </button>
              ))}
            </>,
          )}
          {item(
            'Object settings',
            run(() => {
              s.select({ object: o, instance: i });
              setTimeout(() => document.querySelector('.object-settings')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
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

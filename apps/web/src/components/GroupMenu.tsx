import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { itemsOnPlate } from '../lib/group';
import { menuPosition } from '../lib/objectMenu';
import { NO_COLOURS, useSlicer } from '../state/store';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Swatch } from './Swatch';

/**
 * Desktop Orca's right-click menu with several objects chosen (MenuFactory's
 * multi-selection menu): opened by a right click or a long press on a chosen
 * model. Everything in it works on all of them at once.
 */
export function GroupMenu() {
  const menu = useSlicer((s) => s.groupMenu);
  const group = useSlicer((s) => s.group);
  if (!menu || group.length < 2) return null;
  return <GroupCard key={`${menu.x}-${menu.y}`} />;
}

function GroupCard() {
  const menu = useSlicer((s) => s.groupMenu)!;
  const group = useSlicer((s) => s.group);
  const project = useSlicer((s) => s.project)!;
  const plate = useSlicer((s) => s.plate);
  const choosing = useSlicer((s) => s.choosing);
  const copied = useSlicer((s) => s.copied);
  const colours = useSlicer((s) => (s.palette.length ? s.palette : (s.selection?.colours ?? NO_COLOURS)));
  const physical = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const s = useSlicer.getState();
  const card = useRef<HTMLDivElement>(null);
  const [filaments, setFilaments] = useState(false);
  const [plates, setPlates] = useState(false);
  const [cloning, setCloning] = useState(menu.form === 'clone');
  const [count, setCount] = useState(1);
  const [arrange, setArrange] = useState(true);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  // A long press opens the menu under the finger; lifting it must not pick
  // the item that appeared there. Items work once a press starts on the menu.
  const armed = useRef(false);
  const items = itemsOnPlate(project, plate, group);
  const printable = items.every(({ object, instance }) => project.objects[object].instances[instance].printable);
  const extruders = new Set(group.map((o) => project.objects[o].extruder || 1));

  const close = () => s.openGroupMenu(null);
  const run = (f: () => unknown) => () => {
    close();
    void f();
  };

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

  useLayoutEffect(() => {
    const el = card.current;
    if (el) setAt(menuPosition(menu.x, menu.y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight));
  }, [menu.x, menu.y, filaments, plates, cloning]);

  const item = (label: string, onClick: () => void, extra?: { checked?: boolean; title?: string; danger?: boolean; disabled?: boolean }) => (
    <button
      role={extra?.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={extra?.checked}
      className={extra?.danger ? 'menu-item danger' : 'menu-item'}
      disabled={extra?.disabled}
      title={extra?.title}
      onClick={onClick}
    >
      {extra?.checked !== undefined && <span className="menu-check" aria-hidden="true">{extra.checked ? '✓' : ''}</span>}
      {label}
    </button>
  );

  return (
    <div
      ref={card}
      className="menu object-menu"
      role="menu"
      aria-label={`${group.length} objects menu`}
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
      <div className="menu-title">{group.length} objects</div>
      {cloning ? (
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => s.groupAction({ op: 'clone', count, arrange }))();
          }}
        >
          <label>
            Copies of each
            <input aria-label="Number of copies" type="number" min={1} max={1000} value={count} autoFocus onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
          </label>
          <label className="menu-check-row">
            <input type="checkbox" checked={arrange} onChange={(e) => setArrange(e.target.checked)} />
            Arrange the plate after cloning
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setCloning(false)}>
              Back
            </button>
            <button type="submit" className="primary">
              Clone
            </button>
          </div>
        </form>
      ) : (
        <>
          {item('Assemble', run(() => s.groupAction({ op: 'assemble' })), { title: 'Join them into one object, each part where it stands' })}
          <button role="menuitem" aria-haspopup="menu" aria-expanded={filaments} className="menu-item submenu" onClick={() => setFilaments(!filaments)}>
            Change filament
            <span className="menu-arrow" aria-hidden="true">
              {filaments ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>
          {filaments && (
            <div role="menu" aria-label="Change filament" className="menu-sub">
              {Array.from({ length: Math.max(physical, colours.length) }, (_, k) => (
                <button
                  key={k}
                  role="menuitemradio"
                  aria-checked={extruders.size === 1 && extruders.has(k + 1)}
                  className="menu-item"
                  onClick={run(() => s.groupAction({ op: 'filament', filament: k + 1 }))}
                >
                  <Swatch colour={colours[k]} size="sm" />
                  {k < physical ? `Filament ${k + 1}` : `Mix ${k + 1}`}
                </button>
              ))}
            </div>
          )}
          {item('Clone…', () => setCloning(true), { title: 'Copies of each of them, as new objects (Ctrl+K)' })}
          <button role="menuitem" aria-haspopup="menu" aria-expanded={plates} className="menu-item submenu" onClick={() => setPlates(!plates)}>
            Move to plate
            <span className="menu-arrow" aria-hidden="true">
              {plates ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>
          {plates && (
            <div role="menu" aria-label="Move to plate" className="menu-sub">
              {project.plates.map((p, k) => (
                <Fragment key={k}>
                  {item(p.name ? `Plate ${k + 1}: ${p.name}` : `Plate ${k + 1}`, run(() => s.groupAction({ op: 'moveToPlate', plate: k })), {
                    disabled: k === plate,
                    title: k === plate ? 'They are on this plate' : 'The same spots on that plate',
                  })}
                </Fragment>
              ))}
              {item('New plate', run(() => s.groupAction({ op: 'moveToPlate', plate: 'new' })), { title: 'A new plate after the last, with these on it' })}
            </div>
          )}
          <hr />
          {item('Copy', run(() => s.groupAction({ op: 'copy' })), { title: 'Paste makes them new objects, as far apart as now (Ctrl+C)' })}
          {item('Cut', run(() => s.groupAction({ op: 'cut' })), { title: 'Copy them and remove them; Paste puts them back (Ctrl+X)' })}
          {item('Paste', run(() => s.paste()), { disabled: !copied, title: copied ? 'What you copied, as new objects (Ctrl+V)' : 'Copy or cut objects first' })}
          <hr />
          {item('Center', run(() => s.groupAction({ op: 'center' })), { title: 'Move them together to the middle of the plate' })}
          {item('Arrange selection', run(() => s.groupAction({ op: 'arrange' })), { title: 'Each on a free spot, around the objects that stay put' })}
          {item('Auto orient', run(() => s.groupAction({ op: 'orient' })), { title: 'Turn each so it prints with the least overhang' })}
          {item('Printable', run(() => s.groupAction({ op: 'printable', value: !printable })), { checked: printable })}
          {item('Export as one STL', run(() => s.groupAction({ op: 'exportStl' })))}
          <hr />
          {choosing && item('Done choosing', run(() => s.setChoosing(false)), { title: 'Taps pick one model again' })}
          {item('Delete', run(() => s.groupAction({ op: 'delete' })), { title: 'Delete them all (Del)', danger: true })}
        </>
      )}
    </div>
  );
}

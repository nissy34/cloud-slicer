import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { menuPosition } from '../lib/objectMenu';
import { HANDY_MODELS } from '../lib/plateMenu';
import { SHAPES } from '../lib/volumes';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { startSvg } from './SvgPanel';
import { startText } from './TextPanel';

type Sub = 'primitive' | 'handy' | null;

/**
 * Desktop Orca's menus on the plate (MenuFactory::create_plate_menu) and on the
 * empty space around it (create_default_menu): opened by a right click or a
 * long press where there is no object. Items that need a model wait greyed out.
 */
export function PlateMenu({ onAdd }: { onAdd(): void }) {
  const menu = useSlicer((s) => s.plateMenu);
  if (!menu) return null;
  return <MenuCard key={`${menu.x}-${menu.y}`} onAdd={onAdd} />;
}

function MenuCard({ onAdd }: { onAdd(): void }) {
  const menu = useSlicer((s) => s.plateMenu)!;
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  const s = useSlicer.getState();
  const plates = project?.plates.length ?? 1;
  const name = project?.plates[plate]?.name ?? '';
  const empty = !project?.plates[plate]?.objects.length;
  const card = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<Sub>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(name);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  // A long press opens the menu under the finger; lifting it must not pick
  // the item that appeared there. Items work once a press starts on the menu.
  const armed = useRef(false);

  const close = () => s.openPlateMenu(null);
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
  }, [menu.x, menu.y, sub, renaming]);

  const item = (label: string, onClick: () => void, extra?: { disabled?: boolean; title?: string }) => (
    <button role="menuitem" className="menu-item" disabled={extra?.disabled} title={extra?.title} onClick={onClick}>
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

  // Desktop loads a handy model's geometry only, added to the plate.
  const addHandy = async (file: string) => {
    const res = await fetch(`${import.meta.env.BASE_URL}engine/handy_models/${file}`);
    if (!res.ok) return useSlicer.setState({ notice: `Couldn't fetch ${file} (${res.status}).`, noticeWarn: true });
    await useProjects.getState().openFiles([new File([await res.blob()], file)], 'geometry');
  };

  const needsModel = empty ? 'Nothing on this plate yet' : undefined;
  const title = menu.onPlate ? `Plate ${plate + 1}${name ? ` · ${name}` : ''}` : 'Add to the plate';
  return (
    <div
      ref={card}
      className="object-menu plate-menu"
      role="menu"
      aria-label={menu.onPlate ? 'Plate menu' : 'Add menu'}
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
      <div className="menu-title" title={title}>
        {title}
      </div>
      {renaming ? (
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => s.plateAction({ op: 'rename', name: newName.trim() }, 'Rename plate'))();
          }}
        >
          <label>
            Plate name
            <input aria-label="Plate name" value={newName} autoFocus placeholder="No name" onChange={(e) => setNewName(e.target.value)} />
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setRenaming(false)}>
              Back
            </button>
            <button type="submit" className="primary">
              Rename
            </button>
          </div>
        </form>
      ) : (
        <>
          {menu.onPlate && (
            <>
              {item('Arrange', run(() => s.arrange()), { disabled: empty, title: needsModel ?? 'Lay out the objects on this plate' })}
              {item('Auto orient', run(() => s.orient()), { disabled: empty, title: needsModel ?? 'Turn every object on this plate to print with the least overhang' })}
              {item('Delete all', run(() => s.plateAction({ op: 'deleteAll' }, 'Delete all')), { disabled: empty, title: needsModel ?? 'Delete every object on this plate' })}
              {item('Delete plate', run(() => s.deletePlate()), {
                disabled: plates < 2,
                title: plates < 2 ? 'The only plate stays' : 'Delete this plate and what is on it',
              })}
              {item('Rename plate…', () => setRenaming(true), { title: 'Shown on the plate tabs and saved in the project' })}
              <hr />
            </>
          )}
          {submenu(
            'primitive',
            'Add primitive',
            <>
              {SHAPES.map((shape) => (
                <Fragment key={shape}>{item(shape, run(() => s.plateAction({ op: 'addShape', shape }, 'Add primitive')))}</Fragment>
              ))}
              {item('Text', run(() => startText(null)), { title: 'Letters in a font, edited in the Text shape tool' })}
              {item('SVG…', run(() => startSvg(null)), { title: 'The paths of an .svg file, like a logo' })}
            </>,
          )}
          {submenu(
            'handy',
            'Add handy models',
            <>
              {HANDY_MODELS.map((m) => (
                <Fragment key={m.file}>{item(m.label, run(() => addHandy(m.file)))}</Fragment>
              ))}
            </>,
          )}
          {item('Add models…', run(onAdd), { title: 'STL, 3MF, OBJ, STEP or SVG files from this device' })}
        </>
      )}
    </div>
  );
}

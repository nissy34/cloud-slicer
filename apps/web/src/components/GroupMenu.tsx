import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { itemsOnPlate } from '../lib/group';
import { menuPosition } from '../lib/objectMenu';
import { NO_COLOURS, useSlicer } from '../state/store';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Swatch } from './Swatch';
import { filamentChoices } from '../lib/filament-choices';

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
  const { t } = useTranslation();
  const menu = useSlicer((s) => s.groupMenu)!;
  const group = useSlicer((s) => s.group);
  const project = useSlicer((s) => s.project)!;
  const plate = useSlicer((s) => s.plate);
  const choosing = useSlicer((s) => s.choosing);
  const copied = useSlicer((s) => s.copied);
  const colours = useSlicer((s) => (s.palette.length ? s.palette : (s.selection?.colours ?? NO_COLOURS)));
  const physical = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const presets = useSlicer((s) => s.selection?.filaments ?? NO_COLOURS);
  // The rows every filament picker shows: numbered square, then the preset's name.
  const filamentRows = filamentChoices(colours, presets, physical);
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
      aria-label={t('groupMenu.menu', { count: group.length })}
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
      <div className="menu-title">{t('groupMenu.objects', { count: group.length })}</div>
      {cloning ? (
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => s.groupAction({ op: 'clone', count, arrange }))();
          }}
        >
          <label>
            {t('groupMenu.copiesOfEach')}
            <input aria-label={t('groupMenu.copiesCount')} type="number" min={1} max={1000} value={count} autoFocus onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
          </label>
          <label className="menu-check-row">
            <input type="checkbox" checked={arrange} onChange={(e) => setArrange(e.target.checked)} />
            {t('groupMenu.arrangeAfterClone')}
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setCloning(false)}>
              {t('groupMenu.back')}
            </button>
            <button type="submit" className="primary">
              {t('groupMenu.clone')}
            </button>
          </div>
        </form>
      ) : (
        <>
          {item(t('groupMenu.assemble'), run(() => s.groupAction({ op: 'assemble' })), { title: t('groupMenu.assembleTip') })}
          <button role="menuitem" aria-haspopup="menu" aria-expanded={filaments} className="menu-item submenu" onClick={() => setFilaments(!filaments)}>
            {t('groupMenu.changeFilament')}
            <span className="menu-arrow" aria-hidden="true">
              {filaments ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>
          {filaments && (
            <div role="menu" aria-label={t('groupMenu.changeFilament')} className="menu-sub">
              {filamentRows.map((f, k) => (
                <button
                  key={k}
                  role="menuitemradio"
                  aria-checked={extruders.size === 1 && extruders.has(k + 1)}
                  className="menu-item"
                  onClick={run(() => s.groupAction({ op: 'filament', filament: k + 1 }))}
                >
                  <Swatch colour={f.swatch} number={f.swatchNumber} />
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {item(t('groupMenu.cloneMenu'), () => setCloning(true), { title: t('groupMenu.cloneTip') })}
          <button role="menuitem" aria-haspopup="menu" aria-expanded={plates} className="menu-item submenu" onClick={() => setPlates(!plates)}>
            {t('groupMenu.moveToPlate')}
            <span className="menu-arrow" aria-hidden="true">
              {plates ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>
          {plates && (
            <div role="menu" aria-label={t('groupMenu.moveToPlate')} className="menu-sub">
              {project.plates.map((p, k) => (
                <Fragment key={k}>
                  {item(p.name ? t('groupMenu.plateNamed', { n: k + 1, name: p.name }) : t('groupMenu.plateN', { n: k + 1 }), run(() => s.groupAction({ op: 'moveToPlate', plate: k })), {
                    disabled: k === plate,
                    title: k === plate ? t('groupMenu.onThisPlate') : t('groupMenu.sameSpots'),
                  })}
                </Fragment>
              ))}
              {item(t('groupMenu.newPlate'), run(() => s.groupAction({ op: 'moveToPlate', plate: 'new' })), { title: t('groupMenu.newPlateTip') })}
            </div>
          )}
          <hr />
          {item(t('groupMenu.copy'), run(() => s.groupAction({ op: 'copy' })), { title: t('groupMenu.copyTip') })}
          {item(t('groupMenu.cut'), run(() => s.groupAction({ op: 'cut' })), { title: t('groupMenu.cutTip') })}
          {item(t('groupMenu.paste'), run(() => s.paste()), { disabled: !copied, title: copied ? t('groupMenu.pasteTip') : t('groupMenu.copyFirst') })}
          <hr />
          {item(t('groupMenu.center'), run(() => s.groupAction({ op: 'center' })), { title: t('groupMenu.centerTip') })}
          {item(t('groupMenu.arrange'), run(() => s.groupAction({ op: 'arrange' })), { title: t('groupMenu.arrangeTip') })}
          {item(t('groupMenu.autoOrient'), run(() => s.groupAction({ op: 'orient' })), { title: t('groupMenu.autoOrientTip') })}
          {item(t('groupMenu.printable'), run(() => s.groupAction({ op: 'printable', value: !printable })), { checked: printable })}
          {item(t('groupMenu.exportStl'), run(() => s.groupAction({ op: 'exportStl' })))}
          <hr />
          {choosing && item(t('groupMenu.doneChoosing'), run(() => s.setChoosing(false)), { title: t('groupMenu.doneChoosingTip') })}
          {item(t('groupMenu.delete'), run(() => s.groupAction({ op: 'delete' })), { title: t('groupMenu.deleteTip'), danger: true })}
        </>
      )}
    </div>
  );
}

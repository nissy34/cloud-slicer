import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { menuPosition } from '../lib/objectMenu';
import { HANDY_MODELS } from '../lib/plateMenu';
import { shapeLabel, SHAPES } from '../lib/volumes';
import { usePlateMarks, usePrints } from '../state/prints';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { NO_HISTORY, useHistoryAvailable } from './PrintHistory';
import { startSvg } from './SvgPanel';
import { startText } from './TextPanel';
import { ChevronDown, ChevronRight } from 'lucide-react';

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
  const { t } = useTranslation();
  const menu = useSlicer((s) => s.plateMenu)!;
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  const labels = useSlicer((s) => s.labels);
  const copied = useSlicer((s) => s.copied);
  const s = useSlicer.getState();
  const plates = project?.plates.length ?? 1;
  const name = project?.plates[plate]?.name ?? '';
  const empty = !project?.plates[plate]?.objects.length;
  const history = useHistoryAvailable();
  const mark = usePlateMarks()[plate];
  const printedNow = history && (mark?.state === 'printed' || mark?.state === 'changed');
  const locked = !!project?.plates[plate]?.locked;
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

  // Desktop loads a handy model's geometry only, added to the plate.
  const addHandy = async (file: string) => {
    const res = await fetch(`${import.meta.env.BASE_URL}engine/handy_models/${file}`);
    if (!res.ok) return useSlicer.setState({ notice: t('plateMenu.fetchFailed', { file, status: res.status }), noticeWarn: true });
    await useProjects.getState().openFiles([new File([await res.blob()], file)], 'geometry');
  };

  const needsModel = empty ? t('plateMenu.nothingYet') : undefined;
  const lockedTitle = locked ? t('plateMenu.lockedTip') : undefined;
  const title = menu.onPlate ? (name ? t('plateMenu.plateNamed', { n: plate + 1, name }) : t('plateMenu.plateN', { n: plate + 1 })) : t('plateMenu.addToPlate');
  return (
    <div
      ref={card}
      className="menu object-menu plate-menu"
      role="menu"
      aria-label={menu.onPlate ? t('plateMenu.plateMenu') : t('plateMenu.addMenu')}
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
            run(() => s.plateAction({ op: 'rename', name: newName.trim() }, t('plateMenu.renamePlateUndo')))();
          }}
        >
          <label>
            {t('plateMenu.plateName')}
            <input aria-label={t('plateMenu.plateName')} value={newName} autoFocus placeholder={t('plateMenu.noName')} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setRenaming(false)}>
              {t('plateMenu.back')}
            </button>
            <button type="submit" className="primary">
              {t('plateMenu.rename')}
            </button>
          </div>
        </form>
      ) : (
        <>
          {menu.onPlate && (
            <>
              {item(t('plateMenu.selectAll'), run(() => s.selectAll()), { disabled: empty, title: needsModel ?? t('plateMenu.selectAllTip') })}
              {item(t('plateMenu.arrange'), run(() => s.arrange()), { disabled: empty || locked, title: needsModel ?? lockedTitle ?? t('plateMenu.arrangeTip') })}
              {item(t('plateMenu.autoOrient'), run(() => s.orient()), {
                disabled: empty || locked,
                title: needsModel ?? lockedTitle ?? t('plateMenu.autoOrientTip'),
              })}
              {item(t('plateMenu.deleteAll'), run(() => s.plateAction({ op: 'deleteAll' }, t('plateMenu.deleteAll'))), { disabled: empty, title: needsModel ?? t('plateMenu.deleteAllTip') })}
              {item(t('plateMenu.deletePlate'), run(() => s.deletePlate()), {
                disabled: plates < 2,
                title: plates < 2 ? t('plateMenu.onlyPlate') : t('plateMenu.deletePlateTip'),
              })}
              {item(t('plateMenu.plateSettings'), () => s.openPlateSettings(true), { title: t('plateMenu.plateSettingsTip') })}
              {item(t('plateMenu.renamePlate'), () => setRenaming(true), { title: t('plateMenu.renamePlateTip') })}
              {item(locked ? t('plateMenu.unlock') : t('plateMenu.lock'), run(() => s.lockPlate(!locked)), {
                title: locked ? t('plateMenu.unlockTip') : t('plateMenu.lockTip'),
              })}
              {printedNow
                ? item(t('plateMenu.markNotPrinted'), run(() => usePrints.getState().unmark(plate)), { title: t('plateMenu.markNotPrintedTip') })
                : item(t('plateMenu.markPrinted'), run(() => usePrints.getState().mark(plate)), {
                    disabled: !history || empty,
                    title: !history ? NO_HISTORY : (needsModel ?? t('plateMenu.markPrintedTip')),
                  })}
              {item(t('plateMenu.printHistory'), run(() => usePrints.getState().openHistory(plate)), {
                disabled: !history,
                title: history ? t('plateMenu.printHistoryTip') : NO_HISTORY,
              })}
              <hr />
            </>
          )}
          {submenu(
            'primitive',
            t('plateMenu.addPrimitive'),
            <>
              {SHAPES.map((shape) => (
                <Fragment key={shape}>{item(shapeLabel(shape), run(() => s.plateAction({ op: 'addShape', shape }, t('plateMenu.addPrimitive'))))}</Fragment>
              ))}
              {item(t('plateMenu.text'), run(() => startText(null)), { title: t('plateMenu.textTip') })}
              {item(t('plateMenu.svg'), run(() => startSvg(null)), { title: t('plateMenu.svgTip') })}
            </>,
          )}
          {submenu(
            'handy',
            t('plateMenu.addHandy'),
            <>
              {HANDY_MODELS.map((m) => (
                <Fragment key={m.file}>{item(m.label, run(() => addHandy(m.file)))}</Fragment>
              ))}
            </>,
          )}
          {item(t('plateMenu.addModels'), run(onAdd), { title: t('plateMenu.addModelsTip') })}
          {item(t('plateMenu.paste'), run(() => s.paste()), { disabled: !copied, title: copied ? t('plateMenu.pasteTip') : t('plateMenu.copyFirst') })}
          <hr />
          <button role="menuitemcheckbox" aria-checked={labels} className="menu-item" title={t('plateMenu.showLabelsTip')} onClick={run(() => s.setLabels(!labels))}>
            <span className="menu-check" aria-hidden="true">
              {labels ? '✓' : ''}
            </span>
            {t('plateMenu.showLabels')}
          </button>
        </>
      )}
    </div>
  );
}

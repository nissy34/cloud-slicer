import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { menuPosition, unitConversions } from '../lib/objectMenu';
import { ALL } from '../lib/boolean';
import { ADD_MENUS, kindLabel, keepsAPart, shapeLabel, SHAPES, type VolumeKind } from '../lib/volumes';
import { NO_COLOURS, useSlicer } from '../state/store';
import { startSvg } from './SvgPanel';
import { startText } from './TextPanel';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Swatch } from './Swatch';
import { filamentChoices } from '../lib/filament-choices';
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
  const { t } = useTranslation();
  const menu = useSlicer((s) => s.objectMenu)!;
  const project = useSlicer((s) => s.project)!;
  const colours = useSlicer((s) => (s.palette.length ? s.palette : (s.selection?.colours ?? NO_COLOURS)));
  const physical = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const presets = useSlicer((s) => s.selection?.filaments ?? NO_COLOURS);
  // The rows every filament picker shows: numbered square, then the preset's name.
  const filamentRows = filamentChoices(colours, presets, physical);
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
      aria-label={t('objectMenu.menuOf', { name: vol ? vol.name : obj.name || t('objectMenu.objectN', { n: o + 1 }) })}
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
        {vol ? vol.name : obj.name || t('objectMenu.objectN', { n: o + 1 })}
        {vol && <span className="muted"> · {kindLabel(vol.kind)}</span>}
      </div>
      {form === 'rename' ? (
        <form
          className="menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            if (vi !== undefined) run(() => s.volumeAction(o, { op: 'rename', volume: vi, name: name.trim() }, t('objectMenu.rename')))();
            else run(() => s.objectAction(o, i, { op: 'rename', name: name.trim() }, t('objectMenu.rename')))();
          }}
        >
          <label>
            {t('objectMenu.name')}
            <input aria-label={t('objectMenu.name')} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setForm(null)}>
              {t('objectMenu.back')}
            </button>
            <button type="submit" className="primary" disabled={!name.trim()}>
              {t('objectMenu.rename')}
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
            {t('objectMenu.copiesCount')}
            <input aria-label={t('objectMenu.copiesCount')} type="number" min={1} max={1000} value={count} autoFocus onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
          </label>
          <label className="menu-check-row">
            <input type="checkbox" checked={arrange} onChange={(e) => setArrange(e.target.checked)} />
            {t('objectMenu.arrangeAfterClone')}
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setForm(null)}>
              {t('objectMenu.back')}
            </button>
            <button type="submit" className="primary">
              {t('objectMenu.clone')}
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
            {t('objectMenu.instancesCount')}
            <input aria-label={t('objectMenu.instancesCount')} type="number" min={1} max={1000} value={count} autoFocus onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
          </label>
          <div className="menu-form-actions">
            <button type="button" className="ghost" onClick={() => setForm(null)}>
              {t('objectMenu.back')}
            </button>
            <button type="submit" className="primary">
              {t('objectMenu.set')}
            </button>
          </div>
        </form>
      ) : vol && vi !== undefined ? (
        <>
          {vol.text &&
            item(t('objectMenu.editText'), run(() => {
              s.select({ object: o, instance: i, volume: vi });
              s.setTool('text');
            }), { title: t('objectMenu.editTextTip') })}
          {vol.svg &&
            item(t('objectMenu.editSvg'), run(() => {
              s.select({ object: o, instance: i, volume: vi });
              s.setTool('svg');
            }), { title: t('objectMenu.editSvgTip') })}
          {item(t('objectMenu.renameMenu'), () => setForm('rename'))}
          {submenu(
            'type',
            t('objectMenu.changeType'),
            <>
              {ADD_MENUS.map(({ type }) => (
                <button
                  key={type}
                  role="menuitemradio"
                  aria-checked={vol.kind === type}
                  className="menu-item"
                  disabled={vol.kind !== type && type !== 'part' && !keepsAPart(obj.volumes, vi)}
                  onClick={run(() => vol.kind !== type && s.volumeAction(o, { op: 'type', volume: vi, type }, t('objectMenu.changeType')))}
                >
                  {kindLabel(type)}
                </button>
              ))}
            </>,
          )}
          {(vol.kind === 'part' || vol.kind === 'modifier') &&
            submenu(
              'filament',
              t('objectMenu.changeFilament'),
              <>
                {filamentRows.map((f, k) => (
                  <button key={k} role="menuitemradio" aria-checked={(vol.extruder || obj.extruder || 1) === k + 1} className="menu-item" onClick={run(() => s.setObjectFilament(o, vi, k + 1))}>
                    <Swatch colour={f.swatch} number={f.swatchNumber} />
                    {f.label}
                  </button>
                ))}
              </>,
            )}
          {vol.kind !== 'supportBlocker' &&
            vol.kind !== 'supportEnforcer' &&
            item(
              vol.kind === 'modifier' ? t('objectMenu.modifierSettings') : t('objectMenu.partSettings'),
              run(() => {
                s.select({ object: o, instance: i, volume: vi });
                setTimeout(() => document.querySelector('.object-settings')?.scrollIntoView({ block: 'nearest', behavior: scrollMotion() }), 50);
              }),
              { title: vol.kind === 'modifier' ? t('objectMenu.modifierSettingsTip') : t('objectMenu.partSettingsTip') },
            )}
          <hr />
          {item(t('objectMenu.delete'), run(() => s.volumeAction(o, { op: 'delete', volume: vi }, t('objectMenu.deletePart'))), {
            disabled: !keepsAPart(obj.volumes, vi),
            title: keepsAPart(obj.volumes, vi) ? undefined : t('objectMenu.keepsAPart'),
          })}
        </>
      ) : (
        <>
          {item(
            t('objectMenu.chooseSeveral'),
            run(() => {
              s.setChoosing(true);
              s.choose([o]);
            }),
            { title: t('objectMenu.chooseSeveralTip') },
          )}
          <hr />
          {ADD_MENUS.map(({ type, label }) => (
            <Fragment key={type}>
              {submenu(
                `add-${type}`,
                t(label),
                <>
                  {item(t('objectMenu.load'), () => {
                    addType.current = type;
                    addInput.current?.click();
                  }, { title: t('objectMenu.loadTip') })}
                  {SHAPES.map((shape) => (
                    <Fragment key={shape}>{item(shapeLabel(shape), run(() => s.volumeAction(o, { op: 'add', type, shape, instance: i }, t(label))))}</Fragment>
                  ))}
                  {(type === 'part' || type === 'negative' || type === 'modifier') &&
                    item(t('objectMenu.text'), run(() => {
                      s.select({ object: o, instance: i });
                      return startText(o, type);
                    }), { title: t('objectMenu.textTip') })}
                  {(type === 'part' || type === 'negative' || type === 'modifier') &&
                    item(t('objectMenu.svg'), run(() => {
                      s.select({ object: o, instance: i });
                      return startSvg(o, type);
                    }), { title: t('objectMenu.svgTip') })}
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
              if (file) run(() => s.volumeAction(o, { op: 'add', type: addType.current }, t(label), file))();
            }}
          />
          <hr />
          {item(t('objectMenu.cloneMenu'), () => setForm('clone'), { title: t('objectMenu.cloneTip') })}
          {item(t('objectMenu.center'), run(() => s.objectAction(o, i, { op: 'center' }, t('objectMenu.center'))), { title: t('objectMenu.centerTip') })}
          {submenu(
            'split',
            t('objectMenu.split'),
            <>
              {item(t('objectMenu.toObjects'), run(() => s.splitObject(o)))}
              {item(t('objectMenu.toParts'), run(() => s.splitParts(o)))}
            </>,
          )}
          {submenu(
            'mirror',
            t('objectMenu.mirror'),
            <>
              {item(t('objectMenu.alongX'), run(() => s.mirror(o, i, 0)))}
              {item(t('objectMenu.alongY'), run(() => s.mirror(o, i, 1)))}
              {item(t('objectMenu.alongZ'), run(() => s.mirror(o, i, 2)))}
            </>,
          )}
          {submenu(
            'copies',
            t('objectMenu.instances'),
            <>
              {item(t('objectMenu.addInstance'), run(() => s.copyInstance(o, i)), { title: t('objectMenu.addInstanceTip') })}
              {item(t('objectMenu.removeInstance'), run(() => s.removeInstance(o, i)), {
                disabled: obj.instances.length < 2,
                title: obj.instances.length < 2 ? t('objectMenu.noOtherCopies') : t('objectMenu.removeInstanceTip'),
              })}
              {item(t('objectMenu.setInstances'), () => {
                setCount(obj.instances.length);
                setForm('instances');
              }, { title: t('objectMenu.setInstancesTip', { n: obj.instances.length }) })}
            </>,
          )}
          {submenu(
            'plate',
            t('objectMenu.moveToPlate'),
            <>
              {project.plates.map((p, k) => (
                <Fragment key={k}>
                  {item(p.name ? t('objectMenu.plateNamed', { n: k + 1, name: p.name }) : t('objectMenu.plateN', { n: k + 1 }), run(() => s.moveToPlate([{ object: o, instance: i }], k)), {
                    disabled: k === plate,
                    title: k === plate ? t('objectMenu.onThisPlate') : t('objectMenu.sameSpot'),
                  })}
                </Fragment>
              ))}
              {item(t('objectMenu.newPlate'), run(() => s.moveToPlate([{ object: o, instance: i }], 'new')), { title: t('objectMenu.newPlateTip') })}
            </>,
          )}
          <hr />
          {item(t('objectMenu.copy'), run(() => s.copyToClipboard(o, i)), { title: t('objectMenu.copyTip') })}
          {item(t('objectMenu.cut'), run(() => s.cutToClipboard(o, i)), { title: t('objectMenu.cutTip') })}
          {item(t('objectMenu.paste'), run(() => s.paste()), { disabled: !copied, title: copied ? t('objectMenu.pasteTip') : t('objectMenu.copyFirst') })}
          {item(t('objectMenu.delete'), run(() => s.deleteObject(o)), { title: obj.instances.length > 1 ? t('objectMenu.deleteAllTip') : t('objectMenu.deleteTip') })}
          <hr />
          {item(t('objectMenu.autoOrient'), run(() => s.orientObject(o)))}
          {item(
            t('objectMenu.simplify'),
            run(() => {
              s.select({ object: o, instance: i });
              s.setTool('simplify');
            }),
            { title: t('objectMenu.simplifyTip') },
          )}
          {/* Joins all the object's parts into one (the toolbar's Mesh boolean works on two). */}
          {item(
            t('objectMenu.meshBoolean'),
            run(() => {
              s.select({ object: o, instance: i });
              return s.meshBoolean(o, { op: 'union', a: obj.volumes.findIndex((v) => v.kind === 'part'), b: ALL });
            }),
            obj.volumes.filter((v) => v.kind === 'part').length < 2
              ? { disabled: true, title: t('objectMenu.onePart') }
              : { title: t('objectMenu.meshBooleanTip') },
          )}
          {item(t('objectMenu.printable'), run(() => s.objectAction(o, i, { op: 'printable', value: !inst.printable }, t('objectMenu.printable'))), { checked: inst.printable })}
          {item(t('objectMenu.renameMenu'), () => setForm('rename'))}
          {submenu(
            'filament',
            t('objectMenu.changeFilament'),
            <>
              {filamentRows.map((f, k) => (
                <button key={k} role="menuitemradio" aria-checked={(obj.extruder || 1) === k + 1} className="menu-item" onClick={run(() => s.setObjectFilament(o, -1, k + 1))}>
                  <Swatch colour={f.swatch} number={f.swatchNumber} />
                  {f.label}
                </button>
              ))}
            </>,
          )}
          {item(
            t('objectMenu.objectSettings'),
            run(() => {
              s.select({ object: o, instance: i });
              setTimeout(() => document.querySelector('.object-settings')?.scrollIntoView({ block: 'nearest', behavior: scrollMotion() }), 50);
            }),
            { title: t('objectMenu.objectSettingsTip') },
          )}
          <hr />
          {item(t('objectMenu.scaleToFit'), run(() => s.objectAction(o, i, { op: 'scaleToFit', height }, t('objectMenu.scaleToFitUndo'))), {
            title: t('objectMenu.scaleToFitTip'),
          })}
          {submenu(
            'units',
            t('objectMenu.units'),
            <>
              {unitConversions(obj.units).map((c) => (
                <Fragment key={c.to}>{item(c.label, run(() => s.objectAction(o, i, { op: 'convert', to: c.to }, c.label)))}</Fragment>
              ))}
            </>,
          )}
          {item(t('objectMenu.replace'), () => replaceInput.current?.click(), {
            disabled: parts.length !== 1,
            title: parts.length === 1 ? t('objectMenu.replaceTip') : t('objectMenu.replaceOnePart'),
          })}
          {item(t('objectMenu.exportStl'), run(() => s.exportStl(o, i)))}
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

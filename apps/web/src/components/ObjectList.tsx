import { useTranslation } from 'react-i18next';
import { printableLabel } from '../lib/printable';
import { KIND_CODES, KIND_COLOURS, kindLabel } from '../lib/volumes';
import { NO_COLOURS, useSlicer } from '../state/store';
import { ObjectSettings } from './ObjectSettings';
import { Boxes, Ellipsis } from 'lucide-react';
import { IconButton } from './IconButton';
import { Picker, type PickerOption } from './Picker';
import { filamentChoices } from '../lib/filament-choices';

/** Objects on the current plate, their filament, and the selected one's settings. */
export function ObjectList() {
  const { t } = useTranslation();
  const project = useSlicer((s) => s.project);
  const plate = useSlicer((s) => s.plate);
  const selected = useSlicer((s) => s.selected);
  const group = useSlicer((s) => s.group);
  // Physical filaments, then the colour mixes in use.
  const colours = useSlicer((s) => (s.palette.length ? s.palette : (s.selection?.colours ?? NO_COLOURS)));
  const physical = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const presetNames = useSlicer((s) => s.selection?.filaments);
  const { select, setObjectFilament, deleteObject, copyInstance, removeInstance, openObjectMenu, setTool, toggleChosen, choose, groupAction, openGroupMenu } = useSlicer.getState();
  if (!project?.objects.length) return null;
  const onPlate = project.plates[plate]?.objects ?? [];

  // Like desktop's filament column: the colour and number, the preset's name beside each choice.
  const filaments = presetNames ?? [];
  const filamentSelect = (o: number, v: number, value: number, label: string) => {
    const options: PickerOption[] = [
      ...(v >= 0 ? [{ value: '0', label: t('objectList.object'), swatch: colours[Math.max(0, (project.objects[o].extruder || 1) - 1)], hint: t('objectList.sameAsObject') }] : []),
      ...filamentChoices(colours, filaments, physical, value),
    ];
    return <Picker field label={label} className="filament-pick" value={String(value)} options={options} onChange={(next) => void setObjectFilament(o, v, Number(next))} />;
  };

  const sel = selected && project.objects[selected.object]?.instances[selected.instance];
  return (
    <section className="group">
      <h2>
        <Boxes aria-hidden />
        {t('objectList.objects')}
      </h2>
      <ul className="objects">
        {onPlate.map((o) => {
          const obj = project.objects[o];
          const instance = obj.instances.findIndex((inst) => inst.plate === plate);
          const active = selected?.object === o;
          const chosen = active || group.includes(o);
          const skipped = printableLabel(obj, plate);
          return (
            <li key={o} className={chosen ? 'object active' : 'object'} aria-selected={chosen}>
              <div className="object-row">
                <button
                  className={skipped ? 'object-name unprintable' : 'object-name'}
                  onClick={(e) => {
                    // Like any list: Ctrl+click adds or takes out one, Shift+click takes the run from the last one picked.
                    if (e.ctrlKey || e.metaKey) return toggleChosen(o);
                    const from = group.length ? group[group.length - 1] : selected?.object;
                    if (e.shiftKey && from !== undefined) {
                      const [a, b] = [onPlate.indexOf(from), onPlate.indexOf(o)].sort((x, y) => x - y);
                      return choose([...(group.length ? group : [from]), ...onPlate.slice(a, b + 1)]);
                    }
                    select(active && !group.length ? null : { object: o, instance: Math.max(0, instance) });
                  }}
                  title={skipped ? t('objectList.skippedTip', { name: obj.name, why: skipped.toLowerCase() }) : obj.name}
                >
                  {obj.name || t('objectList.objectN', { n: o + 1 })}
                  {obj.instances.length > 1 && <span className="muted"> ×{obj.instances.length}</span>}
                  {skipped && <span className="muted"> · {skipped}</span>}
                </button>
                {filamentSelect(o, -1, obj.extruder || 1, t('objectList.filamentFor', { name: obj.name }))}
                <IconButton
                  icon={Ellipsis}
                  className="object-more"
                  label={t('objectList.more')}
                  aria-label={t('objectList.moreFor', { name: obj.name })}
                  title={t('objectList.moreTip')}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const i = Math.max(0, instance);
                    select({ object: o, instance: i });
                    openObjectMenu({ object: o, instance: i, x: r.left, y: r.bottom + 2 });
                  }}
                />
              </div>
              {active && obj.volumes.length > 1 && (
                <ul className="volumes">
                  {obj.volumes.map((v, i) => {
                    const picked = selected?.volume === i;
                    const tint = KIND_COLOURS[KIND_CODES[v.kind] ?? 0];
                    return (
                      <li key={i} className={picked ? 'object-row volume active' : 'object-row volume'}>
                        <button
                          className="volume-name"
                          title={`${kindLabel(v.kind)}: ${v.name}`}
                          aria-pressed={picked}
                          onClick={() => select({ object: o, instance: Math.max(0, instance), volume: picked ? undefined : i })}
                        >
                          {tint && <span className="volume-kind" style={{ background: tint.colour }} aria-hidden="true" />}
                          {v.name}
                          {v.kind !== 'part' && <span className="muted"> · {kindLabel(v.kind)}</span>}
                          {v.painted && <span className="muted"> {t('objectList.painted')}</span>}
                        </button>
                        {(v.kind === 'part' || v.kind === 'modifier') && filamentSelect(o, i, v.extruder, t('objectList.filamentFor', { name: v.name }))}
                        <IconButton
                          icon={Ellipsis}
                          className="object-more"
                          label={t('objectList.more')}
                          aria-label={t('objectList.moreForPart', { name: v.name })}
                          title={t('objectList.partMoreTip')}
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            const inst = Math.max(0, instance);
                            select({ object: o, instance: inst, volume: i });
                            openObjectMenu({ object: o, instance: inst, volume: i, x: r.left, y: r.bottom + 2 });
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {group.length > 1 && (
        <div className="transform">
          <p className="group-chosen">
            <strong>{t('objectList.chosen', { count: group.length })}</strong>
          </p>
          <p className="hint">{t('objectList.groupHint')}</p>
          <div className="transform-row actions">
            <button
              className="secondary"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                openGroupMenu({ x: r.left, y: r.bottom + 2 });
              }}
            >
              {t('objectList.more')}
            </button>
            <button className="secondary danger" title={t('objectList.deleteAllTip')} onClick={() => void groupAction({ op: 'delete' })}>
              {t('objectList.delete')}
            </button>
          </div>
        </div>
      )}
      {selected && sel && (
        <div className="transform">
          {selected.volume !== undefined && project.objects[selected.object].volumes[selected.volume] ? (
            project.objects[selected.object].volumes[selected.volume].kind.startsWith('support') ? (
              <p className="hint">
                {t(project.objects[selected.object].volumes[selected.volume].kind === 'supportBlocker' ? 'objectList.blockerHint' : 'objectList.enforcerHint', {
                  kind: kindLabel(project.objects[selected.object].volumes[selected.volume].kind),
                })}
              </p>
            ) : (
              <ObjectSettings key={selected.volume} object={selected.object} volume={selected.volume} />
            )
          ) : (
            <ObjectSettings object={selected.object} />
          )}
          <div className="transform-row actions">
            <button className="secondary" title={t('objectList.addInstanceTip')} onClick={() => void copyInstance(selected.object, selected.instance)}>
              {t('objectList.addInstance')}
            </button>
            <button
              className="secondary"
              disabled={project.objects[selected.object].instances.length < 2}
              title={t('objectList.removeInstanceTip')}
              onClick={() => void removeInstance(selected.object, selected.instance)}
            >
              {t('objectList.removeInstance')}
            </button>
            <button className="secondary" title={t('objectList.simplifyTip')} onClick={() => setTool('simplify')}>
              {t('objectList.simplify')}
            </button>
            <button className="secondary danger" title={t('objectList.deleteTip')} onClick={() => void deleteObject(selected.object)}>
              {t('objectList.delete')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

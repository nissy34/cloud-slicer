import { useMemo, useState } from 'react';
import { objectSettingGroups, objectSettingLabel } from '../lib/object-settings';
import { useSlicer } from '../state/store';
import { FlowVariantSwitch } from './FlowVariantSwitch';
import { OptionField } from './OptionField';
import { SettingPicker } from './SettingPicker';

/**
 * The selected object's own settings, on top of the process; with `volume`,
 * one part's or modifier's (a modifier's apply where it overlaps the object).
 */
export function ObjectSettings({ object, volume = -1 }: { object: number; volume?: number }) {
  const settings = useSlicer((s) => (volume < 0 ? s.project?.objects[object]?.settings : s.project?.objects[object]?.volumes[volume]?.settings));
  const kind = useSlicer((s) => (volume < 0 ? 'object' : s.project?.objects[object]?.volumes[volume]?.kind === 'modifier' ? 'modifier' : 'part'));
  const options = useSlicer((s) => s.options);
  const setObjectSettings = useSlicer((s) => s.setObjectSettings);
  const baseConfig = useSlicer((s) => s.baseConfig);
  const overrides = useSlicer((s) => s.overrides);
  const filaments = useSlicer((s) => s.selection?.filaments.length ?? 1);
  // Desktop's list: its per-object settings table, then everything else "Add settings" offers.
  const [picking, setPicking] = useState(false);
  const groups = useMemo(() => objectSettingGroups(options, kind !== 'object', filaments), [options, kind, filaments]);
  if (!settings) return null;
  const keys = Object.keys(settings).filter((k) => options[k]);
  // The object's settings under desktop's group names, in the list's order.
  const shown = new Map<string, string[]>();
  for (const g of groups)
    for (const o of g.settings)
      if (o.key in settings) {
        const name = g.group.replace(/^More: /, '');
        shown.set(name, [...(shown.get(name) ?? []), o.key]);
      }
  const rest = keys.filter((k) => ![...shown.values()].some((ks) => ks.includes(k)));
  if (rest.length) shown.set('Others', [...(shown.get('Others') ?? []), ...rest]);
  const add = (key: string) => {
    const start = overrides[key] ?? baseConfig[key];
    if (start !== undefined) void setObjectSettings(object, volume, { [key]: start });
  };
  return (
    <div className="object-settings">
      <div className="group-head">
        <span className="subhead">{kind === 'object' ? 'Object settings' : kind === 'modifier' ? 'Modifier settings' : 'Part settings'}</span>
        <button type="button" aria-label={`Add a setting to this ${kind}`} aria-expanded={picking} className="add-setting" onClick={() => setPicking(!picking)}>
          + Add setting
        </button>
      </div>
      {picking && <SettingPicker groups={groups} have={settings} kind={kind} onAdd={add} onClose={() => setPicking(false)} />}
      {keys.some((k) => options[k].flow === 'process') && <FlowVariantSwitch />}
      {keys.length === 0 && (
        <p className="hint">
          {kind === 'modifier'
            ? 'Add a setting to change it where the modifier overlaps the object, like more infill in one spot.'
            : `Uses the ${kind === 'part' ? "object's" : 'process'} settings. Add one to change it for this ${kind} only.`}
        </p>
      )}
      {[...shown].map(([group, groupKeys]) => (
        <div key={group} className="object-settings-group">
          <span className="object-settings-cat">{group}</span>
          {groupKeys.map((k) => (
            <OptionField
              key={k}
              optKey={k}
              label={objectSettingLabel(k)}
              value={settings[k]}
              resetLabel={`Remove from this ${kind}`}
              onChange={(v) => void setObjectSettings(object, volume, { [k]: v })}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

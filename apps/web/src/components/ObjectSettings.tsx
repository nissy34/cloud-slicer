import { useSlicer } from '../state/store';
import { FlowVariantSwitch } from './FlowVariantSwitch';
import { OptionField } from './OptionField';

/**
 * Settings an object can have on its own, like desktop's object list
 * "Add settings" menu (its per-object categories, most used first).
 */
const ADDABLE: { group: string; keys: string[] }[] = [
  { group: 'Quality', keys: ['layer_height', 'seam_position', 'ironing_type'] },
  { group: 'Strength', keys: ['wall_loops', 'top_shell_layers', 'bottom_shell_layers', 'sparse_infill_density', 'sparse_infill_pattern'] },
  { group: 'Support', keys: ['enable_support', 'support_type', 'support_threshold_angle', 'support_on_build_plate_only'] },
  { group: 'Adhesion', keys: ['brim_type', 'brim_width'] },
  { group: 'Speed', keys: ['outer_wall_speed', 'inner_wall_speed', 'sparse_infill_speed'] },
  { group: 'Others', keys: ['fuzzy_skin', 'fuzzy_skin_thickness', 'wall_generator'] },
];

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
  if (!settings) return null;
  const keys = Object.keys(settings).filter((k) => options[k]);
  const add = (key: string) => {
    const start = overrides[key] ?? baseConfig[key];
    if (start !== undefined) void setObjectSettings(object, volume, { [key]: start });
  };
  return (
    <div className="object-settings">
      <div className="group-head">
        <span className="subhead">{kind === 'object' ? 'Object settings' : kind === 'modifier' ? 'Modifier settings' : 'Part settings'}</span>
        <select
          aria-label={`Add a setting to this ${kind}`}
          className="add-setting"
          value=""
          onChange={(e) => e.target.value && add(e.target.value)}
        >
          <option value="">+ Add setting</option>
          {ADDABLE.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.keys
                .filter((k) => options[k] && !(k in settings))
                .map((k) => (
                  <option key={k} value={k}>
                    {options[k].label || k}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      {keys.some((k) => options[k].flow === 'process') && <FlowVariantSwitch />}
      {keys.length === 0 && (
        <p className="hint">
          {kind === 'modifier'
            ? 'Add a setting to change it where the modifier overlaps the object, like more infill in one spot.'
            : `Uses the ${kind === 'part' ? "object's" : 'process'} settings. Add one to change it for this ${kind} only.`}
        </p>
      )}
      {keys.map((k) => (
        <OptionField
          key={k}
          optKey={k}
          value={settings[k]}
          resetLabel={`Remove from this ${kind}`}
          onChange={(v) => void setObjectSettings(object, volume, { [k]: v })}
        />
      ))}
    </div>
  );
}

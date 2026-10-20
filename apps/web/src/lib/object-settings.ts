import type { OptionDef } from '../engine/protocol';

/** One desktop entry: option key, its label when desktop renames it, and its place in the group. */
type Entry = [key: string, label: string, priority: number];

/**
 * Desktop's per-object settings (Snapmaker Orca 2.4 GUI_Factories.cpp,
 * SettingsFactory::OBJECT_CATEGORY_SETTINGS): what only an object can have,
 * added to the part list below for an object.
 */
const OBJECT_CATEGORIES: Record<string, Entry[]> = {
  Quality: [
    ['layer_height', '', 1],
    ['seam_position', '', 2],
    ['slice_closing_radius', '', 3],
    ['resolution', '', 4],
    ['xy_hole_compensation', '', 5],
    ['xy_contour_compensation', '', 6],
    ['elefant_foot_compensation', '', 7],
    ['make_overhang_printable_angle', '', 8],
    ['make_overhang_printable_hole_size', '', 9],
    ['wall_sequence', '', 10],
    ['precise_z_height', '', 10],
  ],
  Support: [
    ['brim_type', '', 1],
    ['brim_width', '', 2],
    ['brim_object_gap', '', 3],
    ['enable_support', '', 4],
    ['support_type', '', 5],
    ['support_threshold_angle', '', 6],
    ['support_threshold_overlap', '', 6],
    ['support_on_build_plate_only', '', 7],
    ['support_filament', '', 8],
    ['support_interface_filament', '', 9],
    ['support_expansion', '', 24],
    ['support_style', '', 25],
    ['tree_support_brim_width', '', 26],
    ['tree_support_branch_angle', '', 10],
    ['tree_support_branch_angle_organic', '', 10],
    ['tree_support_wall_count', '', 11],
    ['tree_support_branch_diameter_angle', '', 11],
    ['support_top_z_distance', '', 13],
    ['support_bottom_z_distance', '', 12],
    ['support_base_pattern', '', 14],
    ['support_base_pattern_spacing', '', 15],
    ['support_interface_top_layers', '', 16],
    ['support_interface_bottom_layers', '', 17],
    ['support_interface_spacing', '', 18],
    ['support_bottom_interface_spacing', '', 19],
    ['support_object_xy_distance', '', 20],
    ['bridge_no_support', '', 21],
    ['max_bridge_length', '', 22],
    ['support_critical_regions_only', '', 23],
    ['support_remove_small_overhang', '', 27],
    ['support_object_first_layer_gap', '', 28],
  ],
  Speed: [
    ['support_speed', '', 12],
    ['support_interface_speed', '', 13],
  ],
};

/**
 * Desktop's per-part settings (SettingsFactory::PART_CATEGORY_SETTINGS), for
 * parts, modifiers and objects alike.
 */
const PART_CATEGORIES: Record<string, Entry[]> = {
  Quality: [
    ['ironing_type', '', 8],
    ['ironing_flow', '', 9],
    ['ironing_spacing', '', 10],
    ['ironing_inset', '', 11],
    ['bridge_flow', '', 11],
    ['make_overhang_printable', '', 11],
    ['bridge_density', '', 1],
  ],
  Strength: [
    ['wall_loops', '', 1],
    ['top_shell_layers', 'Top Solid Layers', 1],
    ['top_shell_thickness', 'Top Minimum Shell Thickness', 1],
    ['top_surface_density', 'Top Surface Density', 1],
    ['bottom_shell_layers', 'Bottom Solid Layers', 1],
    ['bottom_shell_thickness', 'Bottom Minimum Shell Thickness', 1],
    ['bottom_surface_density', 'Bottom Surface Density', 1],
    ['sparse_infill_density', '', 1],
    ['sparse_infill_pattern', '', 1],
    ['sparse_infill_filament', '', 1],
    ['lateral_lattice_angle_1', '', 1],
    ['lateral_lattice_angle_2', '', 1],
    ['infill_overhang_angle', '', 1],
    ['infill_anchor', '', 1],
    ['infill_anchor_max', '', 1],
    ['top_surface_pattern', '', 1],
    ['bottom_surface_pattern', '', 1],
    ['internal_solid_infill_pattern', '', 1],
    ['align_infill_direction_to_model', '', 1],
    ['extra_solid_infills', '', 1],
    ['infill_combination', '', 1],
    ['infill_combination_max_layer_height', '', 1],
    ['infill_wall_overlap', '', 1],
    ['top_bottom_infill_wall_overlap', '', 1],
    ['solid_infill_direction', '', 1],
    ['infill_direction', '', 1],
    ['bridge_angle', '', 1],
    ['internal_bridge_angle', '', 1],
    ['minimum_sparse_infill_area', '', 1],
  ],
  Speed: [
    ['outer_wall_speed', '', 1],
    ['inner_wall_speed', '', 2],
    ['sparse_infill_speed', '', 3],
    ['top_surface_speed', '', 4],
    ['internal_solid_infill_speed', '', 5],
    ['enable_overhang_speed', '', 6],
    ['overhang_1_4_speed', '', 7],
    ['overhang_2_4_speed', '', 8],
    ['overhang_3_4_speed', '', 9],
    ['overhang_4_4_speed', '', 10],
    ['bridge_speed', '', 11],
    ['gap_infill_speed', '', 12],
    ['internal_bridge_speed', '', 13],
  ],
};

/** Desktop lists its categories in this (alphabetical, std::map) order. */
const CATEGORY_ORDER = ['Quality', 'Speed', 'Strength', 'Support'];

export interface SettingChoice {
  key: string;
  label: string;
}
export interface SettingGroup {
  group: string;
  settings: SettingChoice[];
}

/** Desktop's label for an option the settings list shows, where it renames one. */
export function objectSettingLabel(key: string): string | undefined {
  for (const cats of [PART_CATEGORIES, OBJECT_CATEGORIES])
    for (const entries of Object.values(cats)) {
      const e = entries.find(([k]) => k === key);
      if (e?.[1]) return e[1];
    }
  return undefined;
}

/**
 * The settings an object (or, with `part`, a part or modifier) can have on its
 * own, grouped like desktop: its per-object settings table (the curated
 * Quality / Speed / Strength / Support lists), each followed by the rest of
 * that category desktop's "Add settings" menu offers, then that menu's other
 * categories, named "More: <category>". With one
 * filament, the Extruders and Wipe options categories are left out, as desktop
 * does, and so are the flushing options, which the U1 doesn't use. Options the engine doesn't know are skipped.
 */
export function objectSettingGroups(options: Record<string, OptionDef>, part: boolean, filaments: number): SettingGroup[] {
  const fits = (key: string) => {
    const def = options[key];
    if (!def || key === 'extruder') return false;
    // An engine without scope metadata: trust desktop's curated lists.
    if (!def.scope) return true;
    return def.scope === 'region' || (!part && def.scope === 'object');
  };
  const groups: SettingGroup[] = [];
  const listed = new Set<string>();
  for (const group of CATEGORY_ORDER) {
    const entries = [...(PART_CATEGORIES[group] ?? []), ...(part ? [] : (OBJECT_CATEGORIES[group] ?? []))];
    // A stable sort by desktop's priority keeps its list order among equals.
    entries.sort((a, b) => a[2] - b[2]);
    const settings = entries
      .filter(([k]) => fits(k))
      .map(([key, label]) => ({
        key,
        label: label || options[key].label || key,
      }));
    settings.forEach((s) => listed.add(s.key));
    if (settings.length) groups.push({ group, settings });
  }
  const more = new Map<string, SettingChoice[]>();
  for (const [key, def] of Object.entries(options)) {
    if (listed.has(key) || !def.scope || !fits(key) || !def.category) continue;
    if (filaments <= 1 && (def.category === 'Extruders' || def.category === 'Wipe options')) continue;
    // The U1's four heads never flush, so its purge options stay out (Nissan, 2026-10-20).
    if (def.category === 'Flush options') continue;
    // Orca's one-off category names, folded into the groups they sit beside in the process pages.
    const category = def.category === 'Other' ? 'Others' : def.category === 'Layers and Perimeters' ? 'Quality' : def.category;
    const list = more.get(category) ?? [];
    list.push({ key, label: def.fullLabel || def.label || key });
    more.set(category, list);
  }
  for (const [category, settings] of [...more].sort(([a], [b]) => a.localeCompare(b))) {
    settings.sort((a, b) => a.label.localeCompare(b.label));
    // A category desktop's table has too gets the rest after its table entries; others come last.
    const same = groups.find((g) => g.group === category);
    if (same) same.settings.push(...settings);
    else groups.push({ group: `More: ${category}`, settings });
  }
  return groups;
}

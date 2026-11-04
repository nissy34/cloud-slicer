import { describe, expect, it } from 'vitest';
import type { OptionDef } from '../engine/protocol';
import { expandPending, presetForEngine, presetFromEngine, SHARED, standIn, upgradePreset, useSameValues, type SharedTable, type StoredPreset } from './preset-engines';

// A small table: wall_loops shared, outer_wall_speed shared on its standard
// value, machine_start_gcode and chamber_temperature each engine's own.
const T: SharedTable = {
  version: 2,
  shared: ['outer_wall_speed', 'sparse_infill_density', 'wall_loops'],
  flow: { outer_wall_speed: 'process' },
  names: { 'snapmaker>orca': { process: { '0.20mm Standard': '0.20 Standard' } }, 'orca>snapmaker': { process: { '0.20 Standard': '0.20mm Standard', '0.25 Benchy': '0.20mm Standard' } } },
  history: [
    { version: 1, shared: ['chamber_temperature', 'outer_wall_speed', 'wall_loops'] },
    { version: 2, shared: ['outer_wall_speed', 'sparse_infill_density', 'wall_loops'] },
  ],
};
const opt = (type: string, enumValues?: string[]): OptionDef => ({ type, enumValues }) as OptionDef;
const OPTIONS = {
  wall_loops: opt('int'),
  outer_wall_speed: opt('float'),
  sparse_infill_density: opt('percent'),
  chamber_temperature: opt('int'),
  machine_start_gcode: opt('string'),
  seam_position: opt('enum', ['aligned', 'back']),
};
const SNAP_OPTIONS = { ...OPTIONS, outer_wall_speed: opt('floats') };
const preset = (p: Partial<StoredPreset> = {}): StoredPreset => ({
  type: 'process',
  name: 'Mine',
  inherits: '0.20mm Standard',
  config: {},
  engines: { shared: 2 },
  ...p,
});

describe('presetForEngine', () => {
  it('gives Snapmaker Orca the preset as stored', () => {
    const p = preset({ config: { wall_loops: '3', outer_wall_speed: '150,300' } });
    expect(presetForEngine(p, 'snapmaker', SNAP_OPTIONS, T)).toMatchObject({ inherits: '0.20mm Standard', config: { wall_loops: '3', outer_wall_speed: '150,300' } });
  });

  it('gives OrcaSlicer the shared settings, the standard flow value and its own part, on its stand-in base', () => {
    const p = preset({
      config: { wall_loops: '3', outer_wall_speed: '150,300', chamber_temperature: '40' },
      engines: { shared: 2, orca: { config: { machine_start_gcode: 'G28' } } },
    });
    expect(presetForEngine(p, 'orca', OPTIONS, T)).toMatchObject({
      inherits: '0.20 Standard',
      config: { wall_loops: '3', outer_wall_speed: '150', machine_start_gcode: 'G28' },
    });
  });

  it("uses OrcaSlicer's own base when it has one, and the standard value's place in the list", () => {
    const p = preset({ config: { outer_wall_speed: '300,150' }, engines: { shared: 2, flowIndex: 1, orca: { inherits: '0.25 Benchy', config: {} } } });
    expect(presetForEngine(p, 'orca', OPTIONS, T)).toMatchObject({ inherits: '0.25 Benchy', config: { outer_wall_speed: '150' } });
  });

  it('drops choices the engine does not offer', () => {
    const p = preset({ config: { seam_position: 'nearest', wall_loops: '2' } });
    expect(presetForEngine(p, 'snapmaker', SNAP_OPTIONS, T).config).toEqual({ wall_loops: '2' });
  });

  it('hands Snapmaker Orca the pending standard values, which fill in its base list', () => {
    const p = preset({ engines: { shared: 2, pending: { outer_wall_speed: '120' } } });
    const view = presetForEngine(p, 'snapmaker', SNAP_OPTIONS, T);
    expect(view.pending).toEqual({ outer_wall_speed: '120' });
    expect(expandPending(view.config, view.pending!, { outer_wall_speed: '200,500' })).toEqual({ outer_wall_speed: '120,500' });
    expect(presetForEngine(p, 'orca', OPTIONS, T).config).toEqual({ outer_wall_speed: '120' });
  });
});

describe('presetFromEngine', () => {
  const meta = new Set(['name', 'inherits']);

  it('saves a new Snapmaker preset as its diff', () => {
    const out = presetFromEngine(undefined, 'snapmaker', {
      type: 'process',
      inherits: '0.20mm Standard',
      edited: { name: 'x', wall_loops: '4', sparse_infill_density: '15%', process_flow_support: 'standard;high_flow' },
      own: {},
      parent: { wall_loops: '2', sparse_infill_density: '15%', process_flow_support: 'standard;high_flow' },
      meta,
    }, T);
    expect(out).toEqual({ inherits: '0.20mm Standard', config: { wall_loops: '4' }, engines: { shared: 2 } });
  });

  it('saves a new OrcaSlicer preset: shared values for both, the rest its own, Snapmaker on the stand-in base', () => {
    const out = presetFromEngine(undefined, 'orca', {
      type: 'process',
      inherits: '0.20 Standard',
      edited: { wall_loops: '4', outer_wall_speed: '180', machine_start_gcode: 'G28 X' },
      own: {},
      parent: { wall_loops: '2', outer_wall_speed: '200', machine_start_gcode: 'G28' },
    }, T);
    expect(out).toEqual({
      inherits: '0.20mm Standard',
      config: { wall_loops: '4' },
      engines: { shared: 2, orca: { inherits: '0.20 Standard', config: { machine_start_gcode: 'G28 X' } }, pending: { outer_wall_speed: '180' } },
    });
  });

  it("never touches the other engine's part, and keeps shared values the user didn't change", () => {
    const prev = preset({
      config: { wall_loops: '4', outer_wall_speed: '150,300', chamber_temperature: '40' },
      engines: { shared: 2, orca: { config: { machine_start_gcode: 'G28 X' } } },
    });
    // In Snapmaker: wall_loops 4 equals its base, but came from OrcaSlicer and wasn't touched.
    const snap = presetFromEngine(prev, 'snapmaker', {
      type: 'process',
      inherits: '0.20mm Standard',
      edited: { wall_loops: '4', outer_wall_speed: '150,300', chamber_temperature: '45' },
      own: { wall_loops: '4', outer_wall_speed: '150,300', chamber_temperature: '40' },
      parent: { wall_loops: '4', outer_wall_speed: '200,500', chamber_temperature: '0' },
    }, T);
    expect(snap.config).toEqual({ wall_loops: '4', outer_wall_speed: '150,300', chamber_temperature: '45' });
    expect(snap.engines.orca).toEqual({ config: { machine_start_gcode: 'G28 X' } });

    // In OrcaSlicer: a changed standard flow value lands in Snapmaker's list; its own chamber value stays.
    const orca = presetFromEngine(prev, 'orca', {
      type: 'process',
      inherits: '0.20 Standard',
      edited: { wall_loops: '4', outer_wall_speed: '170', machine_start_gcode: 'G28 X' },
      own: { wall_loops: '4', outer_wall_speed: '150', machine_start_gcode: 'G28 X' },
      parent: { wall_loops: '2', outer_wall_speed: '200', machine_start_gcode: 'G28' },
    }, T);
    expect(orca.config).toEqual({ wall_loops: '4', outer_wall_speed: '170,300', chamber_temperature: '40' });
    expect(orca.engines.orca).toEqual({ inherits: '0.20 Standard', config: { machine_start_gcode: 'G28 X' } });
    expect(orca.inherits).toBe('0.20mm Standard');
  });

  it('a shared setting set back to the base in one engine is removed for both', () => {
    const prev = preset({ config: { wall_loops: '4' } });
    const out = presetFromEngine(prev, 'orca', {
      type: 'process',
      inherits: '0.20 Standard',
      edited: { wall_loops: '2' },
      own: { wall_loops: '4' },
      parent: { wall_loops: '2' },
    }, T);
    expect(out.config).toEqual({});
  });

  it('a Snapmaker change to a flow list clears the pending OrcaSlicer value', () => {
    const prev = preset({ engines: { shared: 2, pending: { outer_wall_speed: '120' } } });
    const out = presetFromEngine(prev, 'snapmaker', {
      type: 'process',
      inherits: '0.20mm Standard',
      edited: { outer_wall_speed: '130,500' },
      own: { outer_wall_speed: '120,500' },
      parent: { outer_wall_speed: '200,500' },
    }, T);
    expect(out.config).toEqual({ outer_wall_speed: '130,500' });
    expect(out.engines.pending).toBeUndefined();
  });
});

describe('upgradePreset', () => {
  it('leaves a current preset alone', () => {
    const p = preset();
    expect(upgradePreset(p, T)).toEqual({ preset: p, notes: [] });
  });

  it('a setting no longer shared keeps its value in both engines, with a note', () => {
    const p = preset({ config: { chamber_temperature: '40' }, engines: { shared: 1 } });
    const { preset: up, notes } = upgradePreset(p, T);
    expect(up.config).toEqual({ chamber_temperature: '40' });
    expect(up.engines?.orca?.config).toEqual({ chamber_temperature: '40' });
    expect(up.engines?.shared).toBe(2);
    expect(notes).toHaveLength(1);
  });

  it('a newly shared setting merges only when both engines agree', () => {
    const same = preset({ config: { sparse_infill_density: '20%' }, engines: { shared: 1, orca: { config: { sparse_infill_density: '20%' } } } });
    const { preset: merged, notes } = upgradePreset(same, T);
    expect(merged.engines?.orca?.config).toEqual({});
    expect(merged.engines?.apart).toBeUndefined();
    expect(notes).toEqual([]);

    const differ = preset({ config: { sparse_infill_density: '20%' }, engines: { shared: 1, orca: { config: { sparse_infill_density: '30%' } } } });
    const { preset: apart, notes: n2 } = upgradePreset(differ, T);
    expect(apart.engines?.apart).toEqual(['sparse_infill_density']);
    expect(n2).toHaveLength(1);
    // Kept apart, each engine sees its own value.
    expect(presetForEngine(differ, 'orca', OPTIONS, T).config.sparse_infill_density).toBe('30%');
    expect(presetForEngine(differ, 'snapmaker', SNAP_OPTIONS, T).config.sparse_infill_density).toBe('20%');
    // Until the user makes them the same.
    const one = useSameValues(apart, 'orca', T);
    expect(one.config.sparse_infill_density).toBe('30%');
    expect(one.engines?.apart).toBeUndefined();
    expect(presetForEngine(one, 'snapmaker', SNAP_OPTIONS, T).config.sparse_infill_density).toBe('30%');
  });

  it('presets saved before there were two engines count as the first list', () => {
    const p = preset({ config: { chamber_temperature: '40' }, engines: undefined });
    expect(upgradePreset(p, T).preset.engines?.orca?.config).toEqual({ chamber_temperature: '40' });
  });
});

describe('the generated table', () => {
  it('shares settings but never G-code or preset bookkeeping', () => {
    expect(SHARED.shared).toContain('wall_loops');
    expect(SHARED.shared).toContain('outer_wall_speed');
    expect(SHARED.flow.outer_wall_speed).toBe('process');
    expect(SHARED.shared.some((k) => /gcode$/.test(k))).toBe(false);
    expect(SHARED.shared).not.toContain('inherits');
    expect(SHARED.history.at(-1)?.version).toBe(SHARED.version);
  });

  it("maps the U1's process presets by layer height", () => {
    expect(standIn('process', '0.20mm Standard @Snapmaker U1 (0.4 nozzle)', 'snapmaker', 'orca')).toBe('0.20 Standard @Snapmaker U1 (0.4 nozzle)');
    expect(standIn('process', '0.25 Benchy @Snapmaker U1 (0.4 nozzle)', 'orca', 'snapmaker')).toBe('0.24mm Standard @Snapmaker U1 (0.4 nozzle)');
    // OrcaSlicer 2.5 has U1 generics of its own, per nozzle.
    expect(standIn('filament', 'Generic PLA', 'snapmaker', 'orca')).toBe('Generic PLA @U1 0.4 nozzle');
    expect(standIn('printer', 'Snapmaker U1 (0.4 nozzle)', 'snapmaker', 'orca')).toBe('Snapmaker U1 (0.4 nozzle)');
  });
});

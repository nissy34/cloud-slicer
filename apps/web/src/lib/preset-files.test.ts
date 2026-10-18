import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate';
import type { ParsedPreset } from '../engine/client';
import type { OptionDef, PresetSummary } from '../engine/protocol';
import {
  changedGcode,
  cleanName,
  finalName,
  freeName,
  importDiff,
  limitError,
  MAX_FILE_BYTES,
  planImport,
  presetBundle,
  readPresetFiles,
  type PresetSource,
} from './preset-files';

const json = (o: object) => strToU8(JSON.stringify(o));

describe('readPresetFiles', () => {
  it('reads JSON files and the JSON files in a bundle, skipping its structure file', () => {
    const zip = zipSync({
      'bundle_structure.json': json({ bundle_type: 'printer config bundle' }),
      'printer/My U1.json': json({ name: 'My U1' }),
      'filament/My PLA.json': json({ name: 'My PLA' }),
      'readme.txt': strToU8('hi'),
    });
    const { sources, problems } = readPresetFiles([
      { name: 'one.json', bytes: json({ name: 'One' }) },
      { name: 'my.orca_printer', bytes: zip },
    ]);
    expect(problems).toEqual([]);
    expect(sources.map((s) => s.label)).toEqual(['one.json', 'my.orca_printer › filament/My PLA.json', 'my.orca_printer › printer/My U1.json']);
  });
  it('rejects non-JSON, oversized files and zip bombs before unpacking', () => {
    const bomb = zipSync({ 'a.json': new Uint8Array(MAX_FILE_BYTES + 10) });
    const { sources, problems } = readPresetFiles([
      { name: 'x.json', bytes: strToU8('not json') },
      { name: 'big.json', bytes: new Uint8Array(MAX_FILE_BYTES + 1) },
      { name: 'bomb.zip', bytes: bomb },
    ]);
    expect(sources).toEqual([]);
    expect(problems).toHaveLength(3);
    expect(problems[2]).toMatch(/unpacks to more than/);
  });
});

describe('names', () => {
  it('cleans characters the account refuses and finds free names', () => {
    expect(cleanName(' My/PLA: "fast" ')).toBe('My-PLA- -fast-');
    const taken = new Set(['PLA', 'PLA (2)']);
    expect(freeName('PLA', (n) => taken.has(n))).toBe('PLA (3)');
  });
});

describe('importDiff', () => {
  const options = {
    layer_height: { type: 'float' },
    outer_wall_speed: { type: 'floats', flow: 'process' },
    machine_start_gcode: { type: 'string', label: 'Machine start G-code' },
  } as unknown as Record<string, OptionDef>;
  it('keeps what differs from the base, with 2.2 single values laid out as 2.4 flow pairs', () => {
    const own = { layer_height: '0.2', outer_wall_speed: '200', inherits: 'X', print_settings_id: 'Mine', retired_key: '1' };
    const base = { layer_height: '0.2', outer_wall_speed: '150,300', process_flow_support: 'standard,high_flow' };
    expect(importDiff(own, base, options)).toEqual({ outer_wall_speed: '200,200' });
  });
  it('only keeps the given keys when converting', () => {
    expect(importDiff({ layer_height: '0.3', outer_wall_speed: '99' }, { layer_height: '0.2', outer_wall_speed: '50' }, options, ['layer_height'])).toEqual({
      layer_height: '0.3',
    });
  });
  it('lists changed G-code and enforces the account limits', () => {
    expect(changedGcode({ machine_start_gcode: 'G28' }, options)).toEqual(['Machine start G-code']);
    expect(limitError({ a: 'x'.repeat(300 * 1024) })).toMatch(/over/);
    expect(limitError({ a: '1' })).toBeNull();
  });
});

describe('planImport', () => {
  const ok = (p: Partial<Extract<ParsedPreset, { ok: true }>>): ParsedPreset => ({
    ok: true,
    type: 'filament',
    name: '',
    version: '1.0.0',
    inherits: '',
    parent: '',
    filamentId: '',
    unknown: [],
    invalid: [],
    config: {},
    ...p,
  });
  const src = (n: number): PresetSource[] => Array.from({ length: n }, (_, i) => ({ label: `f${i}.json`, text: '{}' }));
  const summary = (name: string, extra: Partial<PresetSummary> = {}) => ({ name, system: true, user: false, compatible: true, ...extra }) as PresetSummary;
  const sets = (printer: string[], filament: string[], process: string[]) => ({
    printer: new Set(printer),
    filament: new Set(filament),
    process: new Set(process),
  });

  it('accepts presets on our system presets, rejects printers we lack, and offers a base for others', () => {
    const items = planImport({
      sources: src(4),
      parsed: [
        ok({ type: 'printer', name: 'My U1', inherits: 'Snapmaker U1 (0.4 nozzle)', parent: 'Snapmaker U1 (0.4 nozzle)' }),
        ok({ type: 'printer', name: 'My X1C', inherits: 'Bambu Lab X1 Carbon 0.4 nozzle', config: { printer_model: 'Bambu Lab X1 Carbon' } }),
        ok({ type: 'filament', name: 'Fast PLA', inherits: 'Bambu PLA Basic @BBL X1C', config: { filament_type: 'PLA' } }),
        { ok: false, error: 'bad json' },
      ],
      systemNames: sets(['Snapmaker U1 (0.4 nozzle)'], [], []),
      userNames: sets([], [], []),
      processes: [],
      filaments: [summary('Snapmaker PETG @U1', { filamentType: 'PETG' }), summary('Snapmaker PLA @U1', { filamentType: 'PLA' })],
      defaultProcess: '',
    });
    const by = (n: string) => items.find((i) => i.name === n || i.fileName === n)!;
    expect(by('My U1').rejected).toBeUndefined();
    expect(by('My U1').base).toBe('Snapmaker U1 (0.4 nozzle)');
    expect(by('My X1C').rejected).toMatch(/Bambu Lab X1 Carbon/);
    expect(by('Fast PLA')).toMatchObject({ converted: true, base: 'Snapmaker PLA @U1' });
    expect(items.filter((i) => i.rejected)).toHaveLength(2);
    // Printers first, rejected last.
    expect(items[0].name).toBe('My U1');
  });

  it('renames a system name, and asks before replacing one of yours', () => {
    const items = planImport({
      sources: src(3),
      parsed: [
        ok({ type: 'process', name: '0.20mm Standard', parent: '0.20mm Standard' }),
        ok({ type: 'process', name: 'Mine', parent: '0.20mm Standard' }),
        ok({ type: 'process', name: 'Mine', parent: '0.20mm Standard' }),
      ],
      systemNames: sets([], [], ['0.20mm Standard']),
      userNames: sets([], [], ['Mine']),
      processes: [],
      filaments: [],
      defaultProcess: '',
    });
    expect(items.map((i) => [i.name, i.taken ?? ''])).toEqual([
      ['0.20mm Standard (2)', ''],
      ['Mine', 'user'],
      ['Mine (2)', ''],
    ]);
    const mine = items[1];
    expect(mine.collision).toBe('overwrite');
    expect(finalName({ ...mine, collision: 'keep' }, (n) => n === 'Mine' || n === 'Mine (2)')).toBe('Mine (3)');
    expect(finalName({ ...mine, collision: 'skip' }, () => false)).toBeNull();
  });
});

describe('presetBundle', () => {
  it('zips presets in desktop folders with a bundle_structure.json', () => {
    const files = unzipSync(presetBundle([
      { type: 'printer', name: 'My U1', json: '{"name":"My U1"}' },
      { type: 'process', name: 'Fast', json: '{"name":"Fast"}' },
    ]));
    expect(Object.keys(files).sort()).toEqual(['bundle_structure.json', 'printer/My U1.json', 'process/Fast.json']);
    expect(JSON.parse(strFromU8(files['bundle_structure.json'])).printer_config).toEqual(['printer/My U1.json']);
  });
});

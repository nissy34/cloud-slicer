import { describe, expect, it } from 'vitest';
import type { PresetSummary } from '../engine/protocol';
import { filamentGroups, installedOnly, printerModels } from './setup';

const printer = (name: string, model: string, nozzle: string, system = true) =>
  ({ name, label: name, type: 'printer', system, user: !system, compatible: true, inherits: '', vendor: 'Snapmaker', model, nozzle }) as PresetSummary;

describe('setup', () => {
  it('groups system printers by model with their nozzles in order', () => {
    const models = printerModels([
      printer('Snapmaker U1 (0.6 nozzle)', 'Snapmaker U1', '0.6,0.6,0.6,0.6'),
      printer('Snapmaker U1 (0.4 nozzle)', 'Snapmaker U1', '0.4,0.4,0.4,0.4'),
      printer('Snapmaker J1 (0.4 nozzle)', 'Snapmaker J1', '0.4,0.4'),
      printer('My U1', 'Snapmaker U1', '0.4', false),
    ]);
    expect(models.map((m) => m.model)).toEqual(['Snapmaker J1', 'Snapmaker U1']);
    expect(models[1].nozzles.map((n) => n.nozzle)).toEqual(['0.4', '0.6']);
  });

  it('keeps everything until the wizard has run, then the installed ones and the current value', () => {
    const list = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    expect(installedOnly(list, undefined)).toHaveLength(3);
    expect(installedOnly(list, ['a'], 'c').map((p) => p.name)).toEqual(['a', 'c']);
    expect(installedOnly(list, ['b'], ['a', 'b']).map((p) => p.name)).toEqual(['a', 'b']);
    expect(installedOnly(list, ['z'], 'a')).toHaveLength(3);
  });

  it('groups filaments by brand', () => {
    const f = (name: string, filamentVendor: string) => ({ name, filamentVendor }) as PresetSummary;
    const groups = filamentGroups([f('Snapmaker PLA', 'Snapmaker'), f('Generic PETG', 'Generic'), f('Other', 'X'), f('Bambu PLA', '"Bambu Lab"')], new Set(['Snapmaker PLA', 'Generic PETG', 'Bambu PLA']));
    expect(groups.map((g) => g.vendor)).toEqual(['Bambu Lab', 'Generic', 'Snapmaker']);
  });
});

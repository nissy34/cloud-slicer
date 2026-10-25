import { describe, expect, it } from 'vitest';
import type { PresetSummary } from '../engine/protocol';
import { canSend, vendorFilesFor, withDirectPrint, type PrinterCatalog } from './printer-catalog';
import { matchModels, wizardBrands } from './setup';

const catalog: PrinterCatalog = {
  version: '1',
  vendors: [
    { id: 'Prusa', name: 'Prusa', file: 'Prusa.json', bytes: 64000, models: [{ model: 'MK4', cover: '', send: false, nozzles: [{ name: 'Prusa MK4 0.4 nozzle', nozzle: '0.4' }] }] },
    {
      id: 'Snapmaker',
      name: 'Snapmaker',
      file: '',
      bytes: 0,
      models: [{ model: 'Snapmaker U1', cover: 'covers/Snapmaker/Snapmaker_U1.png', send: true, nozzles: [{ name: 'Snapmaker U1 (0.4 nozzle)', nozzle: '0.4' }] }],
    },
    {
      id: 'Voron',
      name: 'Voron',
      file: 'Voron.json',
      bytes: 9000,
      models: [{ model: 'Voron 2.4 350', cover: '', send: true, nozzles: [{ name: 'Voron 2.4 350 0.4 nozzle', nozzle: '0.4' }, { name: 'Voron 2.4 350 0.6 nozzle', nozzle: '0.6' }] }],
    },
  ],
};
const user = (name: string, inherits: string) => ({ name, inherits, user: true }) as PresetSummary;

describe('printer catalog', () => {
  it('names the brand files a set of printers needs, none for start-up brands or unknown names', () => {
    expect(vendorFilesFor(catalog, ['Voron 2.4 350 0.6 nozzle', 'Snapmaker U1 (0.4 nozzle)', 'Prusa MK4 0.4 nozzle', 'Voron 2.4 350 0.4 nozzle', 'My printer'])).toEqual(['Prusa.json', 'Voron.json']);
    expect(vendorFilesFor(null, ['Voron 2.4 350 0.4 nozzle'])).toEqual([]);
  });

  it('marks Klipper printers, and user printers through what they are built on', () => {
    expect(canSend(catalog, 'Voron 2.4 350 0.4 nozzle')).toBe(true);
    expect(canSend(catalog, 'Prusa MK4 0.4 nozzle')).toBe(false);
    const mine = [user('My Voron', 'Voron 2.4 350 0.4 nozzle'), user('My Voron copy', 'My Voron'), user('Loop', 'Loop')];
    expect(canSend(catalog, 'My Voron copy', mine)).toBe(true);
    expect(canSend(catalog, 'Loop', mine)).toBeNull();
    expect(canSend(null, 'Voron 2.4 350 0.4 nozzle')).toBeNull();
  });

  it('marks Prusa printers too: the Device tab reaches them through PrusaLink', () => {
    const marked = withDirectPrint(catalog);
    expect(canSend(marked, 'Prusa MK4 0.4 nozzle')).toBe(true);
    expect(canSend(marked, 'Voron 2.4 350 0.4 nozzle')).toBe(true);
    expect(canSend(catalog, 'Prusa MK4 0.4 nozzle')).toBe(false);
  });

  it('marks the Elegoo Centauri Carbon (its own protocol), not the Carbon 2 or other Elegoo models', () => {
    const model = (m: string, send = false) => ({ model: m, cover: '', send, nozzles: [{ name: `${m} 0.4 nozzle`, nozzle: '0.4' }] });
    const elegoo = { id: 'Elegoo', name: 'Elegoo', file: 'Elegoo.json', bytes: 1, models: [model('Elegoo Centauri Carbon'), model('Elegoo Centauri Carbon 2'), model('Elegoo Neptune 4', true), model('Elegoo Neptune 3')] };
    const marked = withDirectPrint({ ...catalog, vendors: [elegoo] });
    expect(canSend(marked, 'Elegoo Centauri Carbon 0.4 nozzle')).toBe(true);
    expect(canSend(marked, 'Elegoo Centauri Carbon 2 0.4 nozzle')).toBe(false);
    expect(canSend(marked, 'Elegoo Neptune 4 0.4 nozzle')).toBe(true);
    expect(canSend(marked, 'Elegoo Neptune 3 0.4 nozzle')).toBe(false);
  });

  it('marks every Bambu Lab printer (its own local protocol)', () => {
    const bbl = { id: 'BBL', name: 'Bambu Lab', file: 'BBL.json', bytes: 1, models: [{ model: 'Bambu Lab P1S', cover: '', send: false, nozzles: [{ name: 'Bambu Lab P1S 0.4 nozzle', nozzle: '0.4' }] }] };
    expect(canSend(withDirectPrint({ ...catalog, vendors: [bbl] }), 'Bambu Lab P1S 0.4 nozzle')).toBe(true);
  });

  it('lists brands with picked ones first, then Snapmaker, then by name', () => {
    expect(wizardBrands(catalog, [], []).map((b) => b.vendor)).toEqual(['Snapmaker', 'Prusa', 'Voron']);
    expect(wizardBrands(catalog, [], ['Voron 2.4 350 0.6 nozzle']).map((b) => b.vendor)).toEqual(['Voron', 'Snapmaker', 'Prusa']);
    const two = { ...catalog, vendors: [{ ...catalog.vendors[1], models: [{ ...catalog.vendors[1].models[0], model: 'A250', nozzles: [{ name: 'A250', nozzle: '0.4' }] }, ...catalog.vendors[1].models] }] };
    expect(wizardBrands(two, [], ['Snapmaker U1 (0.4 nozzle)'])[0].models.map((m) => m.model)).toEqual(['Snapmaker U1', 'A250']);
  });

  it('falls back to the loaded printers without a catalog', () => {
    const p = { name: 'Snapmaker U1 (0.4 nozzle)', system: true, vendor: 'Snapmaker', model: 'Snapmaker U1', nozzle: '0.4' } as PresetSummary;
    const brands = wizardBrands(null, [p], []);
    expect(brands).toHaveLength(1);
    expect(brands[0].models[0]).toMatchObject({ model: 'Snapmaker U1', send: null, cover: '' });
  });

  it('searches brand and model words in any order', () => {
    const models = [
      { vendor: 'Voron', model: 'Voron 2.4 350' },
      { vendor: 'Creality', model: 'K1 Max' },
    ];
    expect(matchModels(models, '350 voron').map((m) => m.model)).toEqual(['Voron 2.4 350']);
    expect(matchModels(models, 'creality k1')).toHaveLength(1);
    expect(matchModels(models, '  ')).toHaveLength(2);
  });
});

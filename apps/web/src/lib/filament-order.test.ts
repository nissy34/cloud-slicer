import { describe, expect, it } from 'vitest';
import type { PresetSummary } from '../engine/protocol';
import { filamentProduct, filamentsByBrand, readFilamentOrder } from './filament-order';

const f = (name: string, filamentVendor = '') => ({ name, filamentVendor, system: true }) as PresetSummary;
const order = readFilamentOrder(
  '﻿' + JSON.stringify({ schema_version: 1, sections: { high_flow: {}, filament_order: { Snapmaker: ['PLA SnapSpeed', 'PLA Matte', 'PETG HF'] } } }),
);

describe('filament list by brand (Snapmaker Orca 2.4.1 FilamentSort)', () => {
  it('reads the order from filament_allow_list.json', () => {
    expect(order).toEqual({ Snapmaker: ['PLA SnapSpeed', 'PLA Matte', 'PETG HF'] });
    expect(readFilamentOrder('{"schema_version":2,"sections":{"filament_order":{"Snapmaker":["PLA"]}}}')).toEqual({});
    expect(readFilamentOrder(undefined)).toEqual({});
  });

  it('names the product without brand and printer', () => {
    expect(filamentProduct('Snapmaker PLA Matte @U1', 'Snapmaker')).toBe('PLA Matte');
    expect(filamentProduct('Generic PLA @System', '')).toBe('PLA');
  });

  it('puts Snapmaker first in its own order, then Generic, then the rest by name', () => {
    const list = [
      f('Polymaker PolyLite PLA @U1', 'Polymaker'),
      f('Generic PLA @U1', 'Generic'),
      f('Snapmaker ABS @U1', 'Snapmaker'),
      f('Snapmaker PETG HF @U1', 'Snapmaker'),
      f('Snapmaker PLA SnapSpeed @U1', 'snapmaker'),
      f('Elegoo PLA @U1'),
    ];
    const groups = filamentsByBrand(list, order, (p) => p.name);
    expect(groups.map(([b, ps]) => [b, ps.map((p) => p.name)])).toEqual([
      ['Snapmaker', ['Snapmaker PLA SnapSpeed @U1', 'Snapmaker PETG HF @U1', 'Snapmaker ABS @U1']],
      ['Generic', ['Generic PLA @U1']],
      ['Elegoo', ['Elegoo PLA @U1']],
      ['Polymaker', ['Polymaker PolyLite PLA @U1']],
    ]);
  });
});

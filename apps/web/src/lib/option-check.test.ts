import { describe, expect, it } from 'vitest';
import { checkOptionValue } from './option-check';

const layerHeight = { type: 'float', min: 0, sidetext: 'mm' };
const lineWidth = { type: 'floatOrPercent', min: 0, sidetext: 'mm or %' };
const anchor = { type: 'floatOrPercent', min: 0, sidetext: 'mm or %', maxLiteral: 1000 };
const speed = { type: 'floatOrPercent', min: 0, max: 200, sidetext: 'mm/s or %' };
const density = { type: 'percent', min: 0, max: 100, sidetext: '%' };
const walls = { type: 'int', min: 0, max: 1000 };

describe('checkOptionValue', () => {
  it('refuses text that is not a number', () => {
    expect(checkOptionValue(lineWidth, 'floatOrPercent', '0.7$')).toEqual({ kind: 'invalid', problem: '“0.7$” is not a number.' });
    expect(checkOptionValue(layerHeight, 'float', 'abc').kind).toBe('invalid');
    expect(checkOptionValue(layerHeight, 'float', '').kind).toBe('invalid');
    expect(checkOptionValue(density, 'percent', '15$%').kind).toBe('invalid');
    expect(checkOptionValue(lineWidth, 'floatOrPercent', '0.7$%').kind).toBe('invalid');
  });

  it('takes ordinary numbers, a comma as decimal point and "mm"', () => {
    expect(checkOptionValue(layerHeight, 'float', '0,2')).toEqual({ kind: 'ok', value: '0.2' });
    expect(checkOptionValue(layerHeight, 'float', ' .25 ')).toEqual({ kind: 'ok', value: '0.25' });
    expect(checkOptionValue(lineWidth, 'floatOrPercent', '0.42 mm')).toEqual({ kind: 'ok', value: '0.42' });
    expect(checkOptionValue(lineWidth, 'floatOrPercent', '110%')).toEqual({ kind: 'ok', value: '110%' });
    expect(checkOptionValue(density, 'percent', '15')).toEqual({ kind: 'ok', value: '15%' });
    expect(checkOptionValue(density, 'percent', '15 %')).toEqual({ kind: 'ok', value: '15%' });
  });

  it('takes % only where the setting allows it', () => {
    expect(checkOptionValue(layerHeight, 'float', '50%')).toEqual({ kind: 'invalid', problem: "This setting can't be a percentage." });
    expect(checkOptionValue(walls, 'int', '3%').kind).toBe('invalid');
  });

  it('wants whole numbers for whole-number settings', () => {
    expect(checkOptionValue(walls, 'int', '3')).toEqual({ kind: 'ok', value: '3' });
    expect(checkOptionValue(walls, 'int', '2.5')).toEqual({ kind: 'invalid', problem: '“2.5” is not a whole number.' });
  });

  it('sets values out of range to the nearest allowed one', () => {
    expect(checkOptionValue(density, 'percent', '150%')).toEqual({ kind: 'clamped', value: '100%', note: 'Allowed 0% to 100%, set to 100%.' });
    expect(checkOptionValue(layerHeight, 'float', '-1')).toEqual({ kind: 'clamped', value: '0', note: 'Lowest allowed is 0 mm, set to 0 mm.' });
    expect(checkOptionValue({ type: 'int', max: 5 }, 'int', '9')).toEqual({ kind: 'clamped', value: '5', note: 'Highest allowed is 5, set to 5.' });
  });

  it('asks percent or mm for a big "mm or %" value, like desktop', () => {
    expect(checkOptionValue(lineWidth, 'floatOrPercent', '150')).toEqual({ kind: 'ask', number: '150', unit: 'mm' });
    expect(checkOptionValue(lineWidth, 'floatOrPercent', '70').kind).toBe('ok');
    // Up to maxLiteral the value is taken as mm.
    expect(checkOptionValue(anchor, 'floatOrPercent', '400').kind).toBe('ok');
    expect(checkOptionValue(anchor, 'floatOrPercent', '1500').kind).toBe('ask');
    expect(checkOptionValue(speed, 'floatOrPercent', '150').kind).toBe('ok');
    expect(checkOptionValue(speed, 'floatOrPercent', '250')).toEqual({ kind: 'ask', number: '250', unit: 'mm/s' });
  });

  it('checks every value of a list typed whole', () => {
    const retraction = { type: 'floats', min: 0, sidetext: 'mm' };
    expect(checkOptionValue(retraction, 'floats', '0.8,1.2')).toEqual({ kind: 'ok', value: '0.8,1.2' });
    expect(checkOptionValue(retraction, 'floats', '0.8,x').kind).toBe('invalid');
    expect(checkOptionValue(retraction, 'floats', '0.8,-1')).toEqual({ kind: 'clamped', value: '0.8,0', note: 'Lowest allowed is 0 mm, set to 0 mm.' });
    expect(checkOptionValue({ type: 'floatsOrPercents', min: 0, sidetext: 'mm or %' }, 'floatsOrPercents', '150,50%')).toEqual({ kind: 'ok', value: '150,50%' });
  });

  it('leaves text, nil and other kinds alone', () => {
    expect(checkOptionValue({ type: 'string' }, 'string', 'anything $')).toEqual({ kind: 'ok', value: 'anything $' });
    expect(checkOptionValue({ type: 'floats', nullable: true }, 'float', 'nil')).toEqual({ kind: 'ok', value: 'nil' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  decodeIds,
  draftFromRow,
  encodeIds,
  LAYER_CYCLE,
  mixLabel,
  mixSettings,
  mixWarning,
  normalizeWeights,
  palette,
  patternIds,
  physicalFilaments,
  ratioFor,
  recipeFilaments,
  recipeFromDraft,
  SIMPLE,
  textOn,
  type MixDraft,
  type MixRow,
} from './mixing';

const draft = (d: Partial<MixDraft>): MixDraft => ({ ...draftFromRow(undefined, 4), ...d });

describe('colour mixing recipes (desktop MixedFilamentDialog::collect_result)', () => {
  it('ratio of two filaments keeps the percentage and the reduced layer ratio', () => {
    const r = recipeFromDraft(draft({ mode: 'ratio', filaments: [1, 3], percentB: 25 }));
    expect(r).toMatchObject({ componentA: 1, componentB: 3, mixBPercent: 25, ratioA: 3, ratioB: 1, distributionMode: SIMPLE, uiMode: 0, pattern: '', gradientIds: '' });
    expect(ratioFor(50)).toEqual([1, 1]);
    expect(ratioFor(40)).toEqual([3, 2]);
    expect(ratioFor(0)).toEqual([1, 0]);
    expect(ratioFor(100)).toEqual([0, 1]);
  });

  it('ratio of three filaments is a layer-cycle mix with weights summing to 100', () => {
    const r = recipeFromDraft(draft({ mode: 'ratio', filaments: [1, 2, 4], weights: [50, 30, 21] }));
    expect(r.distributionMode).toBe(LAYER_CYCLE);
    expect(r.gradientIds).toBe('124');
    expect(r.gradientWeights.split('/').map(Number).reduce((a, b) => a + b)).toBe(100);
  });

  it('cycle stores the pattern with components 1 and 2', () => {
    const r = recipeFromDraft(draft({ mode: 'cycle', pattern: '1 1 2x3', filaments: [3, 4] }));
    expect(r).toMatchObject({ pattern: '1123', componentA: 1, componentB: 2, uiMode: 1 });
    expect(recipeFromDraft(draft({ mode: 'cycle', pattern: '' })).pattern).toBe('12');
  });

  it('gradient goes from A to B up the object, or the other way', () => {
    const up = recipeFromDraft(draft({ mode: 'gradient', filaments: [2, 1] }));
    expect(up).toMatchObject({ gradientEnabled: true, gradientStart: 0.8, gradientEnd: 0.2, distributionMode: LAYER_CYCLE, componentA: 2, componentB: 1, uiMode: 3 });
    expect(recipeFromDraft(draft({ mode: 'gradient', reversed: true }))).toMatchObject({ gradientStart: 0.2, gradientEnd: 0.8 });
    expect(mixLabel(up)).toBe('F2 → F1');
  });

  it('match saves the recipe the engine found', () => {
    const pair = recipeFromDraft(draft({ mode: 'match', match: { valid: true, componentA: 2, componentB: 3, mixBPercent: 37, gradientIds: '', gradientWeights: '', colour: '#123456', deltaE: 1 } }));
    expect(pair).toMatchObject({ componentA: 2, componentB: 3, mixBPercent: 37, gradientIds: '23', distributionMode: SIMPLE, uiMode: 2 });
    const triple = recipeFromDraft(draft({ mode: 'match', match: { valid: true, componentA: 1, componentB: 2, mixBPercent: 40, gradientIds: '123', gradientWeights: '20/30/50', colour: '#123456', deltaE: 1 } }));
    expect(triple).toMatchObject({ gradientIds: '123', gradientWeights: '20/30/50', distributionMode: LAYER_CYCLE });
  });

  it('an existing row opens in the mode it was made in', () => {
    const row: MixRow = {
      ...recipeFromDraft(draft({ mode: 'ratio', filaments: [1, 2, 3], weights: [50, 25, 25] })),
      virtualId: 5,
      stableId: '1',
      gradientIdList: [1, 2, 3],
      localZMaxSublayers: 0,
      enabled: true,
      deleted: false,
      custom: true,
      colour: '#00FF00',
      compatible: true,
    };
    const d = draftFromRow(row, 4);
    expect(d.mode).toBe('ratio');
    expect(d.filaments).toEqual([1, 2, 3]);
    expect(d.weights).toEqual([50, 25, 25]);
    expect(recipeFromDraft(d).gradientWeights).toBe('50/25/25');
  });
});

describe('colour mixing helpers', () => {
  it('encodes filament lists like Orca', () => {
    expect(encodeIds([1, 2, 3])).toBe('123');
    expect(encodeIds([1, 12, 3])).toBe('1/12/3');
    expect(decodeIds('1/12/3')).toEqual([1, 12, 3]);
    expect(decodeIds('42')).toEqual([4, 2]);
    expect(patternIds('11[10]2')).toEqual([1, 1, 10, 2]);
  });

  it('normalizes weights to 100 by largest remainder', () => {
    expect(normalizeWeights([1, 1, 1])).toEqual([34, 33, 33]);
    expect(normalizeWeights([0, 0])).toEqual([100, 0]);
    expect(normalizeWeights([2, 1, 1])).toEqual([50, 25, 25]);
  });

  it('labels rows like the desktop panel', () => {
    expect(mixLabel(recipeFromDraft(draft({ mode: 'ratio', filaments: [1, 2], percentB: 30 })))).toBe('F1 70% + F2 30%');
    expect(mixLabel(recipeFromDraft(draft({ mode: 'cycle', pattern: '1112' })))).toBe('F1 75% + F2 25%');
    expect(mixLabel(recipeFromDraft(draft({ mode: 'ratio', filaments: [1, 2, 3], weights: [50, 25, 25] })))).toBe('F1 50% + F2 25% + F3 25%');
  });

  it('palette puts each mix at its filament number', () => {
    const row = (virtualId: number, colour: string, enabled = true) => ({ virtualId, colour, enabled }) as MixRow;
    expect(palette(['#A', '#B'], [row(3, '#C'), row(0, '#X', false), row(4, '#D')])).toEqual(['#A', '#B', '#C', '#D']);
  });

  it('knows which filaments a mix uses and warns on same colours', () => {
    expect(recipeFilaments(recipeFromDraft(draft({ mode: 'cycle', pattern: '1213' })))).toEqual([1, 2, 3]);
    const same = recipeFromDraft(draft({ mode: 'ratio', filaments: [1, 2] }));
    expect(mixWarning(same, ['#FF0000', '#ff0000'])).toMatch(/Same filament colours/);
    expect(mixWarning(same, ['#FF0000', '#0000FF'])).toBe('');
  });

  it('reads the colour-mixing settings from the config', () => {
    const m = mixSettings({ nozzle_diameter: '0.4,0.4', dithering_local_z_mode: '1', mixed_filament_height_lower_bound: '0.05' });
    expect(m.nozzles).toEqual([0.4, 0.4]);
    expect(m.settings).toMatchObject({ localZ: true, lowerBound: 0.05, upperBound: 0.16, bias: false });
  });

  it('picks black or white text so a swatch number always reads', () => {
    expect(textOn('#FFFF00')).toBe('#000'); // yellow
    expect(textOn('#FFFFFF')).toBe('#000');
    expect(textOn('#00FF00FF')).toBe('#000'); // with alpha
    expect(textOn('#000000')).toBe('#fff');
    expect(textOn('#0000FF')).toBe('#fff'); // blue
    expect(textOn('#7F1D1D')).toBe('#fff'); // dark red
    expect(textOn('not a colour')).toBe('#000');
  });
});

describe('physicalFilaments (desktop expand_virtual_extruder_ids)', () => {
  it('replaces each mix in use by its filaments', () => {
    const mix = { virtualId: 5, enabled: true, componentA: 2, componentB: 3, gradientIds: '', pattern: '' } as unknown as MixRow;
    expect(physicalFilaments([1, 5], [mix])).toEqual([1, 2, 3]);
    expect(physicalFilaments([1, 5], [{ ...mix, enabled: false }])).toEqual([1, 5]);
  });
});

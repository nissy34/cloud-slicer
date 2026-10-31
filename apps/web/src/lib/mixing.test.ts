import { describe, expect, it } from 'vitest';
import {
  applySuggestion,
  barycentric,
  minShare,
  mixSuggestions,
  spreadWeights,
  triangleCorners,
  trianglePoint,
  triangleWeights,
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

describe('mixing recommendations (desktop build_swatch_grid)', () => {
  it('Ratio with two filaments offers every pair at 50:50', () => {
    const s = mixSuggestions('ratio', 2, 4);
    expect(s).toHaveLength(6);
    expect(s[0]).toEqual({ filaments: [1, 2], weights: [50, 50], label: 'F1(50%) + F2(50%)' });
  });
  it('Ratio with three filaments offers each triple of the first six: equal, then each dominant', () => {
    const s = mixSuggestions('ratio', 3, 8);
    expect(s).toHaveLength(20 * 4);
    expect(s.slice(0, 4).map((x) => x.weights)).toEqual([[34, 33, 33], [50, 25, 25], [25, 50, 25], [25, 25, 50]]);
    expect(Math.max(...s.flatMap((x) => x.filaments))).toBe(6);
    expect(s[0].label).toBe('F1(34%)+F2(33%)+F3(33%)');
  });
  it('Gradient offers each pair both ways; Cycle none; Match pairs then triples', () => {
    expect(mixSuggestions('gradient', 2, 3).map((x) => x.label)).toEqual(['F1 → F2', 'F2 → F1', 'F1 → F3', 'F3 → F1', 'F2 → F3', 'F3 → F2']);
    expect(mixSuggestions('cycle', 2, 4)).toEqual([]);
    expect(mixSuggestions('match', 2, 4)).toHaveLength(6 + 4 * 4);
  });
  it('spreads weights over all filaments for one blend call', () => {
    expect(spreadWeights({ filaments: [3, 1], weights: [50, 50], label: '' }, 4)).toEqual([50, 0, 50, 0]);
  });
  it('tapping fills the dialog like desktop', () => {
    const d = draftFromRow(undefined, 4);
    expect(applySuggestion(d, { filaments: [2, 4], weights: [50, 50], label: '' }, '#123456')).toMatchObject({ filaments: [2, 4], percentB: 50 });
    expect(applySuggestion(d, { filaments: [1, 3, 4], weights: [25, 50, 25], label: '' }, '#123456')).toMatchObject({ filaments: [1, 3, 4], weights: [25, 50, 25] });
    expect(applySuggestion({ ...d, mode: 'gradient', reversed: true }, { filaments: [3, 1], weights: [50, 50], label: '' }, '#123456')).toMatchObject({ filaments: [3, 1], reversed: false });
    // Match stores a triple largest share first (build_multi_color_match_candidate).
    const m = applySuggestion({ ...d, mode: 'match' }, { filaments: [1, 2, 3], weights: [25, 50, 25], label: '' }, '#ABCDEF').match!;
    expect(m).toMatchObject({ valid: true, componentA: 2, componentB: 1, mixBPercent: 33, gradientIds: '213', gradientWeights: '50/25/25', colour: '#ABCDEF' });
    expect(recipeFromDraft({ ...d, mode: 'match', match: m })).toMatchObject({ distributionMode: LAYER_CYCLE, gradientIds: '213' });
  });
  it('Match hides suggestions below its Min share', () => {
    expect(minShare({ filaments: [1, 2, 3], weights: [50, 25, 25], label: '' })).toBe(25);
  });
});

describe('Ratio triangle (desktop build_tri_picker)', () => {
  const c = triangleCorners(160);
  it('puts the first filament on top, then bottom left, bottom right', () => {
    expect(c[0].y).toBeLessThan(c[1].y);
    expect(c[1].x).toBeLessThan(c[2].x);
    expect(c[1].y).toBeCloseTo(c[2].y);
  });
  it('the centre is an even split and the handle goes back to it', () => {
    const centre = { x: (c[0].x + c[1].x + c[2].x) / 3, y: (c[0].y + c[1].y + c[2].y) / 3 };
    expect([...triangleWeights(centre, c)].sort()).toEqual([33, 33, 34]);
    const p = trianglePoint([34, 33, 33], c);
    // Whole percents: within a pixel or two of the 160 px triangle.
    expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeLessThan(2);
  });
  it('holds every share between 10% and 90%, even dragged past a corner', () => {
    for (const p of [c[0], { x: c[0].x, y: -50 }, c[1], { x: 500, y: 500 }]) {
      const w = triangleWeights(p, c);
      expect(w.reduce((a, b) => a + b, 0)).toBe(100);
      for (const v of w) expect(v).toBeGreaterThanOrEqual(9);
      for (const v of w) expect(v).toBeLessThanOrEqual(90);
    }
    expect(triangleWeights(c[0], c)[0]).toBeGreaterThan(70);
  });
  it('barycentric weights sum to one', () => {
    const w = barycentric({ x: 70, y: 100 }, c);
    expect(w[0] + w[1] + w[2]).toBeCloseTo(1);
  });
});

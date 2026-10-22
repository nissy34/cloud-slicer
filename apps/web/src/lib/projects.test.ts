import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '../engine/protocol';
import { copyName, formatBytes, freeName, formatWhen, nameFromFile, projectFileName, projectSignature } from './projects';

describe('project names', () => {
  it('comes from the file name without its extension', () => {
    expect(nameFromFile('benchy v2.3mf')).toBe('benchy v2');
    expect(nameFromFile('C:\\models\\Cube.STL')).toBe('Cube');
    expect(nameFromFile('.3mf')).toBe('Untitled');
  });
  it('makes a safe download name', () => {
    expect(projectFileName('a/b: c?')).toBe('a b c.3mf');
    expect(projectFileName('  ')).toBe('Untitled.3mf');
  });
  it('numbers copies that are already taken', () => {
    expect(copyName('Benchy', [])).toBe('Benchy (copy)');
    expect(copyName('Benchy', ['Benchy (copy)'])).toBe('Benchy (copy 2)');
    expect(copyName('Benchy (copy)', ['Benchy (copy)'])).toBe('Benchy (copy 2)');
    expect(freeName('Benchy', ['Cube'])).toBe('Benchy');
    expect(freeName('Benchy', ['Benchy'])).toBe('Benchy (2)');
    expect(freeName('Benchy', ['Benchy', 'Benchy (2)'])).toBe('Benchy (3)');
  });
});

describe('project signature', () => {
  const project = {
    fileName: '',
    plateWidth: 270,
    plateDepth: 270,
    plates: [{ index: 0, name: '', objects: [0], filaments: [1], layerCodes: [] }],
    objects: [{ name: 'cube', size: [10, 10, 10], units: '', extruder: 0, settings: {}, volumes: [], instances: [] }],
  } as unknown as ProjectInfo;
  const sel = { printer: 'U1', process: 'p', filaments: ['PLA'], colours: ['#fff'] };
  it('changes with what a save keeps, not with the shown plate', () => {
    const a = projectSignature(project, sel, {});
    expect(projectSignature({ ...project }, { ...sel }, {})).toBe(a);
    expect(projectSignature(project, sel, { layer_height: '0.28' })).not.toBe(a);
    expect(projectSignature(project, { ...sel, colours: ['#000'] }, {})).not.toBe(a);
    const moved = { ...project, objects: [{ ...project.objects[0], settings: { wall_loops: '4' } }] } as ProjectInfo;
    expect(projectSignature(moved, sel, {})).not.toBe(a);
  });
});

describe('formatting', () => {
  it('sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
    expect(formatBytes(42 * 1024 * 1024)).toBe('42 MB');
  });
  it('times', () => {
    const now = 1_000_000_000_000;
    expect(formatWhen(now - 10_000, now)).toBe('just now');
    expect(formatWhen(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatWhen(now - 3 * 3600_000, now)).toBe('3 h ago');
  });
});

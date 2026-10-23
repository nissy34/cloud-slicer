import { describe, expect, it } from 'vitest';
import type { SettingsPage } from '../engine/protocol';
import { shownPages } from './settings-pages';

const page = (name: string, more: Partial<SettingsPage> = {}): SettingsPage => ({ page: name, groups: [{ title: 'G', options: ['k'] }], ...more });
const layout = [
  page('Basic information'),
  page('Multimaterial'),
  page('Extruder', { extruder: true }),
  page('Motion ability', { flavors: ['marlin2', 'klipper'] }),
  page('Notes'),
];

describe('shownPages', () => {
  it('has one Extruder page per extruder, each editing its own entry', () => {
    const pages = shownPages(layout, 4, 'klipper');
    expect(pages.map((p) => p.page)).toEqual([
      'Basic information',
      'Multimaterial',
      'Extruder 1',
      'Extruder 2',
      'Extruder 3',
      'Extruder 4',
      'Motion ability',
      'Notes',
    ]);
    expect(pages.filter((p) => p.extruder).map((p) => p.index)).toEqual([0, 1, 2, 3]);
  });

  it('shows Motion ability only for the flavors desktop has it for', () => {
    expect(shownPages(layout, 1, 'reprap').map((p) => p.page)).toEqual(['Basic information', 'Multimaterial', 'Extruder 1', 'Notes']);
    expect(shownPages(layout, 1, undefined).some((p) => p.page === 'Motion ability')).toBe(false);
  });

  it("leaves out post-processing scripts, which a browser can't run", () => {
    const withScripts = [
      page('Others', { groups: [{ title: 'Output', options: ['filename_format'] }, { title: 'Post-processing Scripts', options: ['post_process'] }] }),
      page('Scripts only', { groups: [{ title: 'Post-processing Scripts', options: ['post_process'] }] }),
    ];
    expect(shownPages(withScripts, 1, 'klipper')).toEqual([{ page: 'Others', groups: [{ title: 'Output', options: ['filename_format'] }] }]);
  });
});

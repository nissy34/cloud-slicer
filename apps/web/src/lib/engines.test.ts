import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { appOfModelHead, engineOf3mf, engineOfModelHead } from './engines';

const model = (meta: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n${meta}\n <resources>\n${' <object id="1"/>\n'.repeat(5000)} </resources>\n</model>`;
const threeMf = (meta: string, level: 0 | 6 = 6) =>
  new Blob([zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'Metadata/project_settings.config': strToU8('{}'), '3D/3dmodel.model': [strToU8(model(meta)), { level }] }) as Uint8Array<ArrayBuffer>]);

describe('engineOfModelHead', () => {
  it('tells the engines apart, and nothing else', () => {
    expect(engineOfModelHead(' <metadata name="Application">Snapmaker_Orca-2.4.0</metadata>')).toBe('snapmaker');
    expect(engineOfModelHead(' <metadata name="Application">BambuStudio-02.06.00.51</metadata>\n <metadata name="OrcaSlicer">2.4.2</metadata>')).toBe('orca');
    expect(engineOfModelHead(' <metadata name="Application">BambuStudio-02.01.00.59</metadata>')).toBe(null);
    expect(engineOfModelHead('')).toBe(null);
  });
});

describe('appOfModelHead', () => {
  it('names the program that wrote the project', () => {
    expect(appOfModelHead(' <metadata name="Application">BambuStudio-02.05.00.66</metadata>')).toBe('Bambu Studio 2.5');
    expect(appOfModelHead(' <metadata name="Application">BambuStudio-02.06.00.51</metadata>\n <metadata name="OrcaSlicer">2.4.2</metadata>')).toBe('OrcaSlicer');
    expect(appOfModelHead(' <metadata name="Application">Snapmaker_Orca-2.4.0</metadata>')).toBe('Snapmaker Orca');
    expect(appOfModelHead(' <metadata name="Application">PrusaSlicer-2.9.0</metadata>')).toBe('PrusaSlicer-2.9.0');
    expect(appOfModelHead('')).toBe('');
  });
});

describe('engineOf3mf', () => {
  it('reads the model of a compressed or stored 3MF', async () => {
    expect(await engineOf3mf(threeMf('<metadata name="Application">Snapmaker_Orca-2.4.0</metadata>'))).toBe('snapmaker');
    expect(await engineOf3mf(threeMf('<metadata name="OrcaSlicer">2.4.2</metadata>', 0))).toBe('orca');
    expect(await engineOf3mf(threeMf('<metadata name="Application">BambuStudio-02.01.00.59</metadata>'))).toBe(null);
  });
  it('is null for something that is not a zip', async () => {
    expect(await engineOf3mf(new Blob(['solid cube\nendsolid']))).toBe(null);
  });
});

// Phase 0 choices, mirroring engine/node/app-defaults.mjs (what the worker
// slices with). Phase 1 replaces this with the bundled Snapmaker presets.

export const PRINTER = { name: 'Snapmaker U1', nozzle: '0.4 mm nozzle', bed: { x: 270, y: 270, z: 270 } };

export const PROCESS = '0.20 mm Standard';

export const MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PVA'] as const;

export const PLATES: Record<string, string> = {
  TEXTURED_PEI: 'Textured PEI',
  SMOOTH_PEI: 'Smooth PEI',
  COOL_PLATE: 'Cool Plate',
  ENGINEERING_PLATE: 'Engineering Plate',
};

export const MODEL_EXTENSIONS = ['.stl', '.3mf', '.obj'];

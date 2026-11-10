#!/usr/bin/env node
// Cloud Slicer's MCP server: lets Claude (Claude Code, Claude Desktop) open
// models, choose presets, change settings and slice on this computer, with the
// same engine and presets as the site. Nothing here goes over the internet.
//
//   node dist/server.mjs          (Claude starts it; it talks over stdin/stdout)
//
// Design and rules: docs/architecture/mcp.md.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { formatDuration } from '../../web/src/lib/format';
import { ENGINES, Slicer, type ModelInfo, type SliceResult } from './slicer';

const here = dirname(fileURLToPath(import.meta.url));
const slicer = new Slicer(here, here);
const server = new McpServer(
  { name: 'cloud-slicer', version: '0.1.0' },
  {
    instructions:
      'Slices 3D models for 3D printers on this computer with Cloud Slicer (OrcaSlicer). ' +
      'Typical order: open_model, then choose_presets (printer, process, filaments) and change_settings if asked, then slice. ' +
      'Settings use OrcaSlicer option keys (find_settings looks them up). Object numbers come from model_info.',
  },
);

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] });
const failure = (e: unknown) => ({ ...text(e instanceof Error ? e.message : String(e)), isError: true });
async function run<T>(fn: () => Promise<T>) {
  try {
    return text(await fn());
  } catch (e) {
    return failure(e);
  }
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** A plate picture (rows bottom to top, like OpenGL) as a PNG on a white ground. */
function toPng({ width, height, pixels }: { width: number; height: number; pixels: Uint8Array }) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = ((height - 1 - y) * width + x) * 4, o = (y * width + x) * 4;
      const a = pixels[i + 3] / 255;
      for (let k = 0; k < 3; k++) png.data[o + k] = Math.round(pixels[i + k] * a + 255 * (1 - a));
      png.data[o + 3] = 255;
    }
  return PNG.sync.write(png);
}

/** What Claude needs to know about the open model: objects by number, sizes, where each copy is. */
function summary(info: ModelInfo | null) {
  if (!info) return { open: false };
  return {
    file: info.fileName,
    plates: info.plates.length,
    objects: info.objects.map((o, i) => ({
      object: i,
      name: o.name,
      sizeMm: o.size.map((v) => round(v)),
      filamentSlot: o.extruder || 1,
      ...(Object.keys(o.settings ?? {}).length && { ownSettings: o.settings }),
      ...(o.volumes.length > 1 || o.volumes.some((v) => v.painted)
        ? {
            parts: o.volumes.map((v, k) => ({
              part: k,
              name: v.name,
              ...(v.kind !== 'part' && { kind: v.kind }),
              filamentSlot: v.extruder || o.extruder || 1,
              ...(v.painted && { painted: 'colours painted on, each from its own slot' }),
              ...(Object.keys(v.settings ?? {}).length && { ownSettings: v.settings }),
            })),
          }
        : {}),
      copies: o.instances.map((c, j) => ({
        copy: j,
        plate: c.plate,
        positionMm: c.offset.map((v) => round(v)),
        rotationDeg: c.rotation.map((v) => round(v)),
        scale: c.scale.map((v) => round(v, 3)),
        ...(c.printable ? {} : { printable: false }),
        // Off every plate (like desktop): shown on the nearest plate but not printed with it.
        ...(c.loose ? { offEveryPlate: true } : {}),
      })),
    })),
  };
}

function presets() {
  const l = slicer.lists!;
  return {
    engine: `${slicer.info?.name} ${slicer.info?.version}`,
    printer: l.selection.printer,
    process: l.selection.process,
    filaments: l.selection.filaments.map((name, i) => ({ slot: i + 1, name, colour: l.selection.colours[i] })),
    changedSettings: slicer.overrides,
  };
}

function stats(r: SliceResult) {
  const perFilament = Object.entries(r.filamentParts ?? {}).map(([slot, parts]) => {
    const g = Object.values(parts).reduce((s, p) => s + p.g, 0);
    const mm = Object.values(parts).reduce((s, p) => s + p.mm, 0);
    return { slot: Number(slot), grams: round(g), metres: round(mm / 1000, 2), ...(Object.keys(parts).length > 1 && { parts: Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, round(p.g)])) }) };
  });
  return {
    printTime: formatDuration(r.estimatedTimeSeconds),
    printSeconds: Math.round(r.estimatedTimeSeconds),
    layers: r.totalLayers,
    grams: round(r.totalFilamentGrams),
    metres: round(r.totalFilamentMm / 1000, 2),
    ...(r.totalCost ? { cost: round(r.totalCost, 2) } : {}),
    perFilament,
    ...(r.warnings?.length ? { warnings: r.warnings } : {}),
    ...(r.objectsOutside?.length ? { objectsOutsideThePlate: r.objectsOutside } : {}),
  };
}

const engineChoice = z.enum(['snapmaker', 'orca']).describe(`Which engine: "snapmaker" (${ENGINES.snapmaker}, the default) or "orca" (${ENGINES.orca}). Switching starts over with no model open.`);

server.registerTool(
  'open_model',
  {
    title: 'Open a model',
    description:
      'Opens a 3D model file from this computer (STL, 3MF, OBJ or AMF; not STEP). A 3MF project brings its own presets and settings. ' +
      'With add, the file goes beside what is already open instead of replacing it.',
    inputSchema: {
      path: z.string().describe('Full path of the file'),
      add: z.boolean().optional().describe('Add to the open model instead of replacing it'),
      engine: engineChoice.optional(),
    },
  },
  ({ path, add, engine }) =>
    run(async () => {
      const { notes } = await slicer.open(path, { add, engine });
      return { ...summary(slicer.model), presets: presets(), ...(notes.length && { notes }) };
    }),
);

server.registerTool(
  'model_info',
  { title: 'What is open', description: 'The open model: objects by number, their sizes in mm, and where each copy sits on the plate. Also the chosen presets.', inputSchema: {} },
  () => run(async () => (await slicer.engine(), { ...summary(slicer.model), presets: presets() })),
);

server.registerTool(
  'find_printers',
  {
    title: 'Find printers',
    description: 'Printer presets by brand and model, e.g. search "bambu a1" or "prusa mk4". Use a printer name from here in choose_presets.',
    inputSchema: { search: z.string().optional().describe('Words to look for; empty lists every brand') },
  },
  ({ search }) =>
    run(async () => {
      await slicer.engine();
      const found = slicer.printers(search ?? '');
      if (!search) return found.map((v) => ({ brand: v.brand, models: v.models.length }));
      return found.length ? found : `No printer matches "${search}".`;
    }),
);

server.registerTool(
  'choose_presets',
  {
    title: 'Choose presets',
    description:
      'Chooses the printer, process (quality) and filament presets. Leave process out for the printer\'s default. ' +
      'filaments and colours are per filament slot (slot 1 first); colours are "#RRGGBB". Returns the choice and what fits the printer.',
    inputSchema: {
      printer: z.string().optional().describe('Printer preset name, e.g. "Snapmaker U1 (0.4 nozzle)"'),
      process: z.string().optional().describe('Process preset name'),
      filaments: z.array(z.string()).optional().describe('Filament preset name per slot'),
      colours: z.array(z.string()).optional().describe('Colour per slot, "#RRGGBB"'),
    },
  },
  (args) =>
    run(async () => {
      const { missing } = await slicer.select(args);
      return { ...presets(), ...(missing.length && { notFound: missing.map((m) => `${m} isn't a preset for this printer, so it was not chosen`) }) };
    }),
);

server.registerTool(
  'list_presets',
  {
    title: 'List presets',
    description: 'Process and filament presets that fit the chosen printer. search narrows the list (e.g. "PETG", "0.16").',
    inputSchema: { search: z.string().optional() },
  },
  ({ search }) =>
    run(async () => {
      await slicer.engine();
      const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const hit = (name: string) => words.every((w) => name.toLowerCase().includes(w));
      const l = slicer.lists!;
      return {
        printer: l.selection.printer,
        processes: l.processes.filter((p) => p.compatible !== false && hit(p.name)).map((p) => p.name),
        filaments: l.filaments.filter((f) => f.compatible !== false && hit(`${f.name} ${f.filamentType ?? ''}`)).map((f) => ({ name: f.name, type: f.filamentType })),
      };
    }),
);

server.registerTool(
  'find_settings',
  {
    title: 'Find settings',
    description: 'Looks up OrcaSlicer settings by words, e.g. "wall loops", "infill density", "support". Returns their keys for read_settings and change_settings.',
    inputSchema: { search: z.string() },
  },
  ({ search }) => run(async () => (await slicer.engine(), slicer.find(search))),
);

server.registerTool(
  'read_settings',
  {
    title: 'Read settings',
    description: 'Current values of settings by OrcaSlicer key (e.g. layer_height, wall_loops, sparse_infill_density), with what each one is, its unit and allowed values.',
    inputSchema: { keys: z.array(z.string()).min(1) },
  },
  ({ keys }) => run(async () => (await slicer.engine(), slicer.read(keys))),
);

server.registerTool(
  'change_settings',
  {
    title: 'Change settings',
    description:
      'Changes settings on top of the presets, by OrcaSlicer key: {"wall_loops": 4, "sparse_infill_density": "25%", "enable_support": true}. ' +
      'Values are as OrcaSlicer writes them. null takes a change back. Unknown keys and values that are not numbers or not one of the choices are refused; out of range is set to the nearest allowed value (notes say so).',
    inputSchema: { settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])) },
  },
  ({ settings }) =>
    run(async () => {
      await slicer.engine();
      const { applied, refused, notes } = await slicer.change(settings);
      return { applied, ...(refused.length && { refused }), ...(notes.length && { notes }), changedSettings: slicer.overrides };
    }),
);

server.registerTool(
  'slice',
  {
    title: 'Slice',
    description:
      'Slices a plate (or every plate) with the chosen presets and settings and writes the G-code file, with the plate picture for the printer screen. ' +
      'Returns print time, filament use in grams and metres per slot, layers and warnings. ' +
      'out is a .gcode file or a folder; default is beside the model. settings (optional) apply to this slice only.',
    inputSchema: {
      plate: z.number().int().min(0).optional().describe('Plate number, from 0'),
      allPlates: z.boolean().optional().describe('Slice every plate, one G-code file each'),
      out: z.string().optional(),
      settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    },
  },
  ({ plate, allPlates, out, settings }, extra) =>
    run(async () => {
      await slicer.engine();
      const token = extra._meta?.progressToken;
      const plates = allPlates ? [...Array(slicer.model?.plates.length ?? 1).keys()] : [plate ?? 0];
      if (allPlates && out && /\.gcode$/i.test(out)) throw new Error('For every plate, out must be a folder.');
      const once = settings && Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)]));
      const results = [];
      for (const [n, p] of plates.entries()) {
        let last = -1;
        const progress = token === undefined ? undefined : (pct: number, stage: string) => {
          const overall = Math.floor((n * 100 + pct) / plates.length);
          if (overall === last) return;
          last = overall;
          const message = plates.length > 1 ? `Plate ${p + 1}: ${stage}` : stage;
          extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: overall, total: 100, message } }).catch(() => {});
        };
        const { file, file3mf, result, pictures } = await slicer.slice({ plate: p, out, settings: once }, progress);
        results.push({ ...(plates.length > 1 && { plate: p }), gcodeFile: file, ...(file3mf && { gcode3mfFile: file3mf }), ...stats(result), platePictures: pictures });
      }
      return plates.length > 1 ? { plates: results, presets: presets() } : { ...results[0], presets: presets() };
    }),
);

server.registerTool(
  'save_project',
  {
    title: 'Save project',
    description: 'Saves the model with its presets and changed settings as a 3MF project that Cloud Slicer and desktop OrcaSlicer open.',
    inputSchema: { path: z.string().describe('Full path of the .3mf to write') },
  },
  ({ path }) => run(async () => ({ saved: await slicer.save(path) })),
);

const copyArgs = {
  object: z.number().int().min(0).describe('Object number from model_info'),
  copy: z.number().int().min(0).optional().describe('Copy number (default 0)'),
};

server.registerTool(
  'move_object',
  {
    title: 'Move, turn or scale',
    description:
      'Moves, turns or scales one copy of an object. positionMm is [x, y] from the plate\'s front left corner (the object\'s centre); ' +
      'rotationDeg is [x, y, z]; scale is [x, y, z] (1 = full size). Leave out what stays the same.',
    inputSchema: {
      ...copyArgs,
      positionMm: z.array(z.number()).min(2).max(3).optional(),
      rotationDeg: z.array(z.number()).length(3).optional(),
      scale: z.array(z.number().positive()).length(3).optional(),
      plate: z.number().int().min(0).optional().describe('Move it to this plate (from 0); the number after the last plate makes a new one'),
    },
  },
  ({ object, copy, positionMm, rotationDeg, scale, plate }) =>
    run(async () => {
      await slicer.engine();
      const model = await slicer.transform(object, copy ?? 0, {
        ...(positionMm && { offset: positionMm }),
        ...(rotationDeg && { rotation: rotationDeg }),
        ...(scale && { scale }),
        ...(plate !== undefined && { plate }),
      });
      return summary(model);
    }),
);

server.registerTool(
  'set_copies',
  { title: 'Number of copies', description: 'Sets how many copies of an object there are. Run arrange_plate after adding copies.', inputSchema: { object: copyArgs.object, count: z.number().int().min(1).max(200) } },
  ({ object, count }) => run(async () => (await slicer.engine(), summary(await slicer.copies(object, count)))),
);

server.registerTool(
  'set_filament',
  {
    title: 'Choose an object\'s filament',
    description: 'Prints an object, or one part of it, with a filament slot (1 = the first). Slots and their colours come from choose_presets.',
    inputSchema: { object: copyArgs.object, part: z.number().int().min(0).optional().describe('Part number from model_info; leave out for the whole object'), slot: z.number().int().min(1) },
  },
  ({ object, part, slot }) => run(async () => (await slicer.engine(), summary(await slicer.setFilament(object, part, slot)))),
);

server.registerTool(
  'object_settings',
  {
    title: 'Settings for one object',
    description:
      'Settings for one object (or part) only, on top of the plate\'s: e.g. {"wall_loops": 5, "sparse_infill_density": "40%"}, ' +
      'the settings OrcaSlicer\'s object list offers. null takes one back.',
    inputSchema: {
      object: copyArgs.object,
      part: z.number().int().min(0).optional(),
      settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    },
  },
  ({ object, part, settings }) =>
    run(async () => {
      await slicer.engine();
      const { model, refused, notes } = await slicer.objectSettings(object, part, settings);
      return { ...(refused.length && { refused }), ...(notes.length && { notes }), ...summary(model) };
    }),
);

server.registerTool(
  'show_plate',
  {
    title: 'Look at the plate',
    description: 'A picture of a plate with its objects in their filament colours, seen from the front left like OrcaSlicer\'s plate picture.',
    inputSchema: { plate: z.number().int().min(0).optional() },
  },
  async ({ plate }) => {
    try {
      await slicer.engine();
      const picture = await slicer.picture(plate ?? 0);
      if (!picture) return text('The plate is empty.');
      return { content: [{ type: 'image' as const, data: toPng(picture).toString('base64'), mimeType: 'image/png' }] };
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  'remove_object',
  { title: 'Remove an object', description: 'Removes an object and all its copies.', inputSchema: { object: copyArgs.object } },
  ({ object }) => run(async () => (await slicer.engine(), summary(await slicer.remove(object)))),
);

server.registerTool(
  'arrange_plate',
  { title: 'Arrange', description: 'Spreads the objects on a plate so none overlap; any that don\'t fit go to new plates.', inputSchema: { plate: z.number().int().min(0).optional(), spacingMm: z.number().min(0).optional() } },
  ({ plate, spacingMm }) => run(async () => (await slicer.engine(), summary(await slicer.arrange(plate ?? 0, spacingMm ?? 6)))),
);

server.registerTool(
  'auto_orient',
  { title: 'Auto orient', description: 'Turns an object so it prints with the least overhang, like OrcaSlicer\'s Orient.', inputSchema: { object: copyArgs.object } },
  ({ object }) => run(async () => (await slicer.engine(), summary(await slicer.orient(object)))),
);

await server.connect(new StdioServerTransport());
const stop = async () => {
  await slicer.close();
  process.exit(0);
};
process.stdin.on('close', stop);
process.on('SIGTERM', stop);

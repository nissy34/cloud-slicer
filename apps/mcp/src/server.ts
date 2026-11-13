#!/usr/bin/env node
// Cloud Slicer's MCP server: lets Claude (Claude Code, Claude Desktop) open
// models, choose presets, change settings and slice on this computer, with the
// same engine and presets as the site. Slicing stays on this computer; only
// signing in (account.ts) and what needs the account talk to the site.
//
//   node dist/server.mjs          (Claude starts it; it talks over stdin/stdout)
//
// Design and rules: docs/architecture/mcp.md.
import { randomInt } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { formatDuration } from '../../web/src/lib/format';
import { newPrintId, withPrintTag } from '../../web/src/lib/prints';
import type { StoredPreset } from '../../web/src/lib/preset-engines';
import { Account } from './account';
import { pngOf } from './png';
import { Printers } from './printers';
import { OnlineProjects, type PlateOrigin } from './projects';
import { ENGINES, Slicer, type ModelInfo, type SliceResult } from './slicer';

const here = dirname(fileURLToPath(import.meta.url));
const slicer = new Slicer(here, here);
const account = new Account();
/** When the account's presets were last fetched; 0 asks again on the next tool call. */
let presetsAt = 0;
const printers = new Printers(account);
/** The newest slice's files: what send_to_printer sends when not told a file. */
let lastSliced: { gcodeFile: string; gcode3mfFile?: string; origin?: PlateOrigin } | null = null;
const projects = new OnlineProjects(account, slicer);
account.onChange = () => (presetsAt = 0);

/**
 * Brings the person's own presets (from their account) into the engine: at most once a
 * minute while tools are used, and at once after signing in or out. Offline, or with
 * the site down, it carries on with what it has.
 */
async function syncAccount() {
  if (!account.signedIn) return slicer.setUserPresets([]);
  if (Date.now() - presetsAt < 60_000) return;
  presetsAt = Date.now();
  const r = await account.api<{ presets: StoredPreset[] }>('/presets', { signal: AbortSignal.timeout(8000) }).catch(() => null);
  await slicer.setUserPresets(r?.presets ?? (account.signedIn ? slicer.mineNow() : []));
}
const server = new McpServer(
  { name: 'cloud-slicer', version: '0.1.0' },
  {
    instructions:
      'Slices 3D models for 3D printers on this computer with Cloud Slicer (OrcaSlicer). ' +
      'Typical order: open_model, then choose_presets (printer, process, filaments) and change_settings if asked, then slice. ' +
      'Settings use OrcaSlicer option keys (find_settings looks them up). Object numbers come from model_info. ' +
      'Slicing needs no account. sign_in connects the person\'s Cloud Slicer account: give them the link and code it returns, then check with account.',
  },
);

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] });
const failure = (e: unknown) => ({ ...text(e instanceof Error ? e.message : String(e)), isError: true });
async function run<T>(fn: () => Promise<T>) {
  try {
    await syncAccount();
    return text(await fn());
  } catch (e) {
    if (e instanceof NeedsYes) return text(e.answer);
    return failure(e);
  }
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

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
      // A file from this computer: what is open is no longer the online project (added to one, it still is).
      if (!add) projects.current = null;
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
    description:
      'Printer presets by brand and model, e.g. search "bambu a1" or "prusa mk4", and (signed in) the person\'s own printer presets under yours. ' +
      'Use a printer name from here in choose_presets.',
    inputSchema: { search: z.string().optional().describe('Words to look for; empty lists every brand') },
  },
  ({ search }) =>
    run(async () => {
      await slicer.engine();
      const found = slicer.printers(search ?? '');
      const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const yours = slicer.myPresets('printer').filter((n) => words.every((w) => n.toLowerCase().includes(w)));
      const mine = yours.length ? { yours } : {};
      if (!search) return { ...mine, brands: found.map((v) => ({ brand: v.brand, models: v.models.length })) };
      return found.length || yours.length ? { ...mine, brands: found } : `No printer matches "${search}".`;
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
    description:
      'Process and filament presets that fit the chosen printer; the person\'s own (from their account, when signed in) are marked yours. search narrows the list (e.g. "PETG", "0.16").',
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
        processes: l.processes.filter((p) => p.compatible !== false && hit(p.name)).map((p) => (p.user ? { name: p.name, yours: true } : p.name)),
        filaments: l.filaments
          .filter((f) => f.compatible !== false && hit(`${f.name} ${f.filamentType ?? ''}`))
          .map((f) => ({ name: f.name, type: f.filamentType, ...(f.user && { yours: true }) })),
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
        // A plate of an online project: a send goes into its print history, as from the site.
        const origin = projects.current ? await slicer.plateFingerprint(p).then((f) => ({ projectId: projects.current!.id, plate: p, ...f }), () => undefined) : undefined;
        lastSliced = { gcodeFile: file, ...(file3mf && { gcode3mfFile: file3mf }), ...(origin && { origin }) };
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
      return { content: [{ type: 'image' as const, data: pngOf(picture).toString('base64'), mimeType: 'image/png' }] };
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
  {
    title: 'Arrange',
    description: 'Spreads the objects on a plate so none overlap; any that don\'t fit go to new plates. Options are desktop OrcaSlicer\'s Arrange options.',
    inputSchema: {
      plate: z.number().int().min(0).optional(),
      spacingMm: z.number().min(0).optional().describe('Gap between objects; 0 or left out = auto'),
      autoRotate: z.boolean().optional().describe('Turn objects to fit more (desktop "Auto rotate for arrangement")'),
      alignToYAxis: z.boolean().optional().describe('Desktop "Align to Y axis"; left out = on for printers whose bed moves along Y; ignored with autoRotate'),
      multipleMaterialsOnPlate: z.boolean().optional().describe('Desktop "Allow multiple materials on same plate" (default true); false puts objects with different filaments on plates of their own'),
    },
  },
  ({ plate, spacingMm, autoRotate, alignToYAxis, multipleMaterialsOnPlate }) =>
    run(async () => (
      await slicer.engine(),
      summary(await slicer.arrange(plate ?? 0, { spacing: spacingMm, rotate: autoRotate, alignY: alignToYAxis, multiMaterial: multipleMaterialsOnPlate }))
    )),
);

server.registerTool(
  'auto_orient',
  { title: 'Auto orient', description: 'Turns an object so it prints with the least overhang, like OrcaSlicer\'s Orient.', inputSchema: { object: copyArgs.object } },
  ({ object }) => run(async () => (await slicer.engine(), summary(await slicer.orient(object)))),
);

server.registerTool(
  'sign_in',
  {
    title: 'Sign in to Cloud Slicer',
    description:
      'Connects the person\'s Cloud Slicer account (their saved presets and printers). Returns a link and a code: ask the person to open the link ' +
      '(signed in on the site), check the code matches and tap Connect. Then call account to see that it worked. No password goes through here.',
    inputSchema: {},
  },
  () =>
    run(async () => {
      if (account.signedIn) return { alreadySignedIn: true, ...(await account.status()) };
      const p = await account.start();
      return {
        link: p.link,
        code: p.code,
        expiresInMinutes: Math.round((p.expiresAt - Date.now()) / 60000),
        tell: `Open ${p.link} , check it shows ${p.code}, and tap Connect.`,
      };
    }),
);

server.registerTool(
  'account',
  { title: 'Account', description: 'Who is signed in to Cloud Slicer, or whether a sign-in is still waiting for the person to tap Connect.', inputSchema: {} },
  () => run(() => account.status()),
);

server.registerTool(
  'sign_out',
  { title: 'Sign out', description: 'Signs out of Cloud Slicer here and ends the session on the site.', inputSchema: {} },
  () => run(async () => (await account.signOut(), { signedIn: false })),
);

/** Not an error: the action waits for the person's yes in the chat (see `asker`). */
class NeedsYes extends Error {
  readonly answer: Record<string, unknown>;
  constructor(answer: Record<string, unknown>) {
    super('waiting for a yes');
    this.answer = answer;
  }
}

/** Codes for a yes given in the chat (apps that can't show a popup), each for one exact action. */
const chatYes = new Map<string, { action: string; until: number }>();
const CHAT_YES_MS = 5 * 60_000;

/**
 * Asks the person and answers whether they said yes. Where the app can show it, on
 * screen (MCP elicitation: an Accept popup). Where it can't (Claude on a phone, through
 * Claude Desktop), the first call does nothing and hands back a one-time code: Claude asks
 * in the chat, and only a second call with the same action and that code goes ahead.
 */
function asker(tool: string, args: Record<string, unknown>, code: string | undefined) {
  const action = JSON.stringify([tool, Object.entries(args).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))]);
  return async (message: string): Promise<boolean> => {
    if (server.server.getClientCapabilities()?.elicitation) {
      const answer = await server.server.elicitInput({ message: `${message}\nAccept to go ahead, Decline to stop.`, requestedSchema: { type: 'object', properties: {} } });
      return answer.action === 'accept';
    }
    const now = Date.now();
    for (const [k, v] of chatYes) if (v.until < now) chatYes.delete(k);
    const given = code && chatYes.get(code);
    if (given && given.action === action) {
      chatYes.delete(code!);
      return true;
    }
    const fresh = String(randomInt(100000, 1000000));
    chatYes.set(fresh, { action, until: now + CHAT_YES_MS });
    throw new NeedsYes({
      done: false,
      askThePerson: message,
      confirm: fresh,
      note: `Nothing was done yet. Ask the person this question in your reply, in plain words, without the code. Only if they say yes, call ${tool} again with exactly the same arguments plus this confirm (once, within 5 minutes). If they say no, leave it.`,
    });
  };
}

const confirmArg = z
  .string()
  .optional()
  .describe('Only the code an earlier answer gave, and only after the person said yes to it in the chat');

server.registerTool(
  'online_projects',
  {
    title: 'Your online projects',
    description:
      'The person\'s online projects (the site\'s Online projects window; the files are in their Google Drive), newest first: name, when changed, plates, which plates were printed. Needs sign_in.',
    inputSchema: {},
  },
  () => run(() => projects.list()),
);

server.registerTool(
  'open_online_project',
  {
    title: 'Open an online project',
    description:
      'Opens one of the person\'s online projects (name from online_projects) from their Google Drive, with its presets and settings. ' +
      'Like opening it on another computer: a site tab with it open only views it from then on. Needs sign_in.',
    inputSchema: { project: z.string().describe('Project name from online_projects') },
  },
  ({ project }) =>
    run(async () => {
      const { notes } = await projects.open(project);
      return { project: projects.current?.name, ...summary(slicer.model), presets: presets(), ...(notes.length && { notes }) };
    }),
);

server.registerTool(
  'save_online_project',
  {
    title: 'Save to online projects',
    description:
      'Saves what is open to the person\'s online projects, in their Google Drive: over the online project it was opened from, or (asNew, or a file from this computer) as a new one with name. ' +
      'Asks the person first, every time. Refused when the project was changed elsewhere since it was opened. Needs sign_in.',
    inputSchema: {
      name: z.string().optional().describe('Name for a new project (default: the open project\'s name)'),
      asNew: z.boolean().optional().describe('Save as a new project even when an online project is open'),
      confirm: confirmArg,
    },
  },
  ({ name, asNew, confirm }) => run(() => projects.save({ name, asNew }, asker('save_online_project', { name, asNew }, confirm))),
);

server.registerTool(
  'project_history',
  {
    title: 'Print history',
    description:
      'An online project\'s print history (default the open one), newest first: which plate, sent or uploaded to which printer, and how it ended (printed, failed, stopped). ' +
      'Plates sent from here with send_to_printer go into it too, as from the site. Needs sign_in.',
    inputSchema: { project: z.string().optional().describe('Project name from online_projects; default the open one') },
  },
  ({ project }) => run(() => projects.history(project)),
);

server.registerTool(
  'printers',
  {
    title: 'Your printers',
    description: 'The printers in the person\'s Cloud Slicer account (the site\'s Device tab). Needs sign_in.',
    inputSchema: {},
  },
  () => run(async () => (await printers.list()).map((p) => ({ name: p.name, ...(p.preset && { preset: p.preset }), through: p.kind === 'bridge' ? 'bridge' : 'direct' }))),
);

server.registerTool(
  'printer_status',
  {
    title: 'Printer status',
    description: 'How one of the person\'s printers is doing: printing or not, progress, temperatures, homed axes, the filaments it has loaded, errors, and "sent": the commands this add-on sent it lately and whether each finished, failed (and why) or is still running. Needs sign_in.',
    inputSchema: { printer: z.string().optional().describe('Printer name from printers; can be left out with only one printer') },
  },
  ({ printer }) => run(() => printers.status(printer)),
);

server.registerTool(
  'send_to_printer',
  {
    title: 'Send to printer',
    description:
      'Uploads G-code (by default the newest slice) to one of the person\'s printers. With print: true it then starts printing, but only after the person says yes ' +
      '(on screen, or in the chat with a one-time code), every time; never set print without them asking for a print. Without print it only uploads (the printer does not move). Needs sign_in.',
    inputSchema: {
      printer: z.string().optional().describe('Printer name from printers; can be left out with only one printer'),
      file: z.string().optional().describe('G-code or .gcode.3mf on this computer; default the newest slice'),
      print: z.boolean().optional().describe('Start printing after the upload (asks the person first). Default false: upload only'),
      confirm: confirmArg,
    },
  },
  ({ printer, file, print, confirm }, extra) =>
    run(async () => {
      const path = file ?? lastSliced?.gcode3mfFile ?? lastSliced?.gcodeFile;
      if (!path) throw new Error('Nothing to send yet: slice first, or give a file.');
      const token = extra._meta?.progressToken;
      let last = -1;
      const progress = (f: number) => {
        const pct = Math.floor(f * 100);
        if (token === undefined || pct === last) return;
        last = pct;
        extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: pct, total: 100, message: 'Uploading' } }).catch(() => {});
      };
      // The newest slice of an online project's plate: tagged and recorded like a send from the site (lib/prints.ts).
      const origin = lastSliced?.origin && (path === lastSliced.gcodeFile || path === lastSliced.gcode3mfFile) ? lastSliced.origin : undefined;
      const printId = origin && newPrintId();
      return printers.send(printer, path, {
        start: Boolean(print),
        progress,
        // As the site: a plain G-code carries the tag line; a .gcode.3mf goes as it is and is still recorded.
        ...(printId && /\.gcode$/i.test(path) && { tag: (f: Blob) => withPrintTag(f, { ...origin!, printId }) }),
        ...(printId && { sent: (to: Parameters<OnlineProjects['recordSend']>[2]) => void projects.recordSend(origin!, printId, to) }),
        confirm: ({ printer: name, file: shown, slots }) =>
          asker('send_to_printer', { printer, file: path, print }, confirm)(`Start printing ${shown} on ${name}? The printer heats up and moves.` + (slots.length ? `\n${slots.map((s) => `• ${s}`).join('\n')}` : '')),
      });
    }),
);

server.registerTool(
  'printer_camera',
  {
    title: 'Camera picture',
    description:
      'Still pictures from one of the person\'s printers\' cameras, one from each camera it has (or one named camera): look before asking to print (is the plate clear?) or to see how a print is going. Needs sign_in.',
    inputSchema: {
      printer: z.string().optional().describe('Printer name from printers; can be left out with only one printer'),
      camera: z.string().optional().describe('One camera by name; default every camera the printer has'),
    },
  },
  async ({ printer, camera }) => {
    try {
      await syncAccount();
      const r = await printers.camera(printer, camera);
      return {
        content: [
          ...r.shots.flatMap((x) => [
            { type: 'text' as const, text: `${r.printer}, ${x.camera}, just now:` },
            { type: 'image' as const, data: x.data.toString('base64'), mimeType: x.mimeType },
          ]),
          ...(r.failed.length ? [{ type: 'text' as const, text: `No picture from ${r.failed.join('; ')}.` }] : []),
        ],
      };
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  'printer_files',
  {
    title: 'Files on a printer',
    description: 'The G-code files on one of the person\'s printers, newest first (for printer_control print_file). Needs sign_in.',
    inputSchema: { printer: z.string().optional().describe('Printer name from printers; can be left out with only one printer') },
  },
  ({ printer }) => run(() => printers.files(printer)),
);

const axis = z.enum(['x', 'y', 'z']);
server.registerTool(
  'printer_control',
  {
    title: 'Control a printer',
    description:
      'The site\'s Device tab controls for one of the person\'s printers. Anything that heats, moves, starts, resumes or stops a print asks the person first, every time (on screen, or in the chat with a one-time code where the app can\'t show a popup); ' +
      'only do what the person asked for. Actions: print_file {file} (a file already on the printer), pause, resume, stop, skip_object {object}, ' +
      'home {axes?}, move {axis, mm}, extrude {mm, negative pulls back}, motors_off, heat {heater: "bed", "nozzle" or a name from printer_status, target °C, 0 = off}, ' +
      'fan {fan?, percent}, light {on}, speed {percent}, flow {percent}; Snapmaker U1 tool heads 1-4: load_filament {head}, unload_filament {head}, ' +
      'set_head_filament {head, material, colour?, brand?, subType?}, pick_head {head}, park_head {head}. Needs sign_in.',
    inputSchema: {
      printer: z.string().optional().describe('Printer name from printers; can be left out with only one printer'),
      action: z.enum([
        'print_file', 'pause', 'resume', 'stop', 'skip_object', 'home', 'move', 'extrude', 'motors_off', 'heat', 'fan', 'light', 'speed', 'flow',
        'load_filament', 'unload_filament', 'set_head_filament', 'pick_head', 'park_head',
      ]),
      file: z.string().optional(),
      object: z.string().optional().describe('Object name, as the printer\'s Skip objects list shows it'),
      axes: z.array(axis).optional(),
      axis: axis.optional(),
      mm: z.number().optional(),
      heater: z.string().optional(),
      target: z.number().optional(),
      fan: z.string().optional(),
      light: z.string().optional(),
      on: z.boolean().optional(),
      percent: z.number().optional(),
      head: z.number().int().min(1).max(4).optional(),
      material: z.string().optional(),
      colour: z.string().optional().describe('#RRGGBB'),
      brand: z.string().optional(),
      subType: z.string().optional(),
      confirm: confirmArg,
    },
  },
  ({ printer, confirm, ...c }) => run(() => printers.control(printer, c, asker('printer_control', { printer, ...c }, confirm))),
);

await server.connect(new StdioServerTransport());
const stop = async () => {
  printers.close();
  projects.close();
  await slicer.close();
  process.exit(0);
};
process.stdin.on('close', stop);
process.on('SIGTERM', stop);

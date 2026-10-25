// Bambu Lab printers (X1, P1, P2S, A1, H2) on the local network. They don't run
// Klipper: the bridge stands in for Moonraker and turns the printer's MQTT
// reports into the same objects (apps/device-bridge/bambu.go), and says so in
// printer.info's brand. With LAN Only mode and Developer Mode on, the printer
// takes G-code, so Move, temperatures and the Console stay (the bridge puts the
// Klipper commands the screen sends in Marlin's words; the printer sends no
// replies back). Without Developer Mode it still reports how it is, and the
// bridge passes on the printer's refusal of anything else. The P1 and A1
// camera shows through the bridge; X1, H2 and P2S stream video it can't pass on.
//
// The bridge also passes on the printer's own report as it is (the `bambu`
// object) and the page's own messages to the printer (printer.request): this
// file reads the AMS from the one and starts prints with the other, the way
// Bambu Studio does (OpenBambuAPI's mqtt.md; Orca's SelectMachine.cpp).
import type { KlipperObjects } from '../status';
import type { FilamentSlot, PrintOptions } from '../slots';
import type { PrinterAddon, PrinterCall, PrintStart } from './types';

/** The outside spool's tray id, in the printer's own numbering. */
export const BAMBU_OUTSIDE_SPOOL = 254;

/** An AMS or outside-spool slot, with where the printer keeps it. */
export interface BambuSlot extends FilamentSlot {
  /** The AMS unit's id (0-3 for an AMS, 128+ for an AMS HT), or 254 for the outside spool. */
  amsId: number;
  /** The slot in that unit (254 for the outside spool). */
  slotId: number;
}

const s = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** "C12E1FFF" -> "#C12E1F". */
const trayColour = (v: unknown) => {
  const c = s(v).toUpperCase();
  return /^[0-9A-F]{6}/.test(c) ? `#${c.slice(0, 6)}` : '#808080';
};

/**
 * A tray as a slot. Bambu's own filaments name their product line after the
 * material ("PLA Basic"), so the rest is the sub-type and Bambu the brand; a
 * filament set by hand on the printer carries its brand's name ("Generic PLA").
 */
function traySlot(t: Record<string, unknown>, index: number, label: string, amsId: number, slotId: number): BambuSlot {
  const material = s(t.tray_type).trim();
  const line = s(t.tray_sub_brands).trim();
  let vendor = '';
  let subType = '';
  if (material && line.toLowerCase().startsWith(material.toLowerCase())) {
    vendor = 'Bambu';
    subType = line.slice(material.length).trim();
  } else if (line) {
    vendor = line.split(/\s+/)[0];
  }
  const loaded = Boolean(material);
  return {
    index,
    label,
    colour: trayColour(t.tray_color),
    material,
    subType,
    vendor,
    loaded,
    ready: loaded,
    official: false,
    nozzle: null,
    amsId,
    slotId,
  };
}

/** Its AMS units' slots, then the outside spool; null until the printer has reported. */
export function bambuSlots(o: KlipperObjects): BambuSlot[] | null {
  const r = o.bambu;
  if (!r) return null;
  const out: BambuSlot[] = [];
  for (const unit of arr(obj(r.ams).ams)) {
    const u = obj(unit);
    const amsId = Number(s(u.id));
    if (!Number.isInteger(amsId)) continue;
    // A, B, C, D for AMS units; HT1, HT2 for the single-slot AMS HT.
    const name = amsId >= 128 ? `HT${amsId - 127}` : String.fromCharCode(65 + amsId);
    for (const tray of arr(u.tray)) {
      const t = obj(tray);
      const slotId = Number(s(t.id));
      if (!Number.isInteger(slotId)) continue;
      out.push(traySlot(t, out.length, amsId >= 128 ? name : `${name}${slotId + 1}`, amsId, slotId));
    }
  }
  if (r.vt_tray) out.push(traySlot(obj(r.vt_tray), out.length, 'Outside spool', BAMBU_OUTSIDE_SPOOL, BAMBU_OUTSIDE_SPOOL));
  return out;
}

const isProject = (path: string) => /\.3mf$/i.test(path);

/**
 * Bambu Studio's print command for a .gcode.3mf on the printer: the plate's
 * G-code, the AMS slot for each filament in the file and the calibrations to
 * run first. ams_mapping is the tray for each filament (unit * 4 + slot, -1 for
 * none or the outside spool), ams_mapping2 the same as unit and slot;
 * use_ams is off only when everything prints from the outside spool.
 */
export function bambuProjectStart({ path, map, filamentCount, options, slots, plate }: PrintStart): PrinterCall {
  const byIndex = new Map(slots.map((sl) => [sl.index, sl as BambuSlot]));
  const mapping: number[] = [];
  const mapping2: { ams_id: number; slot_id: number }[] = [];
  let ams = false;
  let outside = false;
  for (let i = 0; i < filamentCount; i++) {
    const slot = byIndex.get(map[i] ?? -1);
    if (!slot) {
      mapping.push(-1);
      mapping2.push({ ams_id: 255, slot_id: 255 });
    } else if (slot.amsId === BAMBU_OUTSIDE_SPOOL) {
      outside = true;
      mapping.push(-1);
      // Bambu Studio's "main" outside spool (VIRTUAL_TRAY_MAIN_ID), slot 0.
      mapping2.push({ ams_id: 255, slot_id: 0 });
    } else {
      ams = true;
      mapping.push(slot.amsId >= 128 ? slot.amsId : slot.amsId * 4 + slot.slotId);
      mapping2.push({ ams_id: slot.amsId, slot_id: slot.slotId });
    }
  }
  const name = path.replace(/^.*\//, '');
  return {
    method: 'printer.request',
    timeoutMs: 30_000,
    params: {
      message: {
        print: {
          command: 'project_file',
          param: `Metadata/plate_${plate ?? 1}.gcode`,
          url: `file:///sdcard/${path}`,
          subtask_name: name.replace(/\.gcode\.3mf$|\.3mf$/i, ''),
          md5: '',
          project_id: '0',
          profile_id: '0',
          task_id: '0',
          subtask_id: '0',
          bed_type: 'auto',
          timelapse: options.timeLapse,
          bed_leveling: options.bedLevel,
          bed_levelling: options.bedLevel,
          flow_cali: options.flowCalibrate,
          vibration_cali: false,
          layer_inspect: false,
          use_ams: ams || !outside,
          ams_mapping: mapping,
          ams_mapping2: mapping2,
        },
      },
    },
  };
}

export const bambuAddon: PrinterAddon = {
  id: 'bambu',
  model: 'Bambu Lab',
  detect: (f) => f.brand === 'bambu',
  objects: () => ['bambu'],
  // It restarts from its own screen: no restart button.
  host: { name: 'Bambu Lab', stopped: 'The printer stopped answering: check that it is on and on the network.' },
  cameraMissing: 'Only P1 and A1 printers show their camera here: X1, H2 and P2S send video that only Bambu\'s own apps play.',
  filaments: {
    title: 'AMS',
    words: { noun: 'AMS slot', unset: 'Load filament there, or set it on the printer’s screen.' },
    note: 'As in Bambu Studio, a filament can only go to a slot with the same filament type. Brand and colour can differ.',
    read: bambuSlots,
    // Only a .gcode.3mf carries the slot list; plain G-code prints filament n from slot n.
    maps: isProject,
  },
  // It prints the .gcode.3mf files Bambu Studio and this site make for it.
  uploads: ['.3mf'],
  // Bambu Studio's defaults; the printer says whether it records time-lapses.
  printOptions: (o): PrintOptions => ({
    bedLevel: true,
    flowCalibrate: true,
    timeLapse: s(obj(obj(o.bambu).ipcam).timelapse) === 'enable',
  }),
  startPrint: (st) => (isProject(st.path) ? [bambuProjectStart(st)] : [{ method: 'printer.print.start', params: { filename: st.path }, timeoutMs: 60_000 }]),
};

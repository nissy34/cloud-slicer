// What a print start will do, from the printer's add-ons and the file: which
// slot (U1 tool head, Bambu AMS slot) prints each filament, the printer's own
// pre-print options, what blocks the start, and the calls that start it. The
// Send window (ui/PrintDialog.tsx) shows it and lets the person change the map
// and options; the AI app add-on (apps/mcp) takes it as it is.
import type { PrinterAddon, PrinterCall } from './addons';
import type { GcodeMeta } from './gcode-meta';
import { noSlotReason, slotCheck, suggestSlotMap, type PrintOptions } from './slots';
import type { KlipperObjects } from './status';

export interface PrintPlanInput {
  addons: PrinterAddon[];
  objects: KlipperObjects;
  /** The file's name (a Bambu Lab printer maps only a .gcode.3mf). */
  path: string;
  meta: GcodeMeta | null;
  /** The plate inside a .gcode.3mf, when known. */
  plate: number | null;
  /** The person's slot per filament; null suggests one when `suggest` (the default). */
  toolMap?: Record<number, number> | null;
  suggest?: boolean;
  optionEdits?: Partial<PrintOptions>;
}

export function printPlan(i: PrintPlanInput) {
  const fil = i.addons.find((a) => a.filaments)?.filaments;
  const optionsAddon = i.addons.find((a) => a.printOptions);
  const starter = i.addons.find((a) => a.startPrint);
  const mapping = Boolean(fil && (!fil.maps || fil.maps(i.path)));
  const slots = mapping ? (fil?.read(i.objects) ?? []) : [];
  const options: PrintOptions | null = optionsAddon?.printOptions ? { ...optionsAddon.printOptions(i.objects), ...i.optionEdits } : null;
  const toolMap = i.toolMap ?? (i.suggest !== false && i.meta && fil && slots.length ? suggestSlotMap(i.meta.filaments, slots, fil.words) : null);
  const checks = new Map<number, { blocked: string | null; warning: string | null }>();
  if (fil && mapping && i.meta && toolMap)
    for (const f of i.meta.filaments) {
      const slot = slots[toolMap[f.index]];
      checks.set(f.index, slot ? slotCheck(f, slot, fil.words) : { blocked: noSlotReason(f, fil.words), warning: null });
    }
  const meta = i.meta;
  /** The calls that start the print of the file at `at` on the printer. */
  const calls = (at: string): PrinterCall[] =>
    starter?.startPrint
      ? starter.startPrint({
          path: at,
          map: mapping ? (toolMap ?? {}) : {},
          filamentCount: meta?.filamentCount ?? 0,
          options: options ?? { bedLevel: false, flowCalibrate: false, timeLapse: false },
          slots,
          plate: i.plate,
          ...(meta?.bedType && { bedType: meta.bedType }),
        })
      : [{ method: 'printer.print.start', params: { filename: at }, timeoutMs: 60_000 }];
  return { fil, mapping, slots, options, toolMap, checks, blocked: [...checks.values()].some((c) => c.blocked), calls };
}

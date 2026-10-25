// Print history (apps/web/src/lib/prints.ts): the agent says when a print
// starts or ends on any of its printers ({ctl:'print'}, apps/device-bridge/printjob.go),
// and the relay passes it to the bridge's account on the site
// (POST /api/relay/print), with the bridge's browser key as proof, the way a
// removed bridge is (releaseBridge). The site works out the project and plate.

/** At most this many a bridge passes on per hour (a print is two). */
export const MAX_PRINTS_PER_HOUR = 120;

export interface PrintNews {
  printer: string;
  file: string;
  state: 'printing' | 'complete' | 'cancelled' | 'error';
  /** Seconds printing, and in all (with pauses), when the printer says. */
  duration?: number;
  total?: number;
  progress?: number;
  /** The end was already there when the bridge began watching. */
  late?: boolean;
  /** The file's cloud_slicer_print line as the bridge read it, or "". */
  tag: string;
}

const STATES = ['printing', 'complete', 'cancelled', 'error'];
const seconds = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v) : undefined);

/** {ctl:'print'} from the agent, checked and cut to size, or null. */
export function cleanPrint(raw: Record<string, unknown>): PrintNews | null {
  const printer = typeof raw.printer === 'string' ? raw.printer.slice(0, 64) : '';
  const file = typeof raw.file === 'string' ? raw.file.slice(0, 512) : '';
  if (!printer || !file || !STATES.includes(String(raw.state))) return null;
  const progress = typeof raw.progress === 'number' && raw.progress >= 0 && raw.progress <= 1 ? raw.progress : undefined;
  return {
    printer,
    file,
    state: raw.state as PrintNews['state'],
    duration: seconds(raw.duration),
    total: seconds(raw.total),
    progress,
    late: raw.late === true || undefined,
    tag: typeof raw.tag === 'string' ? raw.tag.slice(0, 200) : '',
  };
}

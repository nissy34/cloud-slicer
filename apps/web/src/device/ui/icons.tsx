import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  Camera,
  CircleCheck,
  CirclePause,
  CircleX,
  Clock,
  Flag,
  HandGrab,
  Info,
  Layers,
  Percent,
  Play,
  RotateCcw,
  Snowflake,
  SquareParking,
  Spool,
  Thermometer,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';

/** The Device tab's icons by what they mean, drawn in the text colour (Lucide, like the rest of the app). */
const ICONS = {
  load: ArrowDownToLine,
  unload: ArrowUpFromLine,
  filament: Spool,
  nozzle: Thermometer,
  pickUp: HandGrab,
  park: SquareParking,
  bell: Bell,
  failed: CircleX,
  paused: CirclePause,
  error: TriangleAlert,
  started: Play,
  layer: Layers,
  progress: Percent,
  clock: Clock,
  almost: Flag,
  finished: CircleCheck,
  resumed: RotateCcw,
  cooled: Snowflake,
  camera: Camera,
  offline: WifiOff,
  ok: CircleCheck,
  info: Info,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const Shape = ICONS[name];
  return <Shape className="dv-icon" size={size} aria-hidden />;
}

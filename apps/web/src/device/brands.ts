// The kinds of printer the bridge reaches, in the words the add-printer dialog uses
// for each: Klipper (Moonraker) and the brands the bridge stands in for
// (apps/device-bridge/translate.go). A found printer's kind comes from the bridge's search.
import { i18n } from '../i18n';

export interface KindWords {
  /** Shown beside a found printer, when it isn't Klipper. */
  tag: string;
  key: string;
  /** Where to find the key. */
  hint: string;
  locked: string;
}

// Word keys (deviceBrands.*): kindWords() gives them in the reader's language.
const KLIPPER: KindWords = {
  tag: '',
  key: 'deviceBrands.klipperKey',
  hint: 'deviceBrands.klipperHint',
  locked: 'deviceBrands.klipperLocked',
};

const KINDS: Record<string, KindWords> = {
  prusalink: {
    tag: 'Prusa',
    key: 'deviceBrands.prusaKey',
    hint: 'deviceBrands.prusaHint',
    locked: 'deviceBrands.prusaLocked',
  },
  octoprint: {
    tag: 'OctoPrint',
    key: 'deviceBrands.octoprintKey',
    hint: 'deviceBrands.octoprintHint',
    locked: 'deviceBrands.octoprintLocked',
  },
  // Elegoo printers take no password on the local network.
  elegoo: { ...KLIPPER, tag: 'Elegoo' },
  bambu: {
    tag: 'Bambu Lab',
    key: 'deviceBrands.bambuKey',
    hint: 'deviceBrands.bambuHint',
    locked: 'deviceBrands.bambuLocked',
  },
};

export function kindWords(kind?: string | null): KindWords {
  const k = (kind && KINDS[kind]) || KLIPPER;
  return { tag: k.tag, key: i18n.t(k.key), hint: i18n.t(k.hint), locked: i18n.t(k.locked) };
}

/** What the Device tab can do with each kind of printer, for "Which printers work" (ui/WorksWith.tsx). */
/** Column titles; `short` is shown on phones so the table fits without scrolling sideways. */
/** Names and examples are word keys (deviceBrands.*), shown with t(). */
export const WORKS_FEATURES: { name: string; short?: string }[] = [
  { name: 'deviceBrands.featStatus' },
  { name: 'deviceBrands.featSend' },
  { name: 'deviceBrands.featCamera' },
  { name: 'deviceBrands.featMove', short: 'deviceBrands.featMoveShort' },
  { name: 'deviceBrands.featConsole' },
];

export const WORKS_WITH: { name: string; examples: string; can: boolean[] }[] = [
  { name: 'deviceBrands.klipperName', examples: 'deviceBrands.klipperExamples', can: [true, true, true, true, true] },
  { name: 'deviceBrands.prusaName', examples: 'deviceBrands.prusaExamples', can: [true, true, false, false, false] },
  { name: 'deviceBrands.octoprintName', examples: 'deviceBrands.octoprintExamples', can: [true, true, true, true, true] },
  { name: 'deviceBrands.elegooName', examples: 'deviceBrands.elegooExamples', can: [true, true, true, false, false] },
  { name: 'deviceBrands.bambuName', examples: 'deviceBrands.bambuExamples', can: [true, true, true, true, true] },
];

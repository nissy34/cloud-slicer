// The kinds of printer the bridge reaches, in the words the add-printer dialog uses
// for each: Klipper (Moonraker) and the brands the bridge stands in for
// (apps/device-bridge/translate.go). A found printer's kind comes from the bridge's search.

export interface KindWords {
  /** Shown beside a found printer, when it isn't Klipper. */
  tag: string;
  key: string;
  /** Where to find the key. */
  hint: string;
  locked: string;
}

const KLIPPER: KindWords = {
  tag: '',
  key: 'API key',
  hint: 'Mainsail and Fluidd show it in their settings.',
  locked: 'This printer is locked: type its API key',
};

const KINDS: Record<string, KindWords> = {
  prusalink: {
    tag: 'Prusa',
    key: 'PrusaLink password',
    hint: 'The printer shows it under Settings, Network, PrusaLink (the user name there is maker).',
    locked: "Type the PrusaLink password from the printer's screen",
  },
  octoprint: {
    tag: 'OctoPrint',
    key: 'OctoPrint API key',
    hint: 'In OctoPrint: Settings, Application Keys, then make a key for Cloud Slicer (or copy your user\'s API key under Settings, API).',
    locked: 'This OctoPrint is locked: type an API key from its settings',
  },
  // Elegoo printers take no password on the local network.
  elegoo: { ...KLIPPER, tag: 'Elegoo' },
  bambu: {
    tag: 'Bambu Lab',
    key: 'LAN access code',
    hint: "The printer shows it on its screen, in its network settings next to LAN Only mode. To send prints and control it from here, also turn on LAN Only mode and Developer Mode there (Bambu's cloud and the Bambu Handy app stop working while they're on).",
    locked: "Type the access code from the printer's screen",
  },
};

export function kindWords(kind?: string | null): KindWords {
  return (kind && KINDS[kind]) || KLIPPER;
}

/** What the Device tab can do with each kind of printer, for "Which printers work" (ui/WorksWith.tsx). */
/** Column titles; `short` is shown on phones so the table fits without scrolling sideways. */
export const WORKS_FEATURES: { name: string; short?: string }[] = [{ name: 'Status' }, { name: 'Send & print' }, { name: 'Camera' }, { name: 'Move & temperatures', short: 'Move & temps' }, { name: 'Console' }];

export const WORKS_WITH: { name: string; examples: string; can: boolean[] }[] = [
  { name: 'Klipper printers', examples: 'Snapmaker U1, Voron, Qidi, Sovol', can: [true, true, true, true, true] },
  { name: 'Prusa with PrusaLink', examples: 'MK4, Core One, XL, Mini', can: [true, true, false, false, false] },
  { name: 'OctoPrint', examples: 'any printer OctoPrint runs', can: [true, true, true, true, true] },
  { name: 'Elegoo Centauri Carbon', examples: 'not the Carbon 2 yet', can: [true, true, true, false, false] },
  { name: 'Bambu Lab', examples: 'X1, P1, P2S, A1, H2; camera on P1 and A1; needs Developer Mode', can: [true, true, true, true, true] },
];

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
};

export function kindWords(kind?: string | null): KindWords {
  return (kind && KINDS[kind]) || KLIPPER;
}

/** The printers the Device tab works with, for the add-printer dialog's "Which printers work?". */
export const WORKS_WITH: { title: string; text: string }[] = [
  {
    title: 'Klipper printers',
    text: 'Any printer running Klipper with Moonraker (the program behind Mainsail and Fluidd): Snapmaker U1, Voron, Qidi, Sovol SV07 and SV08, Elegoo Neptune 4, Creality K1 and K2 after turning on root access, Anycubic Kobra with Rinkhals, Flashforge Adventurer 5M with Klipper Mod.',
  },
  {
    title: 'Prusa',
    text: 'MK4, MK4S, Core One, XL and Mini, and the MK3 family with PrusaLink, once PrusaLink is turned on (Settings, Network, PrusaLink). Status, files and prints work; the Prusa camera only shows in Prusa Connect, and moving the head or sending G-code is done on the printer.',
  },
  {
    title: 'OctoPrint',
    text: 'Any printer OctoPrint runs (OctoPi on a Raspberry Pi beside an Ender, a Prusa MK3 or others), with an API key from its settings. Status, files, prints, moving the head, temperatures, the console and its cameras work.',
  },
];

/** The relay everyone's bridges use. */
export const LIVE_RELAY_URL = 'https://cloud-slicer-relay.awesomestuff.qzz.io';
/**
 * The test relay: pull request builds of the relay and the bridge go here
 * before they merge (.github/workflows/device.yml), and branch previews of the
 * site set up new bridges on it.
 */
export const TEST_RELAY_URL = 'https://cloud-slicer-relay-test.awesomestuff.qzz.io';
/** The relay that bridges carry printers through. Set VITE_DEVICE_RELAY_URL to use your own. */
export const DEFAULT_RELAY_URL: string = (import.meta.env.VITE_DEVICE_RELAY_URL as string | undefined) || LIVE_RELAY_URL;

/**
 * The relays' first addresses. They still answer, but printers saved with one
 * are reached on the relay's own address (functions/_lib/relay.ts knows them too).
 */
const MOVED_RELAYS: Record<string, string> = {
  'https://cloud-slicer-relay.nissy34.workers.dev': LIVE_RELAY_URL,
  'https://cloud-slicer-relay-test.nissy34.workers.dev': TEST_RELAY_URL,
};

/** A relay address as it is now: no trailing slash, and the new address of a relay that moved. */
export function currentRelay(relay: string): string {
  const r = relay.replace(/\/+$/, '');
  return MOVED_RELAYS[r] ?? r;
}

/** Whether a bridge's relay is the test relay (its bridges are test builds, named "(test)"). */
export const isTestRelay = (relay?: string): boolean => !!relay && currentRelay(relay) === TEST_RELAY_URL;

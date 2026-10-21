/** The relay everyone's bridges use. */
export const LIVE_RELAY_URL = 'https://cloud-slicer-relay.nissy34.workers.dev';
/**
 * The test relay: pull request builds of the relay and the bridge go here
 * before they merge (.github/workflows/device.yml), and branch previews of the
 * site set up new bridges on it.
 */
export const TEST_RELAY_URL = 'https://cloud-slicer-relay-test.nissy34.workers.dev';
/** The relay that bridges carry printers through. Set VITE_DEVICE_RELAY_URL to use your own. */
export const DEFAULT_RELAY_URL: string = (import.meta.env.VITE_DEVICE_RELAY_URL as string | undefined) || LIVE_RELAY_URL;

/** Whether a bridge's relay is the test relay (its bridges are test builds, named "(test)"). */
export const isTestRelay = (relay?: string): boolean => !!relay && relay.replace(/\/+$/, '') === TEST_RELAY_URL;

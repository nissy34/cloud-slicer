/** The relay that bridges carry printers through. Set VITE_DEVICE_RELAY_URL to use your own. */
export const DEFAULT_RELAY_URL: string = (import.meta.env.VITE_DEVICE_RELAY_URL as string | undefined) || 'https://cloud-slicer-relay.nissy34.workers.dev';

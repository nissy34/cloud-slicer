// A saved printer or bridge (the account's `devices` rows), and running a print
// start's calls: plain code, no page state, so the AI app add-on (apps/mcp) uses
// it too. state/device.ts keeps the Device tab's state around it.
import type { Device } from '../account/api';
import type { PrinterCall } from './addons';
import { i18n } from '../i18n';
import { currentRelay } from './config';
import { RpcError, type PrinterSession } from './session';

/** Shared by both kinds: `hiddenCameras` names the webcams the user chose not to show. */
type PrinterCommon = { id: string; name: string; preset?: string; hiddenCameras?: string[] };

export type SavedPrinter =
  | (PrinterCommon & { kind: 'direct'; url: string; apiKey: string })
  | (PrinterCommon & { kind: 'bridge'; relay: string; bridgeId: string; key: string; printer: string });

/**
 * A bridge (the small app on a computer near the printers), saved on its own:
 * it can have no printers, and removing a printer leaves it. Its printers
 * still carry the relay, id and key so they connect on their own.
 */
export interface SavedBridge {
  id: string;
  name: string;
  relay: string;
  bridgeId: string;
  key: string;
}

/** A saved account printer as the Device tab sees it (secret not filled in). */
export function printerFromDevice(d: Device): SavedPrinter | null {
  const x = d.extra ?? {};
  const hidden = Array.isArray(x.hiddenCameras) ? x.hiddenCameras.filter((n): n is string => typeof n === 'string') : [];
  const common = { ...(d.preset && { preset: d.preset }), ...(hidden.length && { hiddenCameras: hidden }) };
  if (x.kind === 'bridge' && typeof x.relay === 'string' && typeof x.bridgeId === 'string') {
    return { id: d.id, name: d.name, kind: 'bridge', relay: currentRelay(x.relay), bridgeId: x.bridgeId, key: '', printer: typeof x.printer === 'string' ? x.printer : '', ...common };
  }
  return d.url ? { id: d.id, name: d.name, kind: 'direct', url: d.url, apiKey: '', ...common } : null;
}

/** A saved bridge (extra.kind 'bridge-agent'); printers through it are kind 'bridge'. */
export function bridgeFromDevice(d: Device): SavedBridge | null {
  const x = d.extra ?? {};
  return x.kind === 'bridge-agent' && typeof x.relay === 'string' && typeof x.bridgeId === 'string' ? { id: d.id, name: d.name, relay: currentRelay(x.relay), bridgeId: x.bridgeId, key: '' } : null;
}

/**
 * Runs a print start's calls in order. Commands show in the console like any
 * other. A call the printer doesn't have (-32601: older firmware, or a bridge
 * that doesn't pass it on) runs its orElse calls instead, and an answer of
 * { state: 'error' } (Snapmaker's own calls refuse that way) stops the start.
 */
export async function runCalls(s: Pick<PrinterSession, 'gcode' | 'rpc'>, calls: PrinterCall[]): Promise<void> {
  for (const call of calls) {
    const script = call.method === 'printer.gcode.script' ? (call.params as { script?: unknown } | undefined)?.script : undefined;
    if (typeof script === 'string') {
      await s.gcode(script, call.timeoutMs);
      continue;
    }
    let result: unknown;
    try {
      result = await s.rpc(call.method, call.params, call.timeoutMs);
    } catch (e) {
      if (call.orElse && e instanceof RpcError && e.code === -32601) {
        await runCalls(s, call.orElse);
        continue;
      }
      throw e;
    }
    const r = result as { state?: unknown; message?: unknown } | null;
    if (r && typeof r === 'object' && r.state === 'error') throw new Error(typeof r.message === 'string' && r.message ? r.message : i18n.t('deviceLink.didNotStart'));
  }
}


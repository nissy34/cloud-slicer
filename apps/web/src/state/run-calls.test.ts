import { describe, expect, it } from 'vitest';
import { runCalls } from './device';
import { RpcError } from '../device/session';

// A printer session that records calls; `missing` methods answer like Moonraker without them.
function fakeSession(missing: string[] = [], answers: Record<string, unknown> = {}) {
  const log: string[] = [];
  return {
    log,
    gcode: async (script: string) => void log.push(`gcode ${script}`),
    rpc: async (method: string) => {
      log.push(method);
      if (missing.includes(method)) throw new RpcError(`Method not found: ${method}`, -32601);
      return answers[method] ?? 'ok';
    },
  };
}

const calls = [
  { method: 'printer.gcode.script', params: { script: 'SET_PRINT_USED_EXTRUDERS EXTRUDERS=0' } },
  { method: 'server.files.start_local_print', params: {}, orElse: [{ method: 'printer.gcode.script', params: { script: 'SET_PRINT_PREFERENCES BED_LEVEL=0' } }, { method: 'printer.print.start' }] },
];

describe('runCalls', () => {
  it('runs the calls in order', async () => {
    const s = fakeSession();
    await runCalls(s as never, calls);
    expect(s.log).toEqual(['gcode SET_PRINT_USED_EXTRUDERS EXTRUDERS=0', 'server.files.start_local_print']);
  });

  it('runs orElse when the printer has no such call', async () => {
    const s = fakeSession(['server.files.start_local_print']);
    await runCalls(s as never, calls);
    expect(s.log).toEqual(['gcode SET_PRINT_USED_EXTRUDERS EXTRUDERS=0', 'server.files.start_local_print', 'gcode SET_PRINT_PREFERENCES BED_LEVEL=0', 'printer.print.start']);
  });

  it("stops on Snapmaker's { state: 'error' } answer, without starting another way", async () => {
    const s = fakeSession([], { 'server.files.start_local_print': { state: 'error', message: 'nozzle diameter mismatch' } });
    await expect(runCalls(s as never, calls)).rejects.toThrow('nozzle diameter mismatch');
    expect(s.log).not.toContain('printer.print.start');
  });

  it('does not fall back on other errors', async () => {
    const s = { ...fakeSession(), rpc: async () => Promise.reject(new RpcError('Printer is busy', 400)) };
    await expect(runCalls(s as never, calls.slice(1))).rejects.toThrow('Printer is busy');
  });
});

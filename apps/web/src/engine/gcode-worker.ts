// Parses G-code off the main thread for the Preview.
import { parseGcode } from '../lib/gcode';

self.onmessage = async ({ data }: MessageEvent<{ gcode: Blob }>) => {
  const parsed = parseGcode(await data.gcode.text());
  (self as unknown as Worker).postMessage(parsed, [
    parsed.positions.buffer,
    parsed.features.buffer,
    parsed.tools.buffer,
    parsed.layerStarts.buffer,
    parsed.layerZ.buffer,
  ]);
};

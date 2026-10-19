// Parses G-code off the main thread for the Preview.
import { orderForPreview, parseGcode } from '../lib/gcode';

self.onmessage = async ({ data }: MessageEvent<{ gcode: Blob }>) => {
  const parsed = orderForPreview(parseGcode(await data.gcode.text()));
  (self as unknown as Worker).postMessage(parsed, [
    parsed.positions.buffer,
    parsed.features.buffer,
    parsed.tools.buffer,
    parsed.sizes.buffer,
    parsed.shellStarts.buffer,
    parsed.innerStarts.buffer,
    parsed.layerZ.buffer,
  ]);
};

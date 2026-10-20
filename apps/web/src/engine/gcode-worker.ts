// Parses G-code off the main thread for the Preview. Posts { progress } (0..1)
// while reading, then the parsed segments.
import { orderForPreview, parseGcode, type PreviewGcode } from '../lib/gcode';

export type GcodeWorkerMessage = { progress: number } | { parsed: PreviewGcode };

self.onmessage = async ({ data }: MessageEvent<{ gcode: Blob }>) => {
  const post = (m: GcodeWorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
  const text = await data.gcode.text();
  // Reading is most of the work; putting segments in drawing order is the rest.
  const parsed = orderForPreview(parseGcode(text, (done) => post({ progress: done * 0.9 })));
  post({ parsed }, [
    parsed.positions.buffer,
    parsed.features.buffer,
    parsed.tools.buffer,
    parsed.sizes.buffer,
    parsed.speeds.buffer,
    parsed.flows.buffer,
    parsed.fans.buffer,
    parsed.temps.buffer,
    parsed.layerTimes.buffer,
    parsed.shellStarts.buffer,
    parsed.innerStarts.buffer,
    parsed.layerZ.buffer,
  ]);
};

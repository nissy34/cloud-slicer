// Parses G-code off the main thread for the Preview. Posts { progress } (0..1)
// while reading, then the parsed segments, or { error } when it can't.
import { filamentDiameters, gcodeReader, HEAD_BYTES, orderForPreview, TAIL_BYTES, type PreviewGcode } from '../lib/gcode';

export type GcodeWorkerMessage = { progress: number } | { parsed: PreviewGcode } | { error: string };

const post = (m: GcodeWorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

/**
 * Reads the blob a piece at a time: a big print's G-code (a 216 mm cube with
 * gyroid infill is ~780 MB) is more than a browser can read into one string
 * (Blob.text() fails at about 512 MB) and would double the memory if it could.
 */
async function read(gcode: Blob): Promise<PreviewGcode> {
  const [head, tail] = await Promise.all([
    gcode.slice(0, HEAD_BYTES).text(),
    gcode.slice(Math.max(0, gcode.size - TAIL_BYTES)).text(),
  ]);
  const reader = gcodeReader(filamentDiameters(head, tail));
  const decoder = new TextDecoder();
  const stream = gcode.stream().getReader();
  let done = 0;
  let reported = 0;
  for (;;) {
    const { value, done: end } = await stream.read();
    if (end) break;
    reader.read(decoder.decode(value, { stream: true }));
    done += value.byteLength;
    // Reading is most of the work; putting segments in drawing order is the rest.
    if (done - reported >= 2 << 20) {
      reported = done;
      post({ progress: (done / gcode.size) * 0.9 });
    }
  }
  reader.read(decoder.decode());
  return orderForPreview(reader.finish());
}

self.onmessage = async ({ data }: MessageEvent<{ gcode: Blob }>) => {
  let parsed: PreviewGcode;
  try {
    parsed = await read(data.gcode);
  } catch (e) {
    // Out of memory shows as a RangeError ("Array buffer allocation failed").
    post({ error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
    return;
  }
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

// A printer bed's 3D shape (Orca's bed_model STL) as a small file for the page:
// shared corners stored once, positions as 16-bit steps across the mesh's box
// (well under 0.02 mm on a 1 m bed). Read by apps/web/src/lib/bed.ts.
//
//   "BED1"                        4 bytes
//   min x, y, z, step x, y, z     6 float32
//   vertex count, triangle count  2 uint32
//   positions                     vertex count x 3 uint16, padded to 4 bytes
//   triangles                     triangle count x 3 uint16 (uint32 past 65536 vertices)

/** The triangles of an STL file (binary or ASCII) as x, y, z per corner. */
export function readStl(buf) {
  const head = buf.subarray(0, 512).toString('latin1');
  const binarySize = buf.length >= 84 ? 84 + 50 * buf.readUInt32LE(80) : -1;
  if (binarySize !== buf.length && /^\s*solid/.test(head) && /facet|endsolid/.test(buf.toString('latin1', 0, Math.min(buf.length, 4096)))) {
    const out = [];
    for (const m of buf.toString('latin1').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) out.push(Number(m[1]), Number(m[2]), Number(m[3]));
    if (!out.length || out.length % 9 || out.some((v) => !Number.isFinite(v))) throw new Error('unreadable ASCII STL');
    return new Float32Array(out);
  }
  if (binarySize < 0 || buf.length < binarySize) throw new Error('unreadable binary STL');
  const n = buf.readUInt32LE(80);
  const out = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) out[t * 9 + k] = buf.readFloatLE(84 + t * 50 + 12 + k * 4);
  return out;
}

export function encodeBedMesh(corners) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < corners.length; i++) {
    min[i % 3] = Math.min(min[i % 3], corners[i]);
    max[i % 3] = Math.max(max[i % 3], corners[i]);
  }
  const step = max.map((m, a) => (m - min[a]) / 65535 || 1);
  const ids = new Map();
  const positions = [];
  const triangles = [];
  for (let c = 0; c < corners.length / 3; c++) {
    const q = [0, 1, 2].map((a) => Math.round((corners[c * 3 + a] - min[a]) / step[a]));
    const key = q.join(',');
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
      positions.push(...q);
    }
    triangles.push(id);
  }
  // Drop triangles that collapsed to a line.
  const tris = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = triangles.slice(t, t + 3);
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  const vertices = ids.size;
  const posBytes = Math.ceil((vertices * 6) / 4) * 4;
  const wide = vertices > 65536;
  const buf = Buffer.alloc(4 + 24 + 8 + posBytes + tris.length * (wide ? 4 : 2));
  buf.write('BED1', 0, 'latin1');
  [...min, ...step].forEach((v, i) => buf.writeFloatLE(v, 4 + i * 4));
  buf.writeUInt32LE(vertices, 28);
  buf.writeUInt32LE(tris.length / 3, 32);
  positions.forEach((v, i) => buf.writeUInt16LE(v, 36 + i * 2));
  const at = 36 + posBytes;
  tris.forEach((v, i) => (wide ? buf.writeUInt32LE(v, at + i * 4) : buf.writeUInt16LE(v, at + i * 2)));
  return buf;
}

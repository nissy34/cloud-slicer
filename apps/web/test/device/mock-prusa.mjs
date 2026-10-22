// A pretend Prusa MK4 for the device tests: PrusaLink's web API with its digest
// login (user "maker"), as https://github.com/prusa3d/Prusa-Link-Web/blob/master/spec/openapi.yaml
// describes it. Prints only change numbers here; nothing reaches real hardware.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const md5 = (s) => createHash('md5').update(s).digest('hex');
const REALM = 'Printer API';
const NONCE = 'mock-nonce-1';
// A 1x1 PNG, for file pictures.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');

const short = (name) => name.replace(/\.[^.]*$/, '').slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, '_') + '~1.' + (name.split('.').pop() ?? '').slice(0, 3).toUpperCase();

function parse(h) {
  const out = {};
  for (const m of (h ?? '').replace(/^Digest\s+/i, '').matchAll(/(\w+)=("([^"]*)"|[^,]*)/g)) out[m[1].toLowerCase()] = m[3] ?? m[2];
  return out;
}

export async function startMockPrusa({ password = 'mock-password', hostname = 'Prusa MK4 mock' } = {}) {
  const state = {
    printer: { state: 'IDLE', temp_nozzle: 24.6, target_nozzle: 0, temp_bed: 23.9, target_bed: 0, axis_x: 242, axis_y: 211, axis_z: 10, flow: 100, speed: 100 },
    job: null,
  };
  /** name -> {data, modified, meta} */
  const files = new Map([['benchy.bgcode', { data: Buffer.from('pretend binary G-code'), modified: 1_760_000_000, meta: { 'estimated printing time (normal mode)': '1h 2m', 'filament used [g]': '5.1', filament_type: 'PLA' } }]]);
  const byShort = (s) => [...files.keys()].find((n) => short(n) === s || n === s);
  const authorised = (req) => {
    const p = parse(req.headers.authorization);
    if (p.username !== 'maker' || p.nonce !== NONCE) return false;
    const ha1 = md5(`maker:${REALM}:${password}`);
    const ha2 = md5(`${req.method}:${p.uri}`);
    return p.response === md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`);
  };
  const entry = (name) => {
    const f = files.get(name);
    return { name: short(name), display_name: name, type: 'PRINT_FILE', size: f.data.length, m_timestamp: f.modified, refs: { thumbnail: `/thumb/l/usb/${short(name)}`, icon: `/thumb/s/usb/${short(name)}` } };
  };
  const server = createServer((req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const empty = (status) => {
      res.writeHead(status);
      res.end();
    };
    if (!authorised(req)) {
      res.writeHead(401, { 'www-authenticate': `Digest realm="${REALM}", nonce="${NONCE}", qop="auth"` });
      res.end();
      return;
    }
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/api/version') return json(200, { api: '2.0.0', server: '2.1.2', text: 'PrusaLink', hostname: 'prusa-mk4' });
    if (path === '/api/v1/info') return json(200, { hostname, serial: 'MOCK123', nozzle_diameter: 0.4 });
    if (path === '/api/v1/storage') return json(200, { storage_list: [{ path: '/usb', name: 'usb', read_only: false, available: true }] });
    if (path === '/api/v1/status') return json(200, { printer: state.printer, ...(state.job && { job: { id: state.job.id, progress: state.job.progress, time_remaining: 1800, time_printing: 600 } }) });
    if (path === '/api/v1/job') {
      if (!state.job) return empty(204);
      return json(200, { id: state.job.id, state: state.printer.state, progress: state.job.progress, file: entry(state.job.file) });
    }
    const job = /^\/api\/v1\/job\/(\d+)(?:\/(pause|resume))?$/.exec(path);
    if (job) {
      if (!state.job || Number(job[1]) !== state.job.id) return empty(404);
      if (req.method === 'PUT' && job[2] === 'pause') state.printer.state = 'PAUSED';
      else if (req.method === 'PUT' && job[2] === 'resume') state.printer.state = 'PRINTING';
      else if (req.method === 'DELETE' && !job[2]) {
        state.printer.state = 'STOPPED';
        state.job = null;
      } else return empty(405);
      return empty(204);
    }
    if (path.startsWith('/thumb/')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
      return;
    }
    if (path === '/api/v1/files/usb/' && req.method === 'GET') return json(200, { type: 'FOLDER', name: 'usb', ro: false, children: [...files.keys()].map(entry) });
    if (path.startsWith('/api/v1/files/usb/')) {
      const name = path.slice('/api/v1/files/usb/'.length);
      if (req.method === 'PUT') {
        if (req.headers.overwrite !== '?1' && files.has(name)) return empty(409);
        if (!req.headers['content-length']) return empty(411);
        const parts = [];
        req.on('data', (d) => parts.push(d));
        req.on('end', () => {
          files.set(name, { data: Buffer.concat(parts), modified: Math.floor(Date.now() / 1000), meta: {} });
          if (req.headers['print-after-upload'] === '?1') start(name);
          empty(201);
        });
        return;
      }
      const long = byShort(name);
      if (!long) return empty(404);
      if (req.method === 'GET') return json(200, { ...entry(long), meta: files.get(long).meta });
      if (req.method === 'DELETE') {
        files.delete(long);
        return empty(204);
      }
      if (req.method === 'POST') {
        if (state.job) return empty(409);
        start(long);
        return empty(204);
      }
    }
    empty(404);
  });
  let jobs = 0;
  function start(name) {
    state.job = { id: ++jobs, file: name, progress: 25 };
    state.printer.state = 'PRINTING';
    state.printer.target_nozzle = 215;
    state.printer.target_bed = 60;
  }
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  const close = () =>
    new Promise((ok) => {
      server.close(() => ok());
      server.closeAllConnections();
    });
  return { url, password, state, files, close };
}

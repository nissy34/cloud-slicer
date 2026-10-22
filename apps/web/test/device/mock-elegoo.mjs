// A pretend Elegoo Centauri Carbon for the device tests: Elegoo's local
// protocol (SDCP v3) as the printer speaks it: "M99999" over UDP says who is
// there, JSON requests and status over a websocket, uploads in 1 MB parts that
// each carry the whole file's MD5, and an MJPEG camera. It listens on spare
// ports (the real one uses 3000, 3030, 3031 and 80); the bridge is told them
// with CLOUD_SLICER_ELEGOO_PORTS. Prints only change numbers here; nothing
// reaches real hardware.
import { createHash, randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const MAINBOARD = 'mockmainboard0123456789abcdef';
// A small blue JPEG, for the camera.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAJABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDDooor2TzT/9k=',
  'base64',
);

const listen = (server) => new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));

export async function startMockElegoo({ name = 'Carbon mock' } = {}) {
  const state = {
    status: 0,
    file: '',
    layer: 0,
    nozzle: 24.5,
    bed: 23.5,
    box: 26,
  };
  /** "/local/<name>" -> Buffer */
  const files = new Map([['/local/benchy.gcode', Buffer.from('G28\nG1 X10\n')]]);
  const parts = new Map();
  const commands = [];
  const sockets = new Set();
  const attributes = () => ({
    Name: name,
    MachineName: 'Centauri Carbon',
    MainboardID: MAINBOARD,
    FirmwareVersion: 'V1.1.25',
  });

  // Who is there.
  const udp = createSocket('udp4');
  udp.on('message', (msg, from) => {
    if (msg.toString() !== 'M99999') return;
    const reply = {
      Id: randomUUID(),
      Data: {
        ...attributes(),
        MainboardIP: '127.0.0.1',
        ProtocolVersion: 'V3.0.0',
      },
    };
    udp.send(JSON.stringify(reply), from.port, from.address);
  });
  const findPort = await new Promise((ok) => udp.bind(0, '127.0.0.1', () => ok(udp.address().port)));

  const status = () => ({
    Status: {
      CurrentStatus: [state.status ? 1 : 0],
      TempOfNozzle: state.nozzle,
      TempTargetNozzle: state.status ? 220 : 0,
      TempOfHotbed: state.bed,
      TempTargetHotbed: state.status ? 60 : 0,
      TempOfBox: state.box,
      CurrenCoord: '120.00,130.00,0.40',
      CurrentFanSpeed: {
        ModelFan: state.status ? 100 : 0,
        AuxiliaryFan: 0,
        BoxFan: 0,
      },
      PrintInfo: {
        Status: state.status,
        CurrentLayer: state.layer,
        TotalLayer: 200,
        CurrentTicks: state.status ? 900 : 0,
        TotalTicks: 3600,
        Filename: state.file,
        Progress: state.status ? 25 : 0,
        PrintSpeedPct: 100,
      },
    },
    MainboardID: MAINBOARD,
    TimeStamp: Math.floor(Date.now() / 1000),
    Topic: `sdcp/status/${MAINBOARD}`,
  });
  const push = () => {
    for (const ws of sockets) ws.send(JSON.stringify(status()));
  };

  const wsServer = createServer();
  const wss = new WebSocketServer({ server: wsServer, path: '/websocket' });
  wss.on('connection', (ws) => {
    sockets.add(ws);
    let timer = null;
    ws.on('close', () => {
      sockets.delete(ws);
      clearInterval(timer);
    });
    ws.send(
      JSON.stringify({
        Attributes: attributes(),
        MainboardID: MAINBOARD,
        Topic: `sdcp/attributes/${MAINBOARD}`,
      }),
    );
    ws.on('message', (raw) => {
      let req;
      try {
        req = JSON.parse(raw.toString()).Data;
      } catch {
        return;
      }
      if (req?.MainboardID !== MAINBOARD) return;
      commands.push(req.Cmd);
      const out = { Ack: 0 };
      const d = req.Data ?? {};
      switch (req.Cmd) {
        case 128:
          if (state.status !== 0 && state.status !== 8 && state.status !== 9) out.Ack = 1;
          else if (!files.has(d.Filename)) out.Ack = 2;
          else Object.assign(state, { status: 13, file: d.Filename, layer: 50 });
          break;
        case 129:
          if (state.status === 13) state.status = 6;
          else out.Ack = 1;
          break;
        case 131:
          if (state.status === 6) state.status = 13;
          else out.Ack = 1;
          break;
        case 130:
          if (state.status === 13 || state.status === 6) state.status = 8;
          else out.Ack = 1;
          break;
        case 258:
          out.FileList = [...files].map(([n, b]) => ({
            name: n,
            FileSize: b.length,
            CreateTime: 1_760_000_000,
            TotalLayers: 200,
            type: 1,
          }));
          break;
        case 259:
          for (const n of d.FileList ?? []) files.delete(n);
          break;
        case 512:
          clearInterval(timer);
          timer = setInterval(() => ws.send(JSON.stringify(status())), Math.max(200, d.TimePeriod ?? 1000));
          break;
        case 0:
          break;
        default:
          // The real printer may crash on commands it doesn't know: the mock refuses loudly.
          throw new Error(`mock Elegoo got unknown command ${req.Cmd}`);
      }
      ws.send(
        JSON.stringify({
          Id: randomUUID(),
          Data: {
            Cmd: req.Cmd,
            Data: out,
            RequestID: req.RequestID,
            MainboardID: MAINBOARD,
            TimeStamp: Date.now(),
          },
          Topic: `sdcp/response/${MAINBOARD}`,
        }),
      );
      if (req.Cmd === 0 || (req.Cmd >= 128 && req.Cmd <= 131)) push();
    });
  });
  const wsPort = await listen(wsServer);

  // Uploads, in parts: each must follow the last and name the whole file's MD5.
  const web = createServer((req, res) => {
    const reply = (code, message) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          code,
          messages: message ? [{ field: 'common_field', message }] : null,
          data: null,
          success: code === '000000',
        }),
      );
    };
    if (req.method !== 'POST' || req.url !== '/uploadFile/upload') {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const type = req.headers['content-type'] ?? '';
      const cut = type.indexOf('boundary=');
      const boundary = cut < 0 ? '' : type.slice(cut + 'boundary='.length);
      if (!boundary) return reply('111111', 'not a form');
      const fields = {};
      let file = null;
      let filename = '';
      const sep = Buffer.from(`--${boundary}`);
      for (let at = body.indexOf(sep); at >= 0; ) {
        const next = body.indexOf(sep, at + sep.length);
        if (next < 0) break;
        const part = body.subarray(at + sep.length + 2, next - 2);
        const head = part.indexOf('\r\n\r\n');
        const headers = part.subarray(0, head).toString();
        const value = part.subarray(head + 4);
        const field = /name="([^"]+)"/.exec(headers)?.[1];
        const fname = /filename="([^"]*)"/.exec(headers)?.[1];
        if (fname !== undefined) {
          file = value;
          filename = fname;
        } else if (field) fields[field] = value.toString();
        at = next;
      }
      if (!file || fields.Check !== '1') return reply('111111', 'missing file');
      const got = parts.get(fields.Uuid) ?? Buffer.alloc(0);
      if (Number(fields.Offset) !== got.length) return reply('111111', 'wrong offset');
      if (file.length > 1 << 20) return reply('111111', 'part too big');
      const all = Buffer.concat([got, file]);
      parts.set(fields.Uuid, all);
      if (all.length === Number(fields.TotalSize)) {
        if (createHash('md5').update(all).digest('hex') !== fields['S-File-MD5']) return reply('111111', 'md5 mismatch');
        files.set(`/local/${filename}`, all);
        parts.delete(fields.Uuid);
      }
      reply('000000');
    });
  });
  const webPort = await listen(web);

  // The camera: an MJPEG stream.
  let cameraClients = 0;
  const camera = createServer((req, res) => {
    if (!req.url.startsWith('/video')) {
      res.writeHead(404);
      res.end();
      return;
    }
    cameraClients++;
    res.writeHead(200, {
      'content-type': 'multipart/x-mixed-replace; boundary=frame',
    });
    const send = () => res.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${JPEG.length}\r\n\r\n`), JPEG, Buffer.from('\r\n')]));
    send();
    const timer = setInterval(send, 200);
    req.on('close', () => {
      clearInterval(timer);
      cameraClients--;
    });
  });
  const cameraPort = await listen(camera);

  let closed = false;
  return {
    url: `http://127.0.0.1:${webPort}`,
    ports: `${wsPort},${findPort},${cameraPort}`,
    state,
    files,
    commands,
    cameraClients: () => cameraClients,
    /** The printer goes away (turned off). */
    async close() {
      if (closed) return;
      closed = true;
      for (const ws of sockets) ws.terminate();
      udp.close();
      await Promise.all([wsServer, web, camera].map((s) => new Promise((ok) => (s.closeAllConnections?.(), s.close(() => ok())))));
    },
  };
}

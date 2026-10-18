#!/usr/bin/env node
// A pretend Snapmaker U1 (Klipper + Moonraker) for testing the Device tab.
// NOTHING here touches hardware: temperatures drift toward their targets,
// "printing" is a timer, loading filament flips a flag. It speaks Moonraker's
// JSON-RPC websocket, the HTTP upload and camera endpoints, and CORS.
//
//   node test/device/mock-printer.mjs [port] [--generic]   (--generic: plain Klipper, no U1 objects)
//
// Tests read every G-code script it received from mock.scripts.
import { createServer } from 'node:http';
import { crc32, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

function u1State(generic) {
  const s = {
    webhooks: { state: 'ready', state_message: 'Printer is ready' },
    print_stats: { state: 'standby', filename: '', print_duration: 0, total_duration: 0, filament_used: 0, message: '', info: { current_layer: null, total_layer: null } },
    virtual_sdcard: { progress: 0, is_active: false },
    display_status: { progress: 0, message: null },
    toolhead: { homed_axes: '', position: [0, 0, 0, 0], extruder: 'extruder', axis_minimum: [0, 0, 0, 0], axis_maximum: [270, 270, 270, 0] },
    gcode_move: { gcode_position: [0, 0, 0, 0], speed_factor: 1, extrude_factor: 1, absolute_coordinates: true },
    idle_timeout: { state: 'Idle' },
    heaters: { available_heaters: ['heater_bed', 'extruder', 'extruder1', 'extruder2', 'extruder3'], available_sensors: [] },
    heater_bed: { temperature: 24.8, target: 0, power: 0 },
    extruder: { temperature: 25.1, target: 0, power: 0 },
    extruder1: { temperature: 25.0, target: 0, power: 0 },
    extruder2: { temperature: 24.9, target: 0, power: 0 },
    extruder3: { temperature: 25.2, target: 0, power: 0 },
    'temperature_sensor chamber': { temperature: 26.0 },
    fan: { speed: 0 },
    'heater_fan hotend_fan': { speed: 0 },
    motion_report: { live_velocity: 0 },
    exclude_object: { objects: [], excluded_objects: [], current_object: null },
  };
  if (!generic) {
    // Head 0 starts on the carriage; the others sit in their docks.
    for (const [i, name] of ['extruder', 'extruder1', 'extruder2', 'extruder3'].entries()) {
      Object.assign(s[name], {
        state: i ? 'PARKED' : 'ACTIVATE',
        nozzle_diameter: 0.4,
        nozzle_volume_type: 'standard',
        switch_count: 120 + i,
        error_count: 0,
        last_maintenance_count: 100,
      });
    }
    Object.assign(s, {
      'led cavity_led': { color_data: [[0, 0, 0, 0]] },
      print_task_config: {
        filament_color_rgba: ['3E413FFF', 'E72F1DFF', '00FF00FF', 'FFFFFFFF'],
        filament_type: ['PLA', 'PETG', 'PLA', 'NONE'],
        filament_sub_type: ['Matte', 'Basic', 'Basic', 'NONE'],
        filament_vendor: ['Snapmaker', 'Generic', 'Generic', 'NONE'],
        filament_exist: [true, true, true, false],
        filament_official: [true, false, false, false],
        extruder_map_table: [0, 1, 2, 3],
        auto_bed_leveling: true,
        flow_calibrate: false,
        time_lapse_camera: false,
      },
      'filament_feed left': {
        extruder0: { module_exist: true, filament_detected: true, disable_auto: false, channel_state: 'load_finish', channel_error: 'ok' },
        extruder1: { module_exist: true, filament_detected: true, disable_auto: false, channel_state: 'load_finish', channel_error: 'ok' },
      },
      'filament_feed right': {
        extruder2: { module_exist: true, filament_detected: true, disable_auto: false, channel_state: 'load_finish', channel_error: 'ok' },
        extruder3: { module_exist: true, filament_detected: true, disable_auto: false, channel_state: 'none', channel_error: 'ok' },
      },
      purifier: { power_detected: true, mode: 'auto', exhaust_fan: { speed: 0 }, inner_fan: { speed: 0 } },
      machine_state_manager: { main_state: 0, action_code: 0 },
    });
  }
  return s;
}

/** A solid-colour PNG that changes colour each frame: the "camera". */
function pngFrame(n, w = 64, h = 48) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([(n * 40) % 256, 120, 255 - ((n * 40) % 256)], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function startMockPrinter({ port = 0, host = '127.0.0.1', generic = false } = {}) {
  let state = u1State(generic);
  const files = new Map([['calibration_cube.gcode', { size: 123456, modified: Date.now() / 1000 - 3600, text: '; filament_colour = #FF0000\n; filament_type = PLA\n; filament used [g] = 5.1\n' }]]);
  const scripts = [];
  const clients = new Set();
  let frame = 0;
  let printTimer = null;

  const broadcast = (method, params) => {
    const text = JSON.stringify({ jsonrpc: '2.0', method, params });
    for (const c of clients) c.ws.send(text);
  };
  const patch = (diff) => {
    for (const [k, v] of Object.entries(diff)) state[k] = { ...(state[k] ?? {}), ...v };
    for (const c of clients) {
      const mine = Object.fromEntries(Object.entries(diff).filter(([k]) => c.objects.has(k)));
      if (Object.keys(mine).length) c.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notify_status_update', params: [mine, Date.now() / 1000] }));
    }
  };

  // Temperatures drift toward their targets.
  const drift = setInterval(() => {
    const diff = {};
    for (const h of state.heaters.available_heaters) {
      const o = state[h];
      const goal = o.target > 0 ? o.target : 25;
      if (Math.abs(o.temperature - goal) > 0.2) diff[h] = { temperature: +(o.temperature + Math.sign(goal - o.temperature) * Math.min(5, Math.abs(goal - o.temperature))).toFixed(1) };
    }
    if (Object.keys(diff).length) patch(diff);
  }, 250);

  const setArr = (arr, i, v) => arr.map((x, j) => (j === i ? v : x));
  const param = (line, key) => {
    const m = new RegExp(`${key}=('([^']*)'|"([^"]*)"|(\\S+))`, 'i').exec(line);
    return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
  };

  const runGcode = (script) => {
    for (const raw of String(script).split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      scripts.push(line);
      const cmd = line.split(/\s+/)[0].toUpperCase();
      const ptc = state.print_task_config;
      switch (cmd) {
        case 'SET_HEATER_TEMPERATURE': {
          const heater = param(line, 'HEATER');
          const obj = heater === 'heater_bed' || heater?.startsWith('extruder') ? heater : `heater_generic ${heater}`;
          if (!state[obj]) throw new Error(`Unknown heater ${heater}`);
          patch({ [obj]: { target: Number(param(line, 'TARGET')) } });
          break;
        }
        case 'SET_LED':
          if (param(line, 'LED') === 'cavity_led') patch({ 'led cavity_led': { color_data: [[0, 0, 0, Number(param(line, 'WHITE') ?? 0)]] } });
          break;
        case 'G28':
          patch({ toolhead: { homed_axes: 'xyz' }, gcode_move: { gcode_position: [0, 0, 0, 0] } });
          break;
        case 'G1': {
          const pos = [...state.gcode_move.gcode_position];
          for (const [i, a] of ['X', 'Y', 'Z'].entries()) {
            const m = new RegExp(`${a}(-?[\\d.]+)`).exec(line);
            if (m) pos[i] += Number(m[1]);
          }
          patch({ gcode_move: { gcode_position: pos } });
          break;
        }
        case 'M106':
          patch({ fan: { speed: Number(/S(\d+)/.exec(line)?.[1] ?? 255) / 255 } });
          break;
        case 'SET_PURIFIER': {
          const fan = param(line, 'FAN');
          patch({ purifier: { [`${fan}_fan`]: { speed: Number(param(line, 'SPEED')) } } });
          break;
        }
        case 'SET_PRINT_FILAMENT_CONFIG': {
          const i = Number(param(line, 'CONFIG_EXTRUDER'));
          if (ptc.filament_official[i]) throw new Error('[print_task_config] filament_config, official filament, not configurable!');
          patch({
            print_task_config: {
              filament_type: setArr(ptc.filament_type, i, param(line, 'FILAMENT_TYPE')),
              filament_sub_type: setArr(ptc.filament_sub_type, i, param(line, 'FILAMENT_SUBTYPE')),
              filament_vendor: setArr(ptc.filament_vendor, i, param(line, 'VENDOR')),
              filament_color_rgba: setArr(ptc.filament_color_rgba, i, param(line, 'FILAMENT_COLOR_RGBA')),
            },
          });
          break;
        }
        case 'FEED_AUTO': {
          const ch = Number(param(line, 'CHANNEL'));
          const module = param(line, 'MODULE');
          const key = Object.keys(state[`filament_feed ${module}`])[ch];
          const head = Number(key.replace('extruder', ''));
          const load = param(line, 'LOAD') === '1';
          patch({ machine_state_manager: { main_state: load ? 9 : 10 } });
          setTimeout(() => patch({ machine_state_manager: { main_state: 0 }, print_task_config: { filament_exist: setArr(state.print_task_config.filament_exist, head, load) } }), 600);
          break;
        }
        case 'PICK_EXTRUDER':
        case 'PICK_EXTRUDER1':
        case 'PICK_EXTRUDER2':
        case 'PICK_EXTRUDER3':
        case 'PARK_EXTRUDER':
        case 'PARK_EXTRUDER1':
        case 'PARK_EXTRUDER2':
        case 'PARK_EXTRUDER3': {
          const name = cmd.slice(5).toLowerCase();
          const pick = cmd.startsWith('PICK');
          const heads = ['extruder', 'extruder1', 'extruder2', 'extruder3'];
          patch({
            toolhead: { homed_axes: 'xyz', ...(pick ? { extruder: name } : {}) },
            ...Object.fromEntries(heads.map((h) => [h, { state: pick && h === name ? 'ACTIVATE' : 'PARKED', ...(pick && h === name ? { switch_count: state[h].switch_count + 1 } : {}) }])),
          });
          break;
        }
        case 'SET_NOZZLE_PROPERTIES': {
          const name = param(line, 'EXTRUDER');
          if (!state[name]) throw new Error(`Unknown extruder ${name}`);
          patch({ [name]: { nozzle_diameter: Number(param(line, 'DIAMETER')), nozzle_volume_type: param(line, 'VOLUME_TYPE') } });
          break;
        }
        case 'RESET_EXTRUDER_MAINTENANCE_COUNT':
          patch(Object.fromEntries(['extruder', 'extruder1', 'extruder2', 'extruder3'].map((h) => [h, { last_maintenance_count: state[h].switch_count }])));
          break;
        case 'SET_PRINT_PREFERENCES':
          patch({ print_task_config: { auto_bed_leveling: param(line, 'BED_LEVEL') === '1', flow_calibrate: param(line, 'FLOW_CALIBRATE') === '1', time_lapse_camera: param(line, 'TIME_LAPSE_CAMERA') === '1' } });
          break;
        case 'SET_PRINT_EXTRUDER_MAP':
          patch({ print_task_config: { extruder_map_table: setArr(ptc.extruder_map_table, Number(param(line, 'CONFIG_EXTRUDER')), Number(param(line, 'MAP_EXTRUDER'))) } });
          break;
        default:
          break;
      }
      broadcast('notify_gcode_response', [`// ok ${cmd}`]);
    }
  };

  const startPrint = (filename) => {
    if (!files.has(filename)) throw new Error(`File not found: ${filename}`);
    clearInterval(printTimer);
    patch({ print_stats: { state: 'printing', filename, print_duration: 0, info: { current_layer: 1, total_layer: 50 } }, virtual_sdcard: { progress: 0, is_active: true } });
    printTimer = setInterval(() => {
      if (state.print_stats.state !== 'printing') return;
      const p = Math.min(1, state.virtual_sdcard.progress + 0.01);
      patch({ virtual_sdcard: { progress: p }, print_stats: { print_duration: state.print_stats.print_duration + 1, info: { current_layer: Math.ceil(p * 50) || 1, total_layer: 50 } } });
      if (p >= 1) {
        clearInterval(printTimer);
        patch({ print_stats: { state: 'complete' }, virtual_sdcard: { is_active: false } });
      }
    }, 300);
  };

  const rpc = (method, params = {}) => {
    switch (method) {
      case 'server.info':
        return { klippy_state: state.webhooks.state, moonraker_version: 'v0.9-mock' };
      case 'printer.info':
        return { state: 'ready', hostname: generic ? 'voron-mock' : 'U1-mock', software_version: 'mock' };
      case 'printer.objects.list':
        return { objects: Object.keys(state) };
      case 'printer.objects.subscribe':
      case 'printer.objects.query': {
        const status = {};
        for (const k of Object.keys(params.objects ?? {})) if (state[k]) status[k] = structuredClone(state[k]);
        return { eventtime: Date.now() / 1000, status };
      }
      case 'printer.gcode.script':
        runGcode(params.script);
        return 'ok';
      case 'printer.print.start':
        startPrint(params.filename);
        return 'ok';
      case 'printer.print.pause':
        patch({ print_stats: { state: 'paused' } });
        return 'ok';
      case 'printer.print.resume':
        patch({ print_stats: { state: 'printing' } });
        return 'ok';
      case 'printer.print.cancel':
        clearInterval(printTimer);
        patch({ print_stats: { state: 'cancelled' }, virtual_sdcard: { is_active: false } });
        return 'ok';
      case 'printer.emergency_stop':
        patch({ webhooks: { state: 'shutdown', state_message: 'Emergency stop' } });
        return 'ok';
      case 'printer.firmware_restart':
        patch({ webhooks: { state: 'ready', state_message: 'Printer is ready' } });
        return 'ok';
      case 'server.files.list':
        return [...files].map(([path, f]) => ({ path, size: f.size, modified: f.modified, permissions: 'rw' }));
      case 'server.files.metadata': {
        const f = files.get(params.filename);
        if (!f) throw Object.assign(new Error('Metadata not available'), { code: 404 });
        // Like Moonraker's metadata extractor, read the slicer's comments.
        const kv = (k) => new RegExp(`^;\\s*${k.replace(/[[\]]/g, '\\$&')}\\s*=\\s*(.*)$`, 'm').exec(f.text)?.[1]?.trim();
        return {
          filename: params.filename,
          size: f.size,
          estimated_time: 3600,
          filament_colors: (kv('filament_colour') ?? '').split(';').filter(Boolean),
          filament_type: kv('filament_type') ?? '',
          filament_weights: (kv('filament used [g]') ?? '').split(',').filter(Boolean).map(Number),
        };
      }
      case 'server.files.delete_file':
        files.delete(String(params.path).replace(/^gcodes\//, ''));
        broadcast('notify_filelist_changed', [{ action: 'delete_file' }]);
        return { item: { path: params.path } };
      case 'server.webcams.list':
        return { webcams: generic ? [{ name: 'cam', enabled: true, snapshot_url: '/webcam/?action=snapshot', stream_url: '/webcam/?action=stream' }] : [] };
      case 'camera.start_monitor':
        return 'ok';
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
    }
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const headers = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS' };
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { ...headers, 'Content-Type': type });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204, '');
    if (url.pathname === '/server/files/camera/monitor.jpg' || url.pathname === '/webcam/') {
      if (generic === (url.pathname === '/webcam/')) return send(200, pngFrame(frame++), 'image/png');
      return send(404, { error: { message: 'no camera here' } });
    }
    if (url.pathname === '/server/files/upload' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const boundary = /boundary=(.+)$/.exec(req.headers['content-type'] ?? '')?.[1];
      const parts = body.toString('latin1').split(`--${boundary}`);
      const filePart = parts.find((p) => /name="file"/.test(p));
      const name = /filename="([^"]+)"/.exec(filePart ?? '')?.[1] ?? 'upload.gcode';
      const content = filePart ? filePart.slice(filePart.indexOf('\r\n\r\n') + 4, -2) : '';
      files.set(name, { size: Buffer.byteLength(content, 'latin1'), modified: Date.now() / 1000, text: content });
      broadcast('notify_filelist_changed', [{ action: 'create_file', item: { path: name } }]);
      return send(201, { result: { item: { path: name, root: 'gcodes' }, action: 'create_file' } });
    }
    if (url.pathname === '/printer/info') return send(200, { result: rpc('printer.info') });
    return send(404, { error: { message: `Not found: ${url.pathname}` } });
  });

  const wss = new WebSocketServer({ server, path: '/websocket' });
  wss.on('connection', (ws) => {
    const client = { ws, objects: new Set() };
    clients.add(client);
    ws.on('close', () => clients.delete(client));
    ws.on('error', () => clients.delete(client));
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      try {
        if (msg.method === 'printer.objects.subscribe') client.objects = new Set(Object.keys(msg.params?.objects ?? {}));
        const result = rpc(msg.method, msg.params);
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      } catch (e) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: e.code ?? 400, message: e.message } }));
      }
    });
  });

  await new Promise((ok) => server.listen(port, host, ok));
  return {
    url: `http://${host}:${server.address().port}`,
    scripts,
    files,
    get state() {
      return state;
    },
    patch,
    reset() {
      state = u1State(generic);
      scripts.length = 0;
    },
    async close() {
      clearInterval(drift);
      clearInterval(printTimer);
      for (const c of clients) c.ws.terminate();
      wss.close();
      server.closeAllConnections?.();
      await new Promise((ok) => server.close(ok));
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 7125);
  const mock = await startMockPrinter({ port, host: '0.0.0.0', generic: process.argv.includes('--generic') });
  console.log(`mock printer: ${mock.url.replace('0.0.0.0', 'localhost')}`);
}

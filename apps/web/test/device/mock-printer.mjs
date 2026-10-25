#!/usr/bin/env node
// A pretend Snapmaker U1 (Klipper + Moonraker) for testing the Device tab.
// NOTHING here touches hardware: temperatures drift toward their targets,
// "printing" is a timer, loading filament flips a flag. It speaks Moonraker's
// JSON-RPC websocket, the HTTP upload and camera endpoints, and CORS.
//
//   node test/device/mock-printer.mjs [port] [--generic]   (--generic: plain Klipper, no U1 objects)
//
// Tests read every G-code script it received from mock.scripts, and how hard
// the page leaned on it from mock.stats.
//
// Cameras: the U1 has none in Moonraker; like the real one, camera.start_monitor
// makes it rewrite camera/monitor.jpg several times a second, and Moonraker
// announces every rewrite as a notify_filelist_changed in the "camera" root.
// The generic printer lists two webcams, like the paxx12 firmware plus a
// crowsnest camera: an iframe player page and an MJPEG stream.
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
    // The U1's fans: one part fan (fan), a hotend fan per head, per-head part fans the UI leaves out, and its case fans.
    // Head 3's hotend fan still spins while it cools in its dock.
    delete s['heater_fan hotend_fan'];
    Object.assign(s, {
      'fan_generic cavity_fan': { speed: 0 },
      'fan_generic exhaust_fan': { speed: 0 },
      'fan_generic circulation_fan': { speed: 0 },
      'controller_fan power_fan': { speed: 0 },
      'heater_fan e0_nozzle_fan': { speed: 0 },
      'heater_fan e1_nozzle_fan': { speed: 0 },
      'heater_fan e2_nozzle_fan': { speed: 1 },
      'heater_fan e3_nozzle_fan': { speed: 0 },
      'fan_generic e1_fan': { speed: 0 },
      'fan_generic e2_fan': { speed: 0 },
      'fan_generic e3_fan': { speed: 0 },
    });
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
        extruder3: { module_exist: true, filament_detected: false, disable_auto: false, channel_state: 'none', channel_error: 'ok' },
      },
      // The sensors in the heads: filament in the head itself (the feeders above feel filament waiting at the side).
      ...Object.fromEntries([true, true, true, false].map((d, i) => [`filament_motion_sensor e${i}_filament`, { enabled: true, filament_detected: d }])),
      purifier: { power_detected: true, mode: 'auto', exhaust_fan: { speed: 0 }, inner_fan: { speed: 0 } },
      machine_state_manager: { main_state: 0, action_code: 0 },
    });
  }
  return s;
}

/** A solid-colour PNG that changes colour each frame: the "camera". */
export function pngFrame(n, w = 64, h = 48) {
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

// Slicer thumbnails in a G-code file, found the way Moonraker's metadata
// extractor finds them (file_manager/metadata.py, parse_thumbnails): PNG
// blocks whose base64 length matches the header. Moonraker also converts QOI
// and JPG and makes a 32x32 miniature; the mock keeps PNGs only.
export function gcodeThumbnails(text) {
  const out = [];
  for (const m of text.matchAll(/(thumbnail(?:_[A-Za-z0-9]+)?) begin([;/+=\w\s]+?); \1 end/g)) {
    if ((m[1].split('_')[1] ?? 'png').toLowerCase() !== 'png') continue;
    const lines = m[2].replaceAll('; ', '').split(/\r?\n/);
    const info = (lines[0].match(/\d+/g) ?? []).map(Number);
    const data = lines.slice(1, -1).join('');
    if (info.length !== 3 || data.length !== info[2]) continue;
    out.push({ width: info[0], height: info[1], png: Buffer.from(data, 'base64') });
  }
  return out;
}

// A G-code thumbnail block, as slicers write it.
export function thumbnailBlock(png) {
  const b64 = png.toString('base64');
  const rows = b64.match(/.{1,78}/g).map((r) => `; ${r}\n`).join('');
  return `; THUMBNAIL_BLOCK_START\n;\n; thumbnail begin ${png.readUInt32BE(16)}x${png.readUInt32BE(20)} ${b64.length}\n${rows}; thumbnail end\n; THUMBNAIL_BLOCK_END\n`;
}

// `brand` and `objects` make it stand in for the bridge's stand-in for another
// kind of printer: printer.info's brand, and that printer's own objects.
// `printStep`: how much of a print each 0.3 s tick does (0.01: a 30 s print).
export async function startMockPrinter({ port = 0, host = '127.0.0.1', generic = false, hostname = generic ? 'voron-mock' : 'U1-mock', apiKey = '', screen = false, brand = '', objects = {}, printStep = 0.01 } = {}) {
  const fresh = () => ({ ...u1State(generic), ...structuredClone(objects) });
  let state = fresh();
  // Three objects, the way Orca labels them for Klipper's exclude_object.
  const labels = [
    'EXCLUDE_OBJECT_DEFINE NAME=Calibration_cube.stl_id_0_copy_0 CENTER=80,80 POLYGON=[[60,60],[100,60],[100,100],[60,100]]',
    'EXCLUDE_OBJECT_DEFINE NAME=Calibration_cube.stl_id_0_copy_1 CENTER=190,80 POLYGON=[[170,60],[210,60],[210,100],[170,100]]',
    'EXCLUDE_OBJECT_DEFINE NAME=Ring_id_1_copy_0 CENTER=135,190 POLYGON=[[115,175],[135,165],[155,175],[155,205],[135,215],[115,205]]',
  ].join('\n');
  const cube = `${thumbnailBlock(pngFrame(3, 300, 300))}; filament_colour = #FF0000\n; filament_type = PLA\n; filament used [g] = 5.1\n${labels}\n`;
  const files = new Map([['calibration_cube.gcode', { size: 123456, modified: Date.now() / 1000 - 3600, text: cube }]]);
  const scripts = [];
  // Upload behaviour tests can change: refuse with Moonraker's message, or read the file slowly.
  const uploads = { refuse: '', slowMs: 0 };
  const clients = new Set();
  let frame = 0;
  let printTimer = null;
  const stats = { fileLists: 0, startMonitor: 0, touches: [], screenPictures: 0, pagePolls: 0, refused: [] };
  let monitorUntil = 0;
  let monitorTimer = null;
  const streams = new Set();
  // Snapmaker's Moonraker keeps the U1's current errors ("exceptions").
  let exceptions = [];

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
    const m = new RegExp(`(?:^|\\s)${key}=('([^']*)'|"([^"]*)"|(\\S+))`, 'i').exec(line);
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
        // Klipper's temperature report, the line console filters hide by default.
        case 'M105':
          broadcast('notify_gcode_response', [`ok B:${state.heater_bed.temperature.toFixed(1)} /${state.heater_bed.target.toFixed(1)} T0:${state.extruder.temperature.toFixed(1)} /${state.extruder.target.toFixed(1)}`]);
          continue;
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
          // Like the U1: unloading pulls the filament back to the feeder, which still feels it, so filament_exist stays true.
          const feed = `filament_feed ${module}`;
          setTimeout(
            () =>
              patch({
                machine_state_manager: { main_state: 0 },
                [`filament_motion_sensor e${head}_filament`]: { filament_detected: load },
                ...(load ? { [feed]: { [key]: { ...state[feed][key], filament_detected: true } }, print_task_config: { filament_exist: setArr(state.print_task_config.filament_exist, head, true) } } : {}),
              }),
            600,
          );
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
        case 'EXCLUDE_OBJECT': {
          const name = param(line, 'NAME')?.toUpperCase();
          const ex = state.exclude_object;
          if (!ex.objects.some((o) => o.name === name)) throw new Error(`Unknown object ${name}`);
          if (!ex.excluded_objects.includes(name)) patch({ exclude_object: { excluded_objects: [...ex.excluded_objects, name], ...(ex.current_object === name ? { current_object: null } : {}) } });
          break;
        }
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
    // Klipper reads the file's EXCLUDE_OBJECT_DEFINE lines (names upper-cased).
    const objects = [...String(files.get(filename).text ?? '').matchAll(/^EXCLUDE_OBJECT_DEFINE NAME=(\S+) CENTER=([\d.]+),([\d.]+) POLYGON=(\S+)$/gm)].map((m) => ({
      name: m[1].toUpperCase(),
      center: [Number(m[2]), Number(m[3])],
      polygon: JSON.parse(m[4]),
    }));
    patch({ exclude_object: { objects, excluded_objects: [], current_object: objects[0]?.name ?? null } });
    patch({ print_stats: { state: 'printing', filename, print_duration: 0, filament_used: 0, info: { current_layer: 1, total_layer: 50 } }, virtual_sdcard: { progress: 0, is_active: true } });
    printTimer = setInterval(() => {
      if (state.print_stats.state !== 'printing') return;
      const p = Math.min(1, state.virtual_sdcard.progress + printStep);
      patch({ virtual_sdcard: { progress: p }, print_stats: { print_duration: state.print_stats.print_duration + 1, filament_used: Math.round(p * 2700), info: { current_layer: Math.ceil(p * 50) || 1, total_layer: 50 } } });
      // The head moves from object to object, never to a skipped one.
      const ex = state.exclude_object;
      const left = ex.objects.filter((o) => !ex.excluded_objects.includes(o.name));
      if (left.length) patch({ exclude_object: { current_object: left[Math.floor(p * 100) % left.length].name } });
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
        return { state: 'ready', hostname, software_version: 'mock', ...(brand ? { brand } : {}) };
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
        stats.fileLists++;
        return [...files].map(([path, f]) => ({ path, size: f.size, modified: f.modified, permissions: 'rw' }));
      case 'server.files.metadata': {
        const f = files.get(params.filename);
        if (!f) throw Object.assign(new Error('Metadata not available'), { code: 404 });
        // Like Moonraker's metadata extractor, read the slicer's comments.
        const kv = (k) => new RegExp(`^;\\s*${k.replace(/[[\]\\]/g, '\\$&')}\\s*=\\s*(.*)$`, 'm').exec(f.text)?.[1]?.trim();
        return {
          filename: params.filename,
          size: f.size,
          estimated_time: Number(kv('estimated_time_s') ?? 3600),
          // Every pretend print here runs 50 layers.
          layer_count: 50,
          thumbnails: gcodeThumbnails(f.text).map((t) => ({
            width: t.width,
            height: t.height,
            size: t.png.length,
            relative_path: `.thumbs/${params.filename.replace(/\.[^.]+$/, '')}-${t.width}x${t.height}.png`,
          })),
          filament_colors: (kv('filament_colour') ?? '').split(';').filter(Boolean),
          // Like Moonraker: one material as is, several as a JSON list in a string.
          filament_type: ((t) => (t.includes(';') ? JSON.stringify(t.split(';')).replaceAll('","', '", "') : t))(kv('filament_type') ?? ''),
          filament_weights: (kv('filament used [g]') ?? '').split(',').filter(Boolean).map(Number),
          // The whole file's filament, as Moonraker reads it from the slicer's footer.
          filament_total: 2700,
          filament_weight_total: 8,
        };
      }
      case 'server.files.delete_file':
        files.delete(String(params.path).replace(/^gcodes\//, ''));
        broadcast('notify_filelist_changed', [{ action: 'delete_file', item: { root: 'gcodes', path: params.path } }]);
        return { item: { path: params.path } };
      case 'server.webcams.list':
        return {
          webcams: generic
            ? [
                { name: 'case', service: 'iframe', enabled: true, stream_url: '/webcam/player', snapshot_url: '/webcam/snapshot.jpg', aspect_ratio: '16:9', target_fps: 15 },
                { name: 'nozzle', service: 'mjpegstreamer', enabled: true, stream_url: '/webcam2/?action=stream', snapshot_url: '/webcam2/?action=snapshot', target_fps: 15 },
                ...(screen ? [{ name: 'gui', service: 'iframe', enabled: true, stream_url: '/screen/', snapshot_url: '/screen/snapshot', aspect_ratio: '3:2', target_fps: 10 }] : []),
              ]
            : [],
        };
      case 'server.exception.query':
        if (generic) throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
        return { exceptions };
      case 'camera.start_monitor':
        stats.startMonitor++;
        monitorUntil = Date.now() + 20_000;
        monitorTimer ??= setInterval(() => {
          if (Date.now() > monitorUntil) {
            clearInterval(monitorTimer);
            monitorTimer = null;
            return;
          }
          frame++;
          broadcast('notify_filelist_changed', [{ action: 'modify_file', item: { root: 'camera', path: 'monitor.jpg' } }]);
        }, 250);
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
    // What the bridge asks when it finds or is given a printer.
    if (url.pathname === '/printer/info') {
      if (apiKey && req.headers['x-api-key'] !== apiKey) return send(401, { error: { message: 'Unauthorized' } });
      return send(200, { result: { state: 'ready', hostname, software_version: 'mock' } });
    }
    // Slicer thumbnails Moonraker extracted from the G-code.
    if (url.pathname.startsWith('/server/files/gcodes/.thumbs/')) {
      const m = /^(.*)-(\d+)x(\d+)\.png$/.exec(decodeURIComponent(url.pathname.slice('/server/files/gcodes/.thumbs/'.length)));
      const file = m && [...files].find(([p]) => p.replace(/\.[^.]+$/, '') === m[1])?.[1];
      const thumb = file && gcodeThumbnails(file.text).find((t) => t.width === Number(m[2]) && t.height === Number(m[3]));
      if (!thumb) return send(404, { error: { message: 'no thumbnail' } });
      return send(200, thumb.png, 'image/png');
    }
    if (url.pathname === '/server/files/camera/monitor.jpg') {
      if (!generic && Date.now() < monitorUntil) return send(200, pngFrame(frame), 'image/png');
      return send(404, { error: { message: 'no camera here' } });
    }
    if (generic && (url.pathname === '/webcam/snapshot.jpg' || (url.pathname === '/webcam2/' && url.searchParams.get('action') === 'snapshot'))) {
      return send(200, pngFrame(frame++), 'image/png');
    }
    // The bridge reads the camera list over HTTP to know which pages it may open.
    if (url.pathname === '/server/webcams/list') {
      if (apiKey && req.headers['x-api-key'] !== apiKey) return send(401, { error: { message: 'Unauthorized' } });
      return send(200, { result: await rpc('server.webcams.list', {}) });
    }
    // Moonraker's API keys and system calls: a printer page must never get here.
    // What the bridge asks for the websocket when the printer has an API key.
    if (url.pathname === '/access/oneshot_token') {
      if (apiKey && req.headers['x-api-key'] !== apiKey) return send(401, { error: { message: 'Unauthorized' } });
      return send(200, { result: 'mock-oneshot-token' });
    }
    if (/^\/(access|machine)\//.test(url.pathname)) {
      stats.refused.push(url.pathname);
      return send(200, { result: { api_key: apiKey || 'secret' } });
    }
    // A remote screen like paxx12's, behind the web login: polls its picture
    // (with If-None-Match) ten times a second and sends taps as POST touch?....
    if (screen && url.pathname.startsWith('/screen/')) {
      if (apiKey && req.headers['x-api-key'] !== apiKey) return send(401, 'login first', 'text/plain');
      if (url.pathname === '/screen/')
        return send(
          200,
          `<!doctype html><title>Mock screen</title><style>html,body{margin:0;height:100%;background:#111;color:#fff;font:16px sans-serif}img{width:100%;height:100%;object-fit:contain}p{position:fixed;left:8px;top:0;pointer-events:none}</style>
<img id="s" src="snapshot" alt="screen"><p id="taps">mock screen: 0 taps</p>
<script>
let etag = '', taps = 0;
setInterval(async () => {
  const h = etag ? { 'If-None-Match': etag } : {};
  const r = await fetch('snapshot?ts=' + Date.now(), { headers: h }).catch(() => null);
  if (r && r.status === 200) { etag = r.headers.get('ETag') || ''; document.getElementById('s').src = URL.createObjectURL(await r.blob()); }
}, 100);
document.addEventListener('pointerdown', async (e) => {
  const r = await fetch('touch?a=tap&x=' + Math.round(e.clientX) + '&y=' + Math.round(e.clientY), { method: 'POST' });
  if (r.ok) document.getElementById('taps').textContent = 'mock screen: ' + ++taps + ' taps';
});
</script>`,
          'text/html',
        );
      if (url.pathname === '/screen/snapshot') {
        // The page's own polls carry ?ts=; the camera tile's pictures don't.
        if (url.searchParams.has('ts')) stats.pagePolls++;
        const etag = `"t${stats.touches.length}"`;
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { ...headers, ETag: etag });
          return res.end();
        }
        stats.screenPictures++;
        res.writeHead(200, { ...headers, 'Content-Type': 'image/png', ETag: etag });
        return res.end(pngFrame(stats.touches.length, 480, 320));
      }
      if (url.pathname === '/screen/touch' && req.method === 'POST') {
        stats.touches.push(url.search);
        res.writeHead(204, headers);
        return res.end();
      }
      return send(404, 'no such page', 'text/plain');
    }
    if (generic && url.pathname === '/webcam/player') {
      return send(200, '<!doctype html><title>player</title><body style="margin:0;background:#123"><p style="color:#fff">mock camera player</p></body>', 'text/html');
    }
    if (generic && url.pathname === '/webcam2/' && url.searchParams.get('action') === 'stream') {
      res.writeHead(200, { ...headers, 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store' });
      const push = () => {
        const img = pngFrame(frame++);
        res.write(`--frame\r\nContent-Type: image/png\r\nContent-Length: ${img.length}\r\n\r\n`);
        res.write(img);
        res.write('\r\n');
      };
      push();
      const t = setInterval(push, 200);
      streams.add(t);
      req.on('close', () => {
        clearInterval(t);
        streams.delete(t);
      });
      return;
    }
    if (url.pathname === '/server/files/upload' && req.method === 'POST') {
      const chunks = [];
      try {
        for await (const c of req) {
          chunks.push(c);
          if (uploads.slowMs) await new Promise((r) => setTimeout(r, uploads.slowMs));
        }
      } catch {
        // The sender stopped halfway (a cancelled upload): like Moonraker, keep nothing.
        return;
      }
      if (uploads.refuse) return send(403, { error: { code: 403, message: uploads.refuse } });
      const body = Buffer.concat(chunks);
      const boundary = (req.headers['content-type'] ?? '').split('boundary=')[1];
      const parts = body.toString('latin1').split(`--${boundary}`);
      const filePart = parts.find((p) => /name="file"/.test(p));
      const name = /filename="([^"]+)"/.exec(filePart ?? '')?.[1] ?? 'upload.gcode';
      const content = filePart ? filePart.slice(filePart.indexOf('\r\n\r\n') + 4, -2) : '';
      files.set(name, { size: Buffer.byteLength(content, 'latin1'), modified: Date.now() / 1000, text: content });
      broadcast('notify_filelist_changed', [{ action: 'create_file', item: { root: 'gcodes', path: name } }]);
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
    uploads,
    stats,
    get state() {
      return state;
    },
    patch,
    startPrint,
    /** Sets the U1's current errors ({ id, index, code, level, message }) and announces the new list. */
    setExceptions(list) {
      exceptions = list;
      broadcast('notify_exception_status', [{ exceptions }]);
    },
    /** A one-off error announcement, like a U1 refusing a command. */
    announceException(e) {
      broadcast('notify_exception_notification', [e]);
    },
    reset() {
      state = fresh();
      scripts.length = 0;
      exceptions = [];
    },
    async close() {
      clearInterval(drift);
      clearInterval(printTimer);
      clearInterval(monitorTimer);
      for (const t of streams) clearInterval(t);
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

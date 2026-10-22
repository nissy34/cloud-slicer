import { describe, expect, it, vi } from 'vitest';
import { BRIDGE_SNAPSHOT_FPS, DIRECT_PICTURE_FPS, MAX_SNAPSHOT_FPS, cameraTransform, cameraViews, parseWebcams } from './camera';
import { coalesce } from './coalesce';
import { touchesGcodes } from './session';
import { go2rtcSocketUrl } from './webrtc';

// What Moonraker answered on Nissan's U1 running the paxx12 firmware, plus a typical crowsnest camera.
const LIST = {
  webcams: [
    { name: 'case', service: 'iframe', stream_url: '/webcam/player', snapshot_url: '/webcam/snapshot.jpg', aspect_ratio: '16:9', target_fps: 15, enabled: true },
    { name: 'usb', service: 'iframe', stream_url: '/webcam2/player', snapshot_url: '/webcam2/snapshot.jpg', aspect_ratio: '16:9', enabled: true },
    { name: 'nozzle', uid: 'n-1', service: 'mjpegstreamer', stream_url: '/webcam3/?action=stream', snapshot_url: '/webcam3/?action=snapshot', flip_horizontal: true, rotation: 90 },
    { name: 'off', service: 'mjpegstreamer', stream_url: '/x', enabled: false },
  ],
};

describe('parseWebcams', () => {
  it('keeps every enabled camera, in order, with its settings', () => {
    const cams = parseWebcams(LIST);
    expect(cams.map((c) => c.name)).toEqual(['case', 'usb', 'nozzle']);
    expect(cams[0]).toMatchObject({ id: 'case', service: 'iframe', streamUrl: '/webcam/player', snapshotUrl: '/webcam/snapshot.jpg', targetFps: 15 });
    expect(cams[0].aspect).toBeCloseTo(16 / 9);
    expect(cams[2]).toMatchObject({ id: 'n-1', flipH: true, rotation: 90 });
    expect(cams[2].aspect).toBeCloseTo(4 / 3);
  });

  it('copes with nothing, junk and duplicate names', () => {
    expect(parseWebcams(null)).toEqual([]);
    expect(parseWebcams({ webcams: 'no' })).toEqual([]);
    const dup = parseWebcams({ webcams: [{ name: 'a', snapshot_url: '/a' }, { name: 'a', snapshot_url: '/b' }, { name: 'empty' }] });
    expect(dup.map((c) => c.id)).toEqual(['a', 'a+']);
  });
});

describe('cameraViews', () => {
  const [caseCam, , nozzle] = parseWebcams(LIST);

  it('streams live where it can and keeps snapshots as the fallback', () => {
    expect(cameraViews(caseCam, false)).toEqual([
      { kind: 'iframe', url: '/webcam/player' },
      { kind: 'snapshots', url: '/webcam/snapshot.jpg', fps: MAX_SNAPSHOT_FPS },
    ]);
    expect(cameraViews(nozzle, false)[0]).toEqual({ kind: 'mjpeg', url: '/webcam3/?action=stream' });
  });

  it('picks the WebRTC signalling each server speaks', () => {
    const cam = (service: string) => parseWebcams({ webcams: [{ name: 'c', service, stream_url: '/s', snapshot_url: '/p' }] })[0];
    expect(cameraViews(cam('webrtc-camerastreamer'), false)[0]).toEqual({ kind: 'webrtc', protocol: 'camera-streamer', url: '/s' });
    expect(cameraViews(cam('webrtc-mediamtx'), false)[0]).toEqual({ kind: 'webrtc', protocol: 'whep', url: '/s' });
    expect(cameraViews(cam('webrtc-go2rtc'), false)[0]).toEqual({ kind: 'webrtc', protocol: 'go2rtc', url: '/s' });
    expect(cameraViews(cam('mjpegstreamer-adaptive'), false)).toEqual([{ kind: 'snapshots', url: '/p', fps: MAX_SNAPSHOT_FPS }]);
  });

  it('through the bridge: a direct link first, then slow snapshots over the relay', () => {
    expect(cameraViews(caseCam, true)).toEqual([
      { kind: 'direct', camera: { service: caseCam.service, streamUrl: caseCam.streamUrl, snapshotUrl: '/webcam/snapshot.jpg', fps: Math.min(DIRECT_PICTURE_FPS, caseCam.targetFps) } },
      { kind: 'snapshots', url: '/webcam/snapshot.jpg', fps: BRIDGE_SNAPSHOT_FPS },
    ]);
    const streamOnly = parseWebcams({ webcams: [{ name: 's', service: 'webrtc-camerastreamer', stream_url: '/s' }] })[0];
    expect(cameraViews(streamOnly, true)).toEqual([{ kind: 'direct', camera: { service: 'webrtc-camerastreamer', streamUrl: '/s', snapshotUrl: '', fps: DIRECT_PICTURE_FPS } }]);
    const none = parseWebcams({ webcams: [{ name: 'n', service: 'mjpegstreamer', snapshot_url: '', stream_url: '' }] });
    expect(none.length ? cameraViews(none[0], true) : []).toEqual([]);
  });

  it('builds the transform from flip and rotation', () => {
    expect(cameraTransform(nozzle)).toBe('scaleX(-1) rotate(90deg)');
    expect(cameraTransform(caseCam)).toBe('');
  });
});

describe('go2rtcSocketUrl', () => {
  it('turns the stream address into the websocket API', () => {
    expect(go2rtcSocketUrl('/go2rtc/stream.html?src=cam', 'https://printer.example/')).toBe('wss://printer.example/go2rtc/api/ws?src=cam&media=video');
    expect(go2rtcSocketUrl('http://p:1984/api/webrtc?src=cam', 'https://x/')).toBe('ws://p:1984/api/ws?src=cam&media=video');
  });
});

describe('touchesGcodes', () => {
  it('ignores changes in other roots, such as the U1 camera frames', () => {
    expect(touchesGcodes([{ action: 'modify_file', item: { root: 'camera', path: 'monitor.jpg' } }])).toBe(false);
    expect(touchesGcodes([{ action: 'create_file', item: { root: 'gcodes', path: 'a.gcode' } }])).toBe(true);
    expect(touchesGcodes([{ action: 'move_file', item: { root: 'config', path: 'a' }, source_item: { root: 'gcodes', path: 'a' } }])).toBe(true);
    expect(touchesGcodes([{ action: 'delete_file' }])).toBe(true);
  });
});

describe('coalesce', () => {
  it('folds a burst of calls into one run now and one trailing run', async () => {
    vi.useFakeTimers();
    try {
      let runs = 0;
      const refresh = coalesce(async () => {
        runs++;
      }, 2000);
      const calls = Array.from({ length: 20 }, () => refresh());
      await vi.advanceTimersByTimeAsync(0);
      expect(runs).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.all(calls);
      expect(runs).toBe(2);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(runs).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

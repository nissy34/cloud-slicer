import { useEffect, useState } from 'react';
import { currentSession, useDevice } from '../../state/device';
import { BridgeLink } from '../link/bridge';
import { Card } from './parts';

const LEGACY_SNAPSHOT = '/webcam/?action=snapshot';

/**
 * Polls camera snapshots (works through the bridge and needs no stream
 * support), only while the card is on screen and the page is visible.
 */
export function CameraCard() {
  const online = useDevice((s) => s.conn.state === 'online');
  const addons = useDevice((s) => s.addons);
  const facts = useDevice((s) => s.facts);
  const [on, setOn] = useState(true);
  const [frame, setFrame] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [transform, setTransform] = useState('');

  useEffect(() => {
    const session = currentSession();
    if (!online || !on || !session || !facts) return;
    let stopped = false;
    let url: string | null = null;
    const hints = addons.map((a) => a.camera).filter(Boolean);
    const keepalive = hints.find((h) => h?.keepalive)?.keepalive;
    const throughBridge = session.link instanceof BridgeLink;
    const interval = throughBridge ? 1000 : 500;
    let lastKeepalive = 0;
    setFailed(false);

    const loop = async () => {
      const cams = await session.webcams();
      const cam = cams[0];
      if (cam) setTransform(`${cam.flipH ? 'scaleX(-1) ' : ''}${cam.flipV ? 'scaleY(-1) ' : ''}${cam.rotation ? `rotate(${cam.rotation}deg)` : ''}`.trim());
      const candidates = [...hints.map((h) => h?.snapshotUrl), ...cams.map((c) => c.snapshotUrl), LEGACY_SNAPSHOT].filter((u, i, a): u is string => !!u && a.indexOf(u) === i);
      let index = 0;
      let misses = 0;
      while (!stopped) {
        const started = Date.now();
        if (document.visibilityState === 'visible') {
          if (keepalive && started - lastKeepalive >= keepalive.everyMs) {
            lastKeepalive = started;
            session.notify(keepalive.method, keepalive.params);
          }
          try {
            const blob = await session.link.snapshot(candidates[index]);
            if (stopped) break;
            const next = URL.createObjectURL(blob);
            if (url) URL.revokeObjectURL(url);
            url = next;
            setFrame(next);
            setFailed(false);
            misses = 0;
          } catch {
            // Try the next address; after a full round with nothing, say so but keep trying slowly.
            index = (index + 1) % candidates.length;
            if (++misses >= candidates.length) setFailed(true);
          }
        }
        const wait = Math.max(100, (misses >= candidates.length ? 5000 : interval) - (Date.now() - started));
        await new Promise((r) => setTimeout(r, wait));
      }
    };
    void loop();
    return () => {
      stopped = true;
      if (url) URL.revokeObjectURL(url);
      setFrame(null);
    };
  }, [online, on, addons, facts]);

  return (
    <Card
      title="Camera"
      className="dv-camera-card"
      testId="camera-card"
      actions={
        <button className="dv-link" onClick={() => setOn(!on)}>
          {on ? 'Turn off' : 'Turn on'}
        </button>
      }
    >
      <div className="dv-camera">
        {on && frame && !failed ? (
          <img src={frame} alt="Printer camera" style={transform ? { transform } : undefined} data-testid="camera-frame" />
        ) : (
          <span className="muted">{!on ? 'Camera off' : !online ? 'Not connected' : failed ? 'No picture from the camera' : 'Connecting to the camera…'}</span>
        )}
      </div>
    </Card>
  );
}

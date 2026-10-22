import { useMemo, useState } from 'react';
import { useDevice } from '../../state/device';
import { takesCommands } from '../addons';
import { purifierGcode, U1_LIGHT, u1Fans, u1LightGcode, u1Purifier } from '../addons/u1';
import { fanGcode, lightGcode, setHeaterGcode } from '../commands';
import { fans, heaters, lights, motion, sensors } from '../status';
import { Card, PercentSlider, Temperature } from './parts';

/** Bed, chamber, other sensors, fans and lights; on a U1 also the top cover's purifier. */
export function ClimateCard() {
  const [open, setOpen] = useState<string | null>(null);
  const objects = useDevice((s) => s.objects);
  const addons = useDevice((s) => s.addons);
  const run = useDevice((s) => s.run);
  const commands = takesCommands(addons);
  const isU1 = addons.some((a) => a.id === 'u1');
  const hs = useMemo(() => heaters(objects).filter((h) => h.kind !== 'nozzle'), [objects]);
  const ss = useMemo(() => sensors(objects), [objects]);
  const fs = useMemo(() => (isU1 ? u1Fans(fans(objects), motion(objects).activeExtruder) : fans(objects)), [objects, isU1]);
  const ls = useMemo(() => lights(objects), [objects]);
  const purifier = isU1 ? u1Purifier(objects) : null;

  return (
    <Card title="Bed and chamber" testId="climate-card">
      <ul className="dv-list">
        {hs.map((h) => (
          <li key={h.name}>
            <span>{h.label}</span>
            <Temperature label={h.label} temp={h.temp} target={h.target} max={h.max} onSet={(t) => void run(setHeaterGcode(h.name, t, h.max))} disabled={!commands} />
          </li>
        ))}
        {ss.map((s) => (
          <li key={s.name}>
            <span>{s.label}</span>
            <span className="dv-temp">
              <b>{s.temp.toFixed(0)}°</b>
              <span className="muted">C</span>
            </span>
          </li>
        ))}
        {ls.map((l) => (
          <li key={l.name}>
            <span>{isU1 && l.name === U1_LIGHT ? 'Chamber light' : l.label}</span>
            <label className="dv-switch">
              <input
                type="checkbox"
                role="switch"
                checked={l.on}
                aria-label={isU1 && l.name === U1_LIGHT ? 'Chamber light' : l.label}
                onChange={(e) => void run(isU1 && l.name === U1_LIGHT ? u1LightGcode(e.target.checked) : lightGcode(l.name, e.target.checked))}
              />
              <span />
            </label>
          </li>
        ))}
      </ul>
      <FanTiles
        open={open}
        setOpen={setOpen}
        items={[
          ...fs.map((f) => ({ id: f.name, label: f.label, speed: f.speed, set: f.settable && commands ? (v: number) => void run(fanGcode(f.name, v)) : null })),
          ...(purifier
            ? [
                { id: 'purifier-exhaust', label: 'Purifier exhaust', speed: purifier.exhaust ?? 0, set: (v: number) => void run(purifierGcode('exhaust', v)) },
                { id: 'purifier-inner', label: 'Purifier filter', speed: purifier.inner ?? 0, set: (v: number) => void run(purifierGcode('inner', v)) },
              ]
            : []),
        ]}
      />
    </Card>
  );
}

type FanTile = { id: string; label: string; speed: number; set: ((v: number) => void) | null };

/** Fans as small tiles with their speed; tap one that can be set to open its slider under the tiles. */
function FanTiles({ items, open, setOpen }: { items: FanTile[]; open: string | null; setOpen(id: string | null): void }) {
  if (!items.length) return null;
  const current = items.find((i) => i.id === open && i.set);
  return (
    <div className="dv-fan-tiles-wrap" data-testid="fan-tiles">
      <div className="dv-fan-tiles">
        {items.map((i) => (
          <button
            key={i.id}
            type="button"
            className={`dv-fan-tile${i.speed > 0 ? ' on' : ''}${open === i.id ? ' open' : ''}`}
            disabled={!i.set}
            aria-expanded={i.set ? open === i.id : undefined}
            onClick={() => setOpen(open === i.id ? null : i.id)}
            title={i.set ? undefined : 'The printer runs this fan by itself'}
          >
            <span>{i.label}</span>
            <b>{Math.round(i.speed * 100)}%</b>
          </button>
        ))}
      </div>
      {current?.set && (
        <div className="dv-fan-tile-slider">
          <span>{current.label}</span>
          <PercentSlider label={current.label} value={current.speed} onCommit={current.set} />
        </div>
      )}
    </div>
  );
}

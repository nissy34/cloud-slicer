import { useMemo } from 'react';
import { useDevice } from '../../state/device';
import { purifierGcode, U1_LIGHT, u1LightGcode, u1Purifier } from '../addons/u1';
import { fanGcode, lightGcode, setHeaterGcode } from '../commands';
import { fans, heaters, lights, sensors } from '../status';
import { Card, PercentSlider, Temperature } from './parts';

/** Bed, chamber, other sensors, fans and lights; on a U1 also the top cover's purifier. */
export function ClimateCard() {
  const objects = useDevice((s) => s.objects);
  const addons = useDevice((s) => s.addons);
  const run = useDevice((s) => s.run);
  const isU1 = addons.some((a) => a.id === 'u1');
  const hs = useMemo(() => heaters(objects).filter((h) => h.kind !== 'nozzle'), [objects]);
  const ss = useMemo(() => sensors(objects), [objects]);
  const fs = useMemo(() => fans(objects), [objects]);
  const ls = useMemo(() => lights(objects), [objects]);
  const purifier = isU1 ? u1Purifier(objects) : null;

  return (
    <Card title="Bed and chamber" testId="climate-card">
      <ul className="dv-list">
        {hs.map((h) => (
          <li key={h.name}>
            <span>{h.label}</span>
            <Temperature label={h.label} temp={h.temp} target={h.target} max={h.max} onSet={(t) => void run(setHeaterGcode(h.name, t, h.max))} />
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
        {fs.map((f) => (
          <li key={f.name}>
            <span>{f.label}</span>
            {f.settable ? (
              <PercentSlider label={f.label} value={f.speed} onCommit={(v) => void run(fanGcode(f.name, v))} />
            ) : (
              <span className="muted">{Math.round(f.speed * 100)}%</span>
            )}
          </li>
        ))}
        {purifier && (
          <>
            <li>
              <span>Purifier exhaust</span>
              <PercentSlider label="Purifier exhaust fan" value={purifier.exhaust ?? 0} onCommit={(v) => void run(purifierGcode('exhaust', v))} />
            </li>
            <li>
              <span>Purifier filter</span>
              <PercentSlider label="Purifier filter fan" value={purifier.inner ?? 0} onCommit={(v) => void run(purifierGcode('inner', v))} />
            </li>
          </>
        )}
      </ul>
    </Card>
  );
}

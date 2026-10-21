import { useState } from 'react';
import { useDevice } from '../../state/device';
import { excludeObjectGcode } from '../commands';
import { mapBox, svgPoints, type PlateObject } from '../objects';
import { motion } from '../status';
import { Dialog, useConfirm } from './parts';

/**
 * Skipping objects of the running print (Klipper's EXCLUDE_OBJECT), like
 * Mainsail: a top-down map of the outlines next to the list. Tapping an
 * outline or a row marks both.
 */
export function SkipObjectsDialog({ objects, onClose }: { objects: PlateObject[]; onClose(): void }) {
  const klipper = useDevice((s) => s.objects);
  const call = useDevice((s) => s.call);
  const [picked, setPicked] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const m = motion(klipper);
  const box = mapBox(objects, m.axisMin, m.axisMax);
  const left = objects.filter((o) => !o.skipped).length;

  const skip = (o: PlateObject) =>
    confirm({
      title: `Skip ${o.label}?`,
      text: "The printer stops printing this object for the rest of the print. It can't be printed again in this print.",
      action: `Skip ${o.label}`,
      keep: 'Cancel',
      danger: true,
      run: () => void call(`Skipping ${o.label}`, (s) => s.gcode(excludeObjectGcode(o.name))),
    });

  // Lines and markers keep their size whatever the printer's bed size.
  const unit = Math.max(box.w, box.h) / 220;
  return (
    <Dialog title="Skip objects" onClose={onClose} wide className="dv-skip">
      <div className="dv-skip-body" data-testid="skip-objects">
        <svg
          className="dv-skip-map"
          viewBox={`0 0 ${box.w} ${box.h}`}
          role="img"
          aria-label="The plate seen from above, with each object's outline"
          style={{ ['--u' as string]: unit }}
        >
          <rect className="dv-skip-bed" x={0} y={0} width={box.w} height={box.h} rx={4 * unit} />
          {objects.map((o) => {
            const cls = `dv-skip-shape${o.skipped ? ' skipped' : ''}${o.current ? ' current' : ''}${picked === o.name ? ' picked' : ''}`;
            const pick = () => setPicked(o.name);
            return o.polygon.length >= 3 ? (
              <polygon key={o.name} className={cls} points={svgPoints(o.polygon, box)} onClick={pick}>
                <title>{o.label}</title>
              </polygon>
            ) : o.center ? (
              <circle key={o.name} className={cls} cx={o.center[0] - box.x} cy={box.y + box.h - o.center[1]} r={6 * unit} onClick={pick}>
                <title>{o.label}</title>
              </circle>
            ) : null;
          })}
        </svg>
        <div className="dv-skip-side">
          <ul className="dv-skip-list">
            {objects.map((o) => (
              <li
                key={o.name}
                className={`${o.skipped ? 'skipped' : ''}${picked === o.name ? ' picked' : ''}`}
                data-testid="skip-object"
                onClick={() => setPicked(o.name)}
              >
                <span className="dv-skip-name">{o.label}</span>
                {o.current && !o.skipped && <span className="dv-skip-now">Printing now</span>}
                {o.skipped ? (
                  <span className="muted">Skipped</span>
                ) : (
                  <button
                    className="secondary small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPicked(o.name);
                      skip(o);
                    }}
                  >
                    Skip
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="muted dv-skip-count">
            {left} of {objects.length} object{objects.length === 1 ? '' : 's'} still printing.
          </p>
        </div>
      </div>
      {dialog}
    </Dialog>
  );
}

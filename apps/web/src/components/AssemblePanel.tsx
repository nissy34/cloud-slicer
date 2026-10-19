import { useEffect, useState } from 'react';
import { describeFeature, sameFeature, type MeasureFeature, type Vec3 } from '../lib/measure';
import { useSlicer } from '../state/store';

const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
const click = touch ? 'Tap' : 'Click';
const round = (x: number, by = 1000) => Math.round(x * by) / by;
const pointOf = (f: MeasureFeature): Vec3 | null => (f.type === 'point' ? f.point : f.type === 'circle' ? f.centre : null);

/**
 * Desktop's Assemble tool: pick two faces (or two points) and the second one's
 * part, or object, moves onto the first: made parallel, centred, flipped, set a
 * distance apart or turned about the face. Objects stay on the bed, so to
 * stack them they are joined into one object first, like desktop advises.
 */
export function AssemblePanel() {
  const { hover, picks, result } = useSlicer((s) => s.measure);
  const mode = useSlicer((s) => s.assembleMode);
  const { setTool, measureReset, setAssembleMode, assemble } = useSlicer.getState();
  const [working, setWorking] = useState(false);
  const run = async (request: Parameters<typeof assemble>[0]) => {
    setWorking(true);
    await assemble(request);
    setWorking(false);
  };
  // What the next click would pick.
  const hovering = picks.length < 2 && hover && !picks.some((p) => sameFeature(p, hover)) ? hover : null;
  const what = mode === 'faces' ? 'face' : 'point or circle centre';
  const a = result?.assembly;
  const ready = picks.length === 2 && !!result;

  return (
    <section className="tool-panel measure-panel assemble-panel" aria-label="Assemble">
      <div className="tool-panel-head">
        <strong>Assemble</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          Done
        </button>
      </div>
      <div className="segmented" role="radiogroup" aria-label="Pick">
        {(['faces', 'points'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => mode !== m && setAssembleMode(m)}>
            {m === 'faces' ? 'Face and face' : 'Point and point'}
          </button>
        ))}
      </div>
      <p className="muted hint">
        {picks.length === 0
          ? `${click} a ${what} on the part that stays put.`
          : picks.length === 1
            ? `Now ${click.toLowerCase()} a ${what} on the part to move onto it.`
            : `${click} another ${what} to start again.`}
      </p>
      {picks.map((f, i) => (
        <dl className={`measure-figures pick-${i + 1}`} key={`${i}-${f.id}`} aria-label={`Feature ${i + 1}`}>
          <dt className="measure-title">
            {i + 1}. {describeFeature(f).name} {i === 0 ? '(stays)' : '(moves)'}
          </dt>
        </dl>
      ))}
      {hovering && (
        <dl className="measure-figures pick-0" aria-label="Feature under the pointer">
          <dt className="measure-title">{describeFeature(hovering).name}</dt>
        </dl>
      )}
      {ready && a && !a.sameObject && (
        <div className="assemble-join">
          <p className="hint warn">
            These are two objects, and objects always stay on the bed. To lift one onto the other, join them into one object first: each becomes a part.
          </p>
          <button className="secondary" disabled={working} onClick={() => void run({ op: 'join' })}>
            Join into one object
          </button>
        </div>
      )}
      {ready && a?.samePart && <p className="hint warn">Both are on the same part: pick the second one on another part.</p>}
      {ready && a && !a.samePart && mode === 'faces' && <FaceActions key={`${picks[0].id}-${picks[1].id}`} working={working} run={run} />}
      {ready && a && !a.samePart && mode === 'points' && <PointActions first={picks[0]} second={picks[1]} working={working} run={run} />}
      {working && <p className="muted hint">Moving…</p>}
      {picks.length > 0 && (
        <div className="tool-row">
          <button className="secondary" onClick={measureReset}>
            Start over
          </button>
        </div>
      )}
    </section>
  );
}

type Run = (request: Parameters<ReturnType<typeof useSlicer.getState>['assemble']>[0]) => Promise<void>;

function FaceActions({ working, run }: { working: boolean; run: Run }) {
  const a = useSlicer((s) => s.measure.result?.assembly);
  const gap = a?.parallelDistance;
  const [distance, setDistance] = useState(gap !== undefined ? round(gap) : 0);
  const [degrees, setDegrees] = useState(90);
  useEffect(() => {
    if (gap !== undefined) setDistance(round(gap));
  }, [gap]);
  if (!a) return null;
  const setGap = () => Number.isFinite(distance) && void run({ op: 'distance', value: distance });
  const turn = () => Number.isFinite(degrees) && degrees && void run({ op: 'rotate', degrees });
  return (
    <>
      <div className="tool-row">
        <button className="primary" disabled={working || !a.centre} title="Face 2 onto face 1, middle on middle" onClick={() => void run({ op: 'centre' })}>
          Center coincidence
        </button>
        <button className="secondary" disabled={working || !a.parallel} title="Turn face 2 to face face 1" onClick={() => void run({ op: 'parallel' })}>
          Parallel
        </button>
      </div>
      {gap !== undefined && (
        <>
          <div className="tool-row">
            <button className="secondary" disabled={working} title="Turn the part over so face 2 points the other way" onClick={() => void run({ op: 'flip' })}>
              Flip by face 2
            </button>
          </div>
          <label className="transform-row text-row" title="How far face 2 is from face 1">
            <span>Parallel distance</span>
            <input
              type="number"
              aria-label="Parallel distance"
              inputMode="decimal"
              step={0.1}
              value={distance}
              onChange={(e) => setDistance(Number(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && setGap()}
            />
            <span className="unit">mm</span>
          </label>
          {a.aroundCentre && (
            <label className="transform-row text-row" title="Turn the part about the middle of face 2">
              <span>Rotate around center</span>
              <input
                type="number"
                aria-label="Rotate around center"
                inputMode="decimal"
                step={15}
                value={degrees}
                onChange={(e) => setDegrees(Number(e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && turn()}
              />
              <span className="unit">°</span>
            </label>
          )}
          <div className="tool-row">
            <button className="secondary" disabled={working || !Number.isFinite(distance) || round(gap) === distance} onClick={setGap}>
              Set distance
            </button>
            {a.aroundCentre && (
              <button className="secondary" disabled={working || !Number.isFinite(degrees) || !degrees} onClick={turn}>
                Turn
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Point and point: where point 2 sits from point 1 along X, Y and Z, editable like desktop. */
function PointActions({ first, second, working, run }: { first: MeasureFeature; second: MeasureFeature; working: boolean; run: Run }) {
  const p1 = pointOf(first);
  const p2 = pointOf(second);
  const now = p1 && p2 ? (p2.map((v, i) => round(v - p1[i])) as Vec3) : null;
  const [target, setTarget] = useState<Vec3>(now ?? [0, 0, 0]);
  // Moved (or undone): show where point 2 is now.
  const at = now?.join();
  useEffect(() => {
    if (at) setTarget(at.split(',').map(Number) as Vec3);
  }, [at]);
  if (!p1 || !p2 || !now) return <p className="hint warn">Pick two points or circle centres.</p>;
  const moveTo = (to: Vec3) => run({ op: 'move', by: to.map((v, i) => v - now[i]) as Vec3 });
  return (
    <>
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <label className="transform-row text-row" key={axis} title={`Point 2 from point 1 along ${axis}`}>
          <span>{axis}</span>
          <input
            type="number"
            aria-label={`Point 2 from point 1 along ${axis}`}
            inputMode="decimal"
            step={0.1}
            value={target[i]}
            onChange={(e) => setTarget((t) => t.map((v, k) => (k === i ? Number(e.target.value) : v)) as Vec3)}
          />
          <span className="unit">mm</span>
        </label>
      ))}
      <div className="tool-row">
        <button className="primary" disabled={working} onClick={() => void moveTo([0, 0, 0])}>
          Move point 2 onto point 1
        </button>
        <button className="secondary" disabled={working || target.every((v, i) => v === now[i]) || !target.every(Number.isFinite)} onClick={() => void moveTo(target)}>
          Apply
        </button>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeFeature, sameFeature, type MeasureFeature, type Vec3 } from '../lib/measure';
import { useSlicer } from '../state/store';
import { PickReset } from './PickReset';

const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
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
  const pair = useSlicer((s) => s.group.length === 2);
  const { setTool, measureReset, setAssembleMode, assemble } = useSlicer.getState();
  const [working, setWorking] = useState(false);
  const { t } = useTranslation();
  const run = async (request: Parameters<typeof assemble>[0]) => {
    setWorking(true);
    await assemble(request);
    setWorking(false);
  };
  // What the next click would pick.
  const hovering = picks.length < 2 && hover && !picks.some((p) => sameFeature(p, hover)) ? hover : null;
  const what = mode === 'faces' ? t('assembleTool.face') : t('assembleTool.point');
  const a = result?.assembly;
  const ready = picks.length === 2 && !!result;

  return (
    <section className="tool-panel measure-panel assemble-panel" aria-label={t('assembleTool.title')}>
      <div className="tool-panel-head">
        <strong>{t('assembleTool.title')}</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          {t('assembleTool.done')}
        </button>
      </div>
      <div className="chooser" role="radiogroup" aria-label={t('assembleTool.pick')}>
        {(['faces', 'points'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => mode !== m && setAssembleMode(m)}>
            {m === 'faces' ? t('assembleTool.faces') : t('assembleTool.points')}
          </button>
        ))}
      </div>
      <p className="muted hint">
        {picks.length === 0
          ? touch
            ? t('assembleTool.firstTouch', { what })
            : t('assembleTool.first', { what })
          : picks.length === 1
            ? touch
              ? t('assembleTool.secondTouch', { what })
              : t('assembleTool.second', { what })
            : touch
              ? t('assembleTool.againTouch', { what })
              : t('assembleTool.again', { what })}
        {pair && ` ${t('assembleTool.pairOnly')}`}
      </p>
      {picks.map((f, i) => (
        <dl className={`measure-figures pick-${i + 1}`} key={`${i}-${f.id}`} aria-label={t('assembleTool.feature', { n: i + 1 })}>
          <div className="measure-title-row">
            <dt className="measure-title">
              {i + 1}. {describeFeature(f).name} {i === 0 ? t('assembleTool.stays') : t('assembleTool.moves')}
            </dt>
            <dd>
              <PickReset index={i} />
            </dd>
          </div>
        </dl>
      ))}
      {hovering && (
        <dl className="measure-figures pick-0" aria-label={t('assembleTool.featureHover')}>
          <dt className="measure-title">{describeFeature(hovering).name}</dt>
        </dl>
      )}
      {ready && a && !a.sameObject && (
        <div className="assemble-join">
          <p className="hint warn">
            {t('assembleTool.twoObjects')}
          </p>
          <button className="secondary" disabled={working} onClick={() => void run({ op: 'join' })}>
            {t('assembleTool.join')}
          </button>
        </div>
      )}
      {ready && a?.samePart && <p className="hint warn">{t('assembleTool.samePart')}</p>}
      {ready && a && !a.samePart && mode === 'faces' && <FaceActions key={`${picks[0].id}-${picks[1].id}`} working={working} run={run} />}
      {ready && a && !a.samePart && mode === 'points' && <PointActions first={picks[0]} second={picks[1]} working={working} run={run} />}
      {working && <p className="muted hint">{t('assembleTool.moving')}</p>}
      {picks.length > 0 && (
        <div className="tool-row">
          <button className="secondary" onClick={measureReset}>
            {t('assembleTool.startOver')}
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
  const { t } = useTranslation();
  useEffect(() => {
    if (gap !== undefined) setDistance(round(gap));
  }, [gap]);
  if (!a) return null;
  const setGap = () => Number.isFinite(distance) && void run({ op: 'distance', value: distance });
  const turn = () => Number.isFinite(degrees) && degrees && void run({ op: 'rotate', degrees });
  return (
    <>
      <div className="tool-row">
        <button className="primary" disabled={working || !a.centre} title={t('assembleTool.centreTip')} onClick={() => void run({ op: 'centre' })}>
          {t('assembleTool.centre')}
        </button>
        <button className="secondary" disabled={working || !a.parallel} title={t('assembleTool.parallelTip')} onClick={() => void run({ op: 'parallel' })}>
          {t('assembleTool.parallel')}
        </button>
      </div>
      {gap !== undefined && (
        <>
          <div className="tool-row">
            <button className="secondary" disabled={working} title={t('assembleTool.flipTip')} onClick={() => void run({ op: 'flip' })}>
              {t('assembleTool.flip')}
            </button>
          </div>
          <label className="transform-row text-row" title={t('assembleTool.distanceTip')}>
            <span>{t('assembleTool.distance')}</span>
            <input
              type="number"
              aria-label={t('assembleTool.distance')}
              inputMode="decimal"
              step={0.1}
              value={distance}
              onChange={(e) => setDistance(Number(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && setGap()}
            />
            <span className="unit">mm</span>
          </label>
          {a.aroundCentre && (
            <label className="transform-row text-row" title={t('assembleTool.aroundTip')}>
              <span>{t('assembleTool.around')}</span>
              <input
                type="number"
                aria-label={t('assembleTool.around')}
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
              {t('assembleTool.setDistance')}
            </button>
            {a.aroundCentre && (
              <button className="secondary" disabled={working || !Number.isFinite(degrees) || !degrees} onClick={turn}>
                {t('assembleTool.turn')}
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
  const { t } = useTranslation();
  // Moved (or undone): show where point 2 is now.
  const at = now?.join();
  useEffect(() => {
    if (at) setTarget(at.split(',').map(Number) as Vec3);
  }, [at]);
  if (!p1 || !p2 || !now) return <p className="hint warn">{t('assembleTool.pickTwoPoints')}</p>;
  const moveTo = (to: Vec3) => run({ op: 'move', by: to.map((v, i) => v - now[i]) as Vec3 });
  return (
    <>
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <label className="transform-row text-row" key={axis} title={t('assembleTool.along', { axis })}>
          <span>{axis}</span>
          <input
            type="number"
            aria-label={t('assembleTool.along', { axis })}
            inputMode="decimal"
            step={0.1}
            value={target[i]}
            onChange={(e) => setTarget((was) => was.map((v, k) => (k === i ? Number(e.target.value) : v)) as Vec3)}
          />
          <span className="unit">mm</span>
        </label>
      ))}
      <div className="tool-row">
        <button className="primary" disabled={working} onClick={() => void moveTo([0, 0, 0])}>
          {t('assembleTool.movePoint')}
        </button>
        <button className="secondary" disabled={working || target.every((v, i) => v === now[i]) || !target.every(Number.isFinite)} onClick={() => void moveTo(target)}>
          {t('assembleTool.apply')}
        </button>
      </div>
    </>
  );
}

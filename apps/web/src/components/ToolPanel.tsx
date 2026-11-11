import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { CutPanel } from './CutPanel';
import { describeFeature, measurementRows } from '../lib/measure';
import { PickReset } from './PickReset';
import { scaledBy } from '../lib/transform';
import { groupBox } from '../lib/group';
import { AssemblePanel } from './AssemblePanel';
import { useSlicer, type Tool } from '../state/store';
import { SimplifyPanel } from './SimplifyPanel';
import { BooleanPanel } from './BooleanPanel';
import { SvgPanel } from './SvgPanel';
import { TextPanel } from './TextPanel';
import { BrimPanel } from './BrimEars';
import { LayersPanel } from './LayersPanel';

const round = (n: number) => Math.round(n * 100) / 100;

const AXES = ['X', 'Y', 'Z'] as const;

/** Three number boxes side by side, each captioned with its axis and unit, like desktop's gizmo fields. */
function AxisFields({ label, unit, values, onSet, only }: { label: string; unit: string; values: number[]; onSet(axis: number, v: number): void; only?: number }) {
  return (
    <div className="num-fields axis-fields" role="group" aria-label={`${label} (${unit})`}>
      {values.slice(0, only ?? 3).map((v, axis) => (
        <label className="num-field" key={`${axis}-${round(v)}`}>
          <span>
            {label} {AXES[axis]} <span className="unit">({unit})</span>
          </span>
          <input
            aria-label={`${label} ${AXES[axis]}`}
            data-value={round(v)}
            inputMode="decimal"
            defaultValue={round(v)}
            onBlur={(e) => {
              const n = Number(e.target.value.replace(',', '.'));
              if (e.target.value.trim() !== '' && Number.isFinite(n) && round(n) !== round(v)) onSet(axis, n);
              else e.target.value = String(round(v));
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
      ))}
    </div>
  );
}

/** A transform, as the fields show it: an object's copy or a part inside its object. */
interface Placement {
  offset: number[];
  rotation: number[];
  scale: number[];
  meshSize: number[];
}

/** Exact values for the open move/rotate/scale tool, like the fields in desktop's tool panels. */
function TransformFields({ tool, object, instance, volume }: { tool: 'move' | 'rotate' | 'scale'; object: number; instance: number; volume?: number }) {
  const obj = useSlicer((s) => s.project?.objects[object]);
  const uniform = useSlicer((s) => s.uniformScale);
  const { transformInstance, transformVolume, mirror, setUniformScale } = useSlicer.getState();
  const { t } = useTranslation();
  const inst = obj?.instances[instance];
  const vol = volume !== undefined ? obj?.volumes[volume] : undefined;
  const at: Placement | undefined = vol ?? (inst && obj ? { ...inst, meshSize: obj.meshSize } : undefined);
  if (!at) return null;
  const apply = (changes: { offset?: number[]; rotation?: number[]; scale?: number[] }) =>
    vol ? void transformVolume(object, volume!, changes) : void transformInstance(object, instance, changes as never);
  const replace = (list: number[], axis: number, v: number) => list.map((x, k) => (k === axis ? v : x));
  const size = at.meshSize.map((m, k) => m * Math.abs(at.scale[k]));

  if (tool === 'move')
    return (
      <AxisFields
        label={t('toolPanel.position')}
        unit="mm"
        values={at.offset}
        onSet={(axis, v) => apply({ offset: replace(at.offset, axis, v) })}
      />
    );
  if (tool === 'rotate') return <AxisFields label={t('toolPanel.rotation')} unit="°" values={at.rotation} onSet={(axis, v) => apply({ rotation: replace(at.rotation, axis, v) })} />;
  const setScale = (axis: number, factor: number) => {
    if (!(factor > 0)) return;
    // A mirrored axis keeps its flip.
    const signed = at.scale.map((v) => Math.abs(v));
    const next = scaledBy(signed, axis, factor, uniform).map((v, k) => v * Math.sign(at.scale[k] || 1));
    apply({ scale: next });
  };
  return (
    <>
      <AxisFields label={t('toolPanel.scale')} unit="%" values={at.scale.map((v) => Math.abs(v) * 100)} onSet={(axis, v) => setScale(axis, v / 100)} />
      <AxisFields label={t('toolPanel.size')} unit="mm" values={size} onSet={(axis, v) => at.meshSize[axis] > 0 && setScale(axis, v / at.meshSize[axis])} />
      <div className="tool-row">
        <label className="switch-row" title={t('toolPanel.scaleEvenlyTip')}>
          <input className="switch" type="checkbox" checked={uniform} onChange={(e) => setUniformScale(e.target.checked)} />
          <span>{t('toolPanel.scaleEvenly')}</span>
        </label>
        {!vol && (
          <>
            <button className="secondary" title={t('toolPanel.mirrorXTip')} onClick={() => void mirror(object, instance, 0)}>
              {t('toolPanel.mirrorX')}
            </button>
            <button className="secondary" title={t('toolPanel.mirrorYTip')} onClick={() => void mirror(object, instance, 1)}>
              {t('toolPanel.mirrorY')}
            </button>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Exact values for several chosen objects: the middle of the box around them
 * (move), a turn about it (rotate) or an even scale (scale), like desktop's
 * fields with a multi-selection.
 */
function GroupFields({ tool }: { tool: 'move' | 'rotate' | 'scale' }) {
  const preview = useSlicer((s) => s.preview);
  const group = useSlicer((s) => s.group);
  const { transformGroup } = useSlicer.getState();
  const { t } = useTranslation();
  const version = useMemo(() => Math.random().toString(36), [preview]);
  if (!preview) return null;
  const box = groupBox(preview, group);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // Typed values apply once: the fields start fresh after every change.
  const fresh = version;
  const about = (inner: THREE.Matrix4) =>
    new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(inner).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)).elements.slice();
  if (tool === 'move')
    return (
      <AxisFields
        key={fresh}
        label={t('toolPanel.position')}
        unit="mm"
        only={2}
        values={[c.x, c.y]}
        onSet={(axis, v) => void transformGroup(new THREE.Matrix4().makeTranslation(axis === 0 ? v - c.x : 0, axis === 1 ? v - c.y : 0, 0).elements.slice(), t('toolPanel.move'))}
      />
    );
  if (tool === 'rotate')
    return (
      <AxisFields
        key={fresh}
        label={t('toolPanel.turnBy')}
        unit="°"
        values={[0, 0, 0]}
        onSet={(axis, v) => {
          const r = (v * Math.PI) / 180;
          void transformGroup(about(axis === 0 ? new THREE.Matrix4().makeRotationX(r) : axis === 1 ? new THREE.Matrix4().makeRotationY(r) : new THREE.Matrix4().makeRotationZ(r)), t('toolPanel.rotate'));
        }}
      />
    );
  return (
    <>
      <AxisFields
        key={fresh}
        label={t('toolPanel.scale')}
        unit="%"
        only={1}
        values={[100]}
        onSet={(_, v) => v > 0 && void transformGroup(about(new THREE.Matrix4().makeScale(v / 100, v / 100, v / 100)), t('toolPanel.scale'))}
      />
      <p className="muted hint" aria-label={t('toolPanel.groupSize')}>
        {t('toolPanel.together', { size: size.toArray().map((n) => round(n)).join(' × ') })}
      </p>
    </>
  );
}

// A touch screen: hints say tap.
const COARSE = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/** The Measure tool's figures, like desktop's Measure panel. */
function MeasurePanel() {
  const { hover, picks, result, onlyPlane } = useSlicer((s) => s.measure);
  const { setTool, measureReset, setMeasureOnlyPlane } = useSlicer.getState();
  const { t } = useTranslation();
  const shown = picks.length ? picks : hover ? [hover] : [];
  return (
    <section className="tool-panel measure-panel" aria-label={t('toolPanel.measure')}>
      <div className="tool-panel-head">
        <strong>{t('toolPanel.measure')}</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          {t('toolPanel.done')}
        </button>
      </div>
      <p className="muted hint">
        {picks.length === 0
          ? COARSE
            ? t('toolPanel.measureStartTouch')
            : t('toolPanel.measureStart')
          : picks.length === 1
            ? COARSE
              ? t('toolPanel.measureSecondTouch')
              : t('toolPanel.measureSecond')
            : COARSE
              ? t('toolPanel.measureAgainTouch')
              : t('toolPanel.measureAgain')}
        {picks.length > 0 && !COARSE && ` ${t('toolPanel.measureKeys')}`}
      </p>
      {shown.map((f, i) => {
        const { name, rows } = describeFeature(f);
        return (
          <dl className={`measure-figures pick-${picks.length ? i + 1 : 0}`} key={`${i}-${f.id}`} aria-label={picks.length ? t('toolPanel.feature', { n: i + 1 }) : t('toolPanel.featureHover')}>
            {picks.length ? (
              <div className="measure-title-row">
                <dt className="measure-title">{`${i + 1}. ${name}`}</dt>
                <dd>
                  <PickReset index={i} />
                </dd>
              </div>
            ) : (
              <dt className="measure-title">{name}</dt>
            )}
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        );
      })}
      {result && (
        <dl className="measure-figures result" aria-label={t('toolPanel.measurement')}>
          {measurementRows(result).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <label className="switch-row">
        <input className="switch" type="checkbox" checked={onlyPlane} onChange={(e) => setMeasureOnlyPlane(e.target.checked)} />
        <span>{t('toolPanel.wholeFaces')}</span>
      </label>
      {picks.length > 0 && (
        <div className="tool-row">
          <button className="secondary" onClick={measureReset}>
            {t('toolPanel.startOver')}
          </button>
        </div>
      )}
    </section>
  );
}

const HINTS: Record<Exclude<Tool, 'cut' | 'measure' | 'layers' | 'brim' | 'simplify' | 'boolean' | 'text' | 'svg' | 'assemble'>, [string, string]> = {
  move: ['toolPanel.move', 'toolPanel.moveHint'],
  rotate: ['toolPanel.rotate', 'toolPanel.rotateHint'],
  scale: ['toolPanel.scale', 'toolPanel.scaleHint'],
  flatten: ['toolPanel.flatten', 'toolPanel.flattenHint'],
};
/** Several chosen objects: what to drag and type, for 2 or more. */
const GROUP_HINTS: Record<'move' | 'rotate' | 'scale', [string, string]> = {
  move: ['toolPanel.groupMoveBoth', 'toolPanel.groupMoveAll'],
  rotate: ['toolPanel.groupRotateBoth', 'toolPanel.groupRotateAll'],
  scale: ['toolPanel.groupScaleBoth', 'toolPanel.groupScaleAll'],
};
/** A part picked inside its object. */
const VOLUME_HINTS: Record<'move' | 'rotate' | 'scale', string> = {
  move: 'toolPanel.volumeMove',
  rotate: 'toolPanel.volumeRotate',
  scale: 'toolPanel.volumeScale',
};
const SNAP_WORDS: Record<'move' | 'rotate' | 'scale', string> = {
  move: 'toolPanel.snapMove',
  rotate: 'toolPanel.snapRotate',
  scale: 'toolPanel.snapScale',
};

/** The open tool's options, floating over the 3D view like desktop's gizmo panels. */
export function ToolPanel() {
  const tool = useSlicer((s) => s.tool);
  const selected = useSlicer((s) => s.selected);
  const size = useSlicer((s) => (s.selected ? s.project?.objects[s.selected.object]?.size : undefined));
  const snap = useSlicer((s) => s.snap);
  const rotation = useSlicer((s) => (s.selected ? s.project?.objects[s.selected.object]?.instances[s.selected.instance]?.rotation : undefined));
  // A part, modifier... picked in an object of several: the gizmos move it inside the object.
  const volume = useSlicer((s) => {
    const obj = s.selected?.volume !== undefined ? s.project?.objects[s.selected.object] : undefined;
    const v = obj?.volumes[s.selected!.volume!];
    return v && (v.kind !== 'part' || obj!.volumes.filter((x) => x.kind === 'part').length > 1) ? v.name : null;
  });
  const several = useSlicer((s) => s.group.length);
  const { setTool, setSnap } = useSlicer.getState();
  const { t } = useTranslation();
  if (tool === 'measure') return <MeasurePanel />;
  if (tool === 'assemble') return <AssemblePanel />;
  if (tool === 'text') return <TextPanel />;
  if (tool === 'svg') return <SvgPanel />;
  if (several > 1 && (tool === 'move' || tool === 'rotate' || tool === 'scale')) {
    const title = t(HINTS[tool][0]);
    const [both, all] = GROUP_HINTS[tool];
    return (
      <section className="tool-panel" aria-label={title}>
        <div className="tool-panel-head">
          <strong>{title}</strong>
          <button className="ghost" onClick={() => setTool(null)}>
            {t('toolPanel.done')}
          </button>
        </div>
        <p className="muted hint">{several === 2 ? t(both) : t(all, { n: several })}</p>
        <GroupFields key={tool} tool={tool} />
        <label className="switch-row">
          <input className="switch" type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          <span>{t(SNAP_WORDS[tool])}</span>
        </label>
      </section>
    );
  }
  if (!tool || !selected) return null;
  if (tool === 'boolean') return <BooleanPanel key={selected.object} object={selected.object} />;
  if (tool === 'simplify') return <SimplifyPanel key={selected.object} object={selected.object} />;
  if (tool === 'brim') return <BrimPanel key={selected.object} object={selected.object} />;
  if (tool === 'layers') return <LayersPanel key={selected.object} object={selected.object} />;
  if (tool === 'cut')
    return (
      <section className="tool-panel" aria-label={t('toolPanel.cut')}>
        <strong>{t('toolPanel.cut')}</strong>
        <CutPanel key={`${selected.object}-${selected.instance}`} object={selected.object} instance={selected.instance} size={size ?? [10, 10, 10]} onDone={() => setTool(null)} />
      </section>
    );
  const title = t(HINTS[tool][0]);
  const objectHint = t(HINTS[tool][1]);
  const onVolume = volume !== null && tool !== 'flatten';
  const hint = onVolume ? t(VOLUME_HINTS[tool], { name: volume }) : tool === 'move' ? `${objectHint} ${t('toolPanel.sinkHint')}` : objectHint;
  return (
    <section className="tool-panel" aria-label={title}>
      <div className="tool-panel-head">
        <strong>{title}</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          {t('toolPanel.done')}
        </button>
      </div>
      <p className="muted hint">{hint}</p>
      {tool === 'flatten' ? (
        <p className="muted hint" aria-label={t('toolPanel.currentRotation')}>
          {t('toolPanel.rotationNow', { values: rotation?.map((r) => `${round(r)}°`).join(', ') ?? '' })}
        </p>
      ) : (
        <TransformFields
          key={`${selected.object}-${selected.instance}-${onVolume ? selected.volume : ''}`}
          tool={tool}
          object={selected.object}
          instance={selected.instance}
          volume={onVolume ? selected.volume : undefined}
        />
      )}
      {tool !== 'flatten' && (
        <label className="switch-row">
          <input className="switch" type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          <span>{t(SNAP_WORDS[tool])}</span>
        </label>
      )}
    </section>
  );
}

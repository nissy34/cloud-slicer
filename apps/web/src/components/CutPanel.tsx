import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { grooveFits, positionRange, wrapAngle, type ConnectorShape, type ConnectorStyle, type ConnectorType, type CutPart, type CutRotation } from '../lib/cut';
import { usePhone } from '../lib/usePhone';
import { useSlicer } from '../state/store';
import { Picker } from './Picker';
import { Slider } from './Slider';

const round = (n: number) => Math.round(n * 100) / 100;

const CUT_PARTS: { part: CutPart; label: string; word: string }[] = [
  { part: 'keep', label: 'cutTool.keep', word: 'cutTool.keepWord' },
  { part: 'place', label: 'cutTool.place', word: 'cutTool.placeWord' },
  { part: 'flip', label: 'cutTool.flip', word: 'cutTool.flipWord' },
  { part: 'drop', label: 'cutTool.drop', word: 'cutTool.dropWord' },
];
const TYPES: { value: ConnectorType; label: string }[] = [
  { value: 'plug', label: 'cutTool.plug' },
  { value: 'dowel', label: 'cutTool.dowel' },
  { value: 'snap', label: 'cutTool.snap' },
];
const SHAPES: { value: ConnectorShape; label: string }[] = [
  { value: 'circle', label: 'cutTool.circle' },
  { value: 'square', label: 'cutTool.square' },
  { value: 'hexagon', label: 'cutTool.hexagon' },
  { value: 'triangle', label: 'cutTool.triangle' },
];
const STYLES: { value: ConnectorStyle; label: string }[] = [
  { value: 'prism', label: 'cutTool.straight' },
  { value: 'frustum', label: 'cutTool.tapered' },
];

/** A number box that sets its value when it loses focus or on Enter. */
function NumberBox({ label, value, unit, onSet }: { label: string; value: number; unit: string; onSet(v: number): void }) {
  return (
    <span className="input-unit">
      <input
        key={round(value)}
        aria-label={label}
        inputMode="decimal"
        defaultValue={round(value)}
        onBlur={(e) => {
          const v = Number(e.target.value.replace(',', '.'));
          if (Number.isFinite(v) && v !== round(value)) onSet(v);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="unit">{unit}</span>
    </span>
  );
}

/** A chooser of 2 to 4 values (each label a word key). */
function Chooser<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange(v: T): void }) {
  const { t } = useTranslation();
  return (
    <div className="chooser" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {t(o.label)}
        </button>
      ))}
    </div>
  );
}

/** The Connectors tab: how they are made, and removing them. The 3D view places them. */
function ConnectorsTab() {
  const kind = useSlicer((s) => s.cutKind);
  const setKind = useSlicer((s) => s.setCutKind);
  const count = useSlicer((s) => s.cutConnectors.length);
  const picked = useSlicer((s) => s.cutPicked.length);
  const remove = useSlicer((s) => s.removeCutConnectors);
  const touch = usePhone();
  const { t } = useTranslation();
  const snap = kind.type === 'snap';

  // Del removes the chosen ones, like desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if ((e.key !== 'Delete' && e.key !== 'Backspace') || el.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      remove();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [remove]);

  return (
    <>
      <p className="muted hint">
        {touch
          ? t('cutTool.connectorsHintTouch')
          : t('cutTool.connectorsHint')}{' '}
        {picked ? t('cutTool.appliesChosen') : t('cutTool.appliesNew')}
      </p>
      <div className="cut-part">
        <span>{t('cutTool.type')}</span>
        <Chooser label={t('cutTool.connectorType')} value={kind.type} options={TYPES} onChange={(type) => setKind({ type })} />
      </div>
      {!snap && (
        <>
          <div className="cut-part">
            <span>{t('cutTool.shape')}</span>
            <Chooser label={t('cutTool.connectorShape')} value={kind.shape} options={SHAPES} onChange={(shape) => setKind({ shape })} />
          </div>
          <div className="cut-part">
            <span>{t('cutTool.sides')}</span>
            <Chooser label={t('cutTool.connectorSides')} value={kind.style} options={STYLES} onChange={(style) => setKind({ style })} />
          </div>
        </>
      )}
      <div className="transform-row cut-tilt">
        <span>{t('cutTool.size')}</span>
        <NumberBox label={t('cutTool.connectorSize')} value={kind.size} unit={t('cutTool.mmAcross')} onSet={(size) => size > 0 && setKind({ size })} />
        <NumberBox label={t('cutTool.connectorDepth')} value={kind.depth} unit={t('cutTool.mmDeep')} onSet={(depth) => depth > 0 && setKind({ depth })} />
      </div>
      <div className="transform-row cut-tilt">
        <span>{t('cutTool.gap')}</span>
        <NumberBox label={t('cutTool.gapAcross')} value={kind.sizeGap} unit={t('cutTool.mmAcross')} onSet={(sizeGap) => sizeGap >= 0 && setKind({ sizeGap })} />
        <NumberBox label={t('cutTool.gapDepth')} value={kind.depthGap} unit={t('cutTool.mmDeep')} onSet={(depthGap) => depthGap >= 0 && setKind({ depthGap })} />
      </div>
      {snap && (
        <div className="transform-row cut-tilt">
          <span>{t('cutTool.snap')}</span>
          <NumberBox label={t('cutTool.snapBulge')} value={round(kind.bulge * 100)} unit={t('cutTool.percentBulge')} onSet={(v) => v >= 5 && v <= 100 && setKind({ bulge: v / 100 })} />
          <NumberBox label={t('cutTool.snapSpace')} value={round(kind.space * 100)} unit={t('cutTool.percentSpace')} onSet={(v) => v >= 10 && v <= 50 && setKind({ space: v / 100 })} />
        </div>
      )}
      <div className="tool-row">
        <button className="quiet" disabled={!picked} onClick={() => remove()}>
          {t('cutTool.removeChosen')}
        </button>
        <button className="quiet" disabled={!count} onClick={() => remove(true)}>
          {t('cutTool.removeAll')}
        </button>
      </div>
    </>
  );
}

/** Desktop's Cut tool (C) on the selected instance: a plane to move and tilt, what to do with each half, and connectors. */
export function CutPanel({ object, instance, size, onDone }: { object: number; instance: number; size: [number, number, number]; onDone(): void }) {
  const cutObject = useSlicer((s) => s.cutObject);
  const z = useSlicer((s) => s.cutZ);
  const setZ = useSlicer((s) => s.setCutZ);
  const rotation = useSlicer((s) => s.cutRotation);
  const spot = useSlicer((s) => s.cutSpot);
  const setRotation = useSlicer((s) => s.setCutRotation);
  const resetPlane = useSlicer((s) => s.resetCutPlane);
  const tab = useSlicer((s) => s.cutTab);
  const mode = useSlicer((s) => s.cutMode);
  const setMode = useSlicer((s) => s.setCutMode);
  const groove = useSlicer((s) => s.cutGroove);
  const setGroove = useSlicer((s) => s.setCutGroove);
  const dovetail = mode === 'dovetail';
  const fits = !dovetail || grooveFits(groove);
  const setTab = useSlicer((s) => s.setCutTab);
  const connectors = useSlicer((s) => s.cutConnectors);
  const flipCutPlane = useSlicer((s) => s.flipCutPlane);
  const pieces = useSlicer((s) => s.cutPieces);
  const putBack = useSlicer((s) => s.swapCutPiece);
  const phone = usePhone();
  const { t } = useTranslation();
  const touch = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches, []);
  // Pieces moved to the other side with a right-click (a long press on a touch screen).
  const moved = pieces ? pieces.upper.flatMap((u, k) => (u !== (pieces.pieces.above[k] === 1) ? [k] : [])) : [];
  const [upper, setUpper] = useState<CutPart>('place');
  const [lower, setLower] = useState<CutPart>('keep');
  const [asParts, setAsParts] = useState(false);
  const [lo, hi] = positionRange(size, rotation);
  const inside = z > lo + 0.1 && z < hi - 0.1;
  const flat = rotation[0] === 0 && rotation[1] === 0;
  // Connectors join the halves: both are kept, as separate objects (like desktop).
  const joined = connectors.length > 0;
  const tilt = (axis: 0 | 1 | 2, v: number) => {
    const next: CutRotation = [...rotation];
    next[axis] = wrapAngle(v);
    setRotation(next, size[2] / 2);
  };
  const partRow = (title: string, value: CutPart, set: (p: CutPart) => void, other: CutPart) => (
    <div className="cut-part">
      <span>{title}</span>
      <Chooser label={title} value={value} options={CUT_PARTS.map(({ part, label }) => ({ value: part, label, disabled: part === 'drop' && (joined || other === 'drop') }))} onChange={set} />
    </div>
  );
  const word = (p: CutPart) => t(CUT_PARTS.find((c) => c.part === p)!.word);
  const both = CUT_PARTS.flatMap((u) => CUT_PARTS.filter((l) => !((u.part === 'drop' || joined) && l.part === 'drop') && !(joined && u.part === 'drop')).map((l) => `${u.part}/${l.part}`));
  const shown = (p: CutPart) => (joined && p === 'drop' ? 'keep' : p);
  return (
    <div className="cut-panel">
      <div className="line-tabs" role="tablist" aria-label={t('cutTool.cut')}>
        <button role="tab" aria-selected={tab === 'plane'} className={tab === 'plane' ? 'active' : undefined} onClick={() => setTab('plane')}>
          {t('cutTool.plane')}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'connectors'}
          className={tab === 'connectors' ? 'active' : undefined}
          disabled={dovetail}
          title={dovetail ? t('cutTool.dovetailNoConnectors') : undefined}
          onClick={() => setTab('connectors')}
        >
          {joined ? t('cutTool.connectorsCount', { count: connectors.length }) : t('cutTool.connectors')}
        </button>
      </div>
      {tab === 'connectors' ? (
        <ConnectorsTab />
      ) : (
        <>
          <div className="cut-part">
            <span>{t('cutTool.cut')}</span>
            <Chooser
              label={t('cutTool.cutShape')}
              value={mode}
              options={[
                { value: 'plane', label: 'cutTool.flat' },
                { value: 'dovetail', label: 'cutTool.dovetail', disabled: joined },
              ]}
              onChange={setMode}
            />
          </div>
          <p className="muted hint">
            {dovetail
              ? touch
                ? t('cutTool.dovetailHintTouch')
                : t('cutTool.dovetailHint')
              : touch
                ? t('cutTool.planeHintTouch')
                : t('cutTool.planeHint')}{' '}
            {t('cutTool.colours')}
          </p>
          <label className="transform-row cut-at">
            <span>{t('cutTool.cutAt')}</span>
            <Slider aria-label={t('cutTool.cutPosition')} min={round(lo + 0.2)} max={round(hi - 0.2)} step={0.1} value={z} onChange={(e) => setZ(Number(e.target.value))} />
            <NumberBox label={t('cutTool.cutPositionMm')} value={z} unit="mm" onSet={(v) => setZ(v)} />
          </label>
          <div className="transform-row cut-tilt" role="group" aria-label={t('cutTool.tilt')}>
            <span>{t('cutTool.tilt')}</span>
            <NumberBox label={t('cutTool.tiltX')} value={rotation[0]} unit="° X" onSet={(v) => tilt(0, v)} />
            <NumberBox label={t('cutTool.tiltY')} value={rotation[1]} unit="° Y" onSet={(v) => tilt(1, v)} />
          </div>
          {dovetail && (
            <>
              <div className="transform-row cut-tilt" role="group" aria-label={t('cutTool.dovetail')}>
                <span>{t('cutTool.tongue')}</span>
                <NumberBox label={t('cutTool.dovetailDepth')} value={groove.depth} unit={t('cutTool.mmDeep')} onSet={(depth) => depth > 0 && setGroove({ depth })} />
                <NumberBox label={t('cutTool.dovetailWidth')} value={groove.width} unit={t('cutTool.mmWide')} onSet={(width) => width > 0 && setGroove({ width })} />
              </div>
              <div className="transform-row cut-tilt">
                <span>{t('cutTool.angles')}</span>
                <NumberBox label={t('cutTool.flapAngle')} value={groove.flapAngle} unit={t('cutTool.degSides')} onSet={(v) => setGroove({ flapAngle: Math.min(Math.max(v, 30), 120) })} />
                <NumberBox label={t('cutTool.grooveAngle')} value={groove.angle} unit={t('cutTool.degTaper')} onSet={(v) => setGroove({ angle: Math.min(Math.max(v, 0), 15) })} />
              </div>
              <div className="transform-row cut-tilt">
                <span>{t('cutTool.gap')}</span>
                <NumberBox label={t('cutTool.dovetailGapDepth')} value={groove.depthTolerance} unit={t('cutTool.mmDeep')} onSet={(v) => v >= 0 && setGroove({ depthTolerance: v })} />
                <NumberBox label={t('cutTool.dovetailGapAcross')} value={groove.widthTolerance} unit={t('cutTool.mmAcross')} onSet={(v) => v >= 0 && setGroove({ widthTolerance: v })} />
              </div>
              <div className="transform-row cut-tilt">
                <span>{t('cutTool.turn')}</span>
                <NumberBox label={t('cutTool.turnTongue')} value={rotation[2]} unit="°" onSet={(v) => tilt(2, v)} />
              </div>
              {!fits && <p className="muted hint">{t('cutTool.sidesCross')}</p>}
            </>
          )}
          <div className="tool-row cut-plane-buttons">
            <button className="quiet" onClick={flipCutPlane}>
              {t('cutTool.flipPlane')}
            </button>
            <button
              className="quiet"
              disabled={flat && rotation[2] === 0 && Math.abs(z - size[2] / 2) < 0.01 && spot[0] === 0 && spot[1] === 0}
              onClick={() => {
                resetPlane(round(size[2] / 2));
              }}
            >
              {t('cutTool.reset')}
            </button>
          </div>
          {!(asParts && !joined && !dovetail) &&
            (phone ? (
              <label className="transform-row cut-parts-pick">
                <span>{t('cutTool.parts')}</span>
                <Picker
                  label={t('cutTool.partsToKeep')}
                  field
                  value={`${shown(upper)}/${shown(lower)}`}
                  options={both.map((v) => {
                    const [u, l] = v.split('/') as [CutPart, CutPart];
                    return { value: v, label: t('cutTool.upperLower', { upper: word(u), lower: word(l) }) };
                  })}
                  onChange={(v) => {
                    const [u, l] = v.split('/') as [CutPart, CutPart];
                    setUpper(u);
                    setLower(l);
                  }}
                />
              </label>
            ) : (
              <>
                {partRow(t('cutTool.upperPart'), shown(upper), setUpper, lower)}
                {partRow(t('cutTool.lowerPart'), shown(lower), setLower, upper)}
              </>
            ))}
          {!dovetail && (
            <label className="switch-row">
              <input className="switch" type="checkbox" checked={asParts && !joined} disabled={joined} onChange={(e) => setAsParts(e.target.checked)} />
              <span>{t('cutTool.asParts')}</span>
            </label>
          )}
          {joined && <p className="muted hint">{t('cutTool.joinedHint')}</p>}
          {moved.length > 0 && (
            <div className="tool-row">
              <span className="muted">
                {t('cutTool.piecesMoved', { count: moved.length })}
              </span>
              <button className="quiet" onClick={() => moved.forEach((k) => putBack(k))}>
                {t('cutTool.putBack')}
              </button>
            </div>
          )}
        </>
      )}
      <div className="transform-row actions">
        <button className="secondary" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button
          className="primary"
          disabled={!inside || !fits}
          title={!inside ? t('cutTool.planeMisses') : !fits ? t('cutTool.sidesCross') : undefined}
          onClick={() => {
            onDone();
            if (dovetail) return void cutObject(object, instance, { position: z, rotation, upper: shown(upper), lower: shown(lower), asParts: false, groove, spot });
            void cutObject(object, instance, { position: z, rotation, upper: shown(upper), lower: shown(lower), asParts: asParts && !joined, connectors, ...(moved.length && !(asParts && !joined) ? { pieces: pieces!.upper } : {}) });
          }}
        >
          {t('cutTool.cut')}
        </button>
      </div>
    </div>
  );
}

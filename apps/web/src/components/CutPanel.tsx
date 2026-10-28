import { useEffect, useMemo, useState } from 'react';
import { positionRange, wrapAngle, type ConnectorShape, type ConnectorStyle, type ConnectorType, type CutPart, type CutRotation } from '../lib/cut';
import { usePhone } from '../lib/usePhone';
import { useSlicer } from '../state/store';
import { Picker } from './Picker';
import { Slider } from './Slider';

const round = (n: number) => Math.round(n * 100) / 100;

const CUT_PARTS: { part: CutPart; label: string; word: string }[] = [
  { part: 'keep', label: 'Keep', word: 'keep' },
  { part: 'place', label: 'Flip onto cut', word: 'flip onto cut' },
  { part: 'flip', label: 'Upside down', word: 'upside down' },
  { part: 'drop', label: 'Throw away', word: 'throw away' },
];
const TYPES: { value: ConnectorType; label: string }[] = [
  { value: 'plug', label: 'Plug' },
  { value: 'dowel', label: 'Dowel' },
  { value: 'snap', label: 'Snap' },
];
const SHAPES: { value: ConnectorShape; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'hexagon', label: 'Hexagon' },
  { value: 'triangle', label: 'Triangle' },
];
const STYLES: { value: ConnectorStyle; label: string }[] = [
  { value: 'prism', label: 'Straight' },
  { value: 'frustum', label: 'Tapered' },
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

/** A chooser of 2 to 4 values. */
function Chooser<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange(v: T): void }) {
  return (
    <div className="chooser" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
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
          ? 'Tap the cut face to add a connector. Drag one to move it; tap it to choose it.'
          : 'Click the cut face to add a connector. Drag one to move it; click to choose it, Ctrl + click to choose more. Del removes the chosen ones.'}{' '}
        {picked ? 'Changes below apply to the chosen ones.' : 'Changes below apply to new ones.'}
      </p>
      <div className="cut-part">
        <span>Type</span>
        <Chooser label="Connector type" value={kind.type} options={TYPES} onChange={(type) => setKind({ type })} />
      </div>
      {!snap && (
        <>
          <div className="cut-part">
            <span>Shape</span>
            <Chooser label="Connector shape" value={kind.shape} options={SHAPES} onChange={(shape) => setKind({ shape })} />
          </div>
          <div className="cut-part">
            <span>Sides</span>
            <Chooser label="Connector sides" value={kind.style} options={STYLES} onChange={(style) => setKind({ style })} />
          </div>
        </>
      )}
      <div className="transform-row cut-tilt">
        <span>Size</span>
        <NumberBox label="Connector size" value={kind.size} unit="mm across" onSet={(size) => size > 0 && setKind({ size })} />
        <NumberBox label="Connector depth" value={kind.depth} unit="mm deep" onSet={(depth) => depth > 0 && setKind({ depth })} />
      </div>
      <div className="transform-row cut-tilt">
        <span>Gap</span>
        <NumberBox label="Gap across" value={kind.sizeGap} unit="mm across" onSet={(sizeGap) => sizeGap >= 0 && setKind({ sizeGap })} />
        <NumberBox label="Gap in depth" value={kind.depthGap} unit="mm deep" onSet={(depthGap) => depthGap >= 0 && setKind({ depthGap })} />
      </div>
      {snap && (
        <div className="transform-row cut-tilt">
          <span>Snap</span>
          <NumberBox label="Snap bulge" value={round(kind.bulge * 100)} unit="% bulge" onSet={(v) => v >= 5 && v <= 100 && setKind({ bulge: v / 100 })} />
          <NumberBox label="Snap space" value={round(kind.space * 100)} unit="% space" onSet={(v) => v >= 10 && v <= 50 && setKind({ space: v / 100 })} />
        </div>
      )}
      <div className="tool-row">
        <button className="quiet" disabled={!picked} onClick={() => remove()}>
          Remove chosen
        </button>
        <button className="quiet" disabled={!count} onClick={() => remove(true)}>
          Remove all
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
  const setRotation = useSlicer((s) => s.setCutRotation);
  const tab = useSlicer((s) => s.cutTab);
  const setTab = useSlicer((s) => s.setCutTab);
  const connectors = useSlicer((s) => s.cutConnectors);
  const flipCutPlane = useSlicer((s) => s.flipCutPlane);
  const pieces = useSlicer((s) => s.cutPieces);
  const putBack = useSlicer((s) => s.swapCutPiece);
  const phone = usePhone();
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
  const tilt = (axis: 0 | 1, v: number) => {
    const next: CutRotation = [...rotation];
    next[axis] = wrapAngle(v);
    setRotation(next);
  };
  const partRow = (title: string, value: CutPart, set: (p: CutPart) => void, other: CutPart) => (
    <div className="cut-part">
      <span>{title}</span>
      <Chooser label={title} value={value} options={CUT_PARTS.map(({ part, label }) => ({ value: part, label, disabled: part === 'drop' && (joined || other === 'drop') }))} onChange={set} />
    </div>
  );
  const word = (p: CutPart) => CUT_PARTS.find((c) => c.part === p)!.word;
  const both = CUT_PARTS.flatMap((u) => CUT_PARTS.filter((l) => !((u.part === 'drop' || joined) && l.part === 'drop') && !(joined && u.part === 'drop')).map((l) => `${u.part}/${l.part}`));
  const shown = (p: CutPart) => (joined && p === 'drop' ? 'keep' : p);
  return (
    <div className="cut-panel">
      <div className="line-tabs" role="tablist" aria-label="Cut">
        <button role="tab" aria-selected={tab === 'plane'} className={tab === 'plane' ? 'active' : undefined} onClick={() => setTab('plane')}>
          Plane
        </button>
        <button role="tab" aria-selected={tab === 'connectors'} className={tab === 'connectors' ? 'active' : undefined} onClick={() => setTab('connectors')}>
          Connectors{joined ? ` (${connectors.length})` : ''}
        </button>
      </div>
      {tab === 'connectors' ? (
        <ConnectorsTab />
      ) : (
        <>
          <p className="muted hint">
            {touch
              ? 'Drag the ball to move the plane, the red and green arrows to tilt it. Tap the plane to flip it; long-press a piece to send it to the other side.'
              : 'Drag the ball to move the plane, the red and green arrows to tilt it. Click the plane to flip it; right-click a piece to send it to the other side.'}{' '}
            Cyan is the upper part, pink the lower.
          </p>
          <label className="transform-row cut-at">
            <span>Cut at</span>
            <Slider aria-label="Cut position" min={round(lo + 0.2)} max={round(hi - 0.2)} step={0.1} value={z} onChange={(e) => setZ(Number(e.target.value))} />
            <NumberBox label="Cut position in mm" value={z} unit="mm" onSet={(v) => setZ(v)} />
          </label>
          <div className="transform-row cut-tilt" role="group" aria-label="Tilt">
            <span>Tilt</span>
            <NumberBox label="Tilt X" value={rotation[0]} unit="° X" onSet={(v) => tilt(0, v)} />
            <NumberBox label="Tilt Y" value={rotation[1]} unit="° Y" onSet={(v) => tilt(1, v)} />
          </div>
          <div className="tool-row cut-plane-buttons">
            <button className="quiet" onClick={flipCutPlane}>
              Flip plane
            </button>
            <button
              className="quiet"
              disabled={flat && rotation[2] === 0 && Math.abs(z - size[2] / 2) < 0.01}
              onClick={() => {
                setRotation([0, 0, 0]);
                setZ(round(size[2] / 2));
              }}
            >
              Reset
            </button>
          </div>
          {!(asParts && !joined) &&
            (phone ? (
              <label className="transform-row cut-parts-pick">
                <span>Parts</span>
                <Picker
                  label="Parts to keep"
                  field
                  value={`${shown(upper)}/${shown(lower)}`}
                  options={both.map((v) => {
                    const [u, l] = v.split('/') as [CutPart, CutPart];
                    return { value: v, label: `Upper: ${word(u)} · Lower: ${word(l)}` };
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
                {partRow('Upper part', shown(upper), setUpper, lower)}
                {partRow('Lower part', shown(lower), setLower, upper)}
              </>
            ))}
          <label className="switch-row">
            <input className="switch" type="checkbox" checked={asParts && !joined} disabled={joined} onChange={(e) => setAsParts(e.target.checked)} />
            <span>Keep both halves as parts of one object</span>
          </label>
          {joined && <p className="muted hint">With connectors both halves are kept, as separate objects.</p>}
          {moved.length > 0 && (
            <div className="tool-row">
              <span className="muted">
                {moved.length === 1 ? 'One piece goes' : `${moved.length} pieces go`} to the other side.
              </span>
              <button className="quiet" onClick={() => moved.forEach((k) => putBack(k))}>
                Put back
              </button>
            </div>
          )}
        </>
      )}
      <div className="transform-row actions">
        <button className="secondary" onClick={onDone}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={!inside}
          title={inside ? undefined : 'The plane misses the object: move it onto the object first.'}
          onClick={() => {
            onDone();
            void cutObject(object, instance, { position: z, rotation, upper: shown(upper), lower: shown(lower), asParts: asParts && !joined, connectors, ...(moved.length && !(asParts && !joined) ? { pieces: pieces!.upper } : {}) });
          }}
        >
          Cut
        </button>
      </div>
    </div>
  );
}

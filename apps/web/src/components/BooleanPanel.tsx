import { useState } from 'react';
import { ALL, BOOLEAN_OPS, defaultPair, pickerLabels, type BooleanOp } from '../lib/boolean';
import { KIND_LABELS } from '../lib/volumes';
import { useSlicer } from '../state/store';
import { Note } from './Note';

/**
 * Desktop's Mesh boolean tool for the selected object: union, difference or
 * intersection of two of its parts (or of one and all the others), the result
 * in place of the first.
 */
export function BooleanPanel({ object }: { object: number }) {
  const volumes = useSlicer((s) => s.project?.objects[object]?.volumes ?? []);
  const picked = useSlicer((s) => (s.selected?.object === object ? s.selected.volume : undefined));
  const { setTool, meshBoolean } = useSlicer.getState();
  const [op, setOp] = useState<BooleanOp>('union');
  const [[a, b], setPair] = useState(() => defaultPair(volumes, picked));
  const [deleteInput, setDeleteInput] = useState(false);
  const [working, setWorking] = useState(false);
  const [first, second] = pickerLabels(op);
  const enough = volumes.length >= 2;
  // b = ALL: every other part, and negative part for a difference (never modifiers or support ones).
  const all = b === ALL;
  const valid = enough && a !== b && a < volumes.length && b < volumes.length;

  const apply = async () => {
    setWorking(true);
    const ok = await meshBoolean(object, { op, a, b, deleteInput: op !== 'union' && deleteInput });
    setWorking(false);
    // The result takes the first one's place; pick something else for the next go.
    if (ok) setPair(defaultPair(useSlicer.getState().project?.objects[object]?.volumes ?? [], useSlicer.getState().selected?.volume));
  };

  const picker = (label: string, value: number, onChange: (v: number) => void, others = false) => (
    <label className="transform-row boolean-pick">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {volumes.map((v, k) => (
          <option key={k} value={k}>
            {v.name} ({KIND_LABELS[v.kind].toLowerCase()})
          </option>
        ))}
        {others && <option value={ALL}>All the other parts</option>}
      </select>
    </label>
  );

  return (
    <section className="tool-panel" aria-label="Mesh boolean">
      <div className="tool-panel-head">
        <strong>Mesh boolean</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          Done
        </button>
      </div>
      <div className="chooser" role="radiogroup" aria-label="Operation">
        {BOOLEAN_OPS.map(({ op: o, label }) => (
          <button key={o} role="radio" aria-checked={op === o} className={op === o ? 'on' : ''} onClick={() => setOp(o)}>
            {label}
          </button>
        ))}
      </div>
      {!enough ? (
        <p className="muted hint">
          This works on two parts of one object. Add a part, negative part or modifier from the object's menu (right-click it, or the ⋯ button in the
          object list), place it, then come back here.
        </p>
      ) : (
        <>
          <p className="muted hint">
            {op === 'union'
              ? all
                ? 'Joins all the parts into one.'
                : 'Joins the two into one part.'
              : op === 'difference'
                ? all
                  ? 'Cuts all the other parts out of the first.'
                  : 'Cuts the second one out of the first.'
                : all
                  ? 'Keeps only what all the parts share.'
                  : 'Keeps only where the two overlap.'}{' '}
            The result takes the first one's place, type and settings. Undo brings {all ? 'them all' : 'both'} back.
          </p>
          {picker(first, a, (v) => setPair([v, b]))}
          {picker(second, b, (v) => setPair([a, v]), true)}
          {a === b && <Note tone="warn">Pick two different parts.</Note>}
          {op !== 'union' && (
            <label className="switch-row">
              <input className="switch" type="checkbox" checked={deleteInput} onChange={(e) => setDeleteInput(e.target.checked)} />
              Delete input (also remove {all ? 'the other parts' : 'the second one'})
            </label>
          )}
        </>
      )}
      <div className="tool-row">
        <button className="primary" disabled={!valid || working} onClick={() => void apply()}>
          {working ? 'Working…' : BOOLEAN_OPS.find((x) => x.op === op)!.label}
        </button>
      </div>
    </section>
  );
}

import { useState } from 'react';
import { BOOLEAN_OPS, booleanChoices, booleanRequest, choiceLabels, defaultPair, pickerLabels, type BooleanOp } from '../lib/boolean';
import { KIND_LABELS } from '../lib/volumes';
import { useSlicer } from '../state/store';

const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/**
 * Desktop's Mesh boolean tool for the selected object: union, difference or
 * intersection of two of its parts, the result in place of the first. A part
 * of another object on the plate can be picked too: the two objects are then
 * joined into one first, as desktop's Assemble does.
 */
export function BooleanPanel({ object, instance }: { object: number; instance: number }) {
  const project = useSlicer((s) => s.project);
  const picked = useSlicer((s) => (s.selected?.object === object ? s.selected.volume : undefined));
  const { setTool, meshBoolean } = useSlicer.getState();
  const choices = booleanChoices(project, object, instance);
  const [op, setOp] = useState<BooleanOp>('union');
  const [[a, b], setPair] = useState(() => defaultPair(choices, picked));
  const [deleteInput, setDeleteInput] = useState(false);
  const [working, setWorking] = useState(false);
  const [first, second] = pickerLabels(op);
  const enough = choices.length >= 2;
  const valid = enough && a !== b && a < choices.length && b < choices.length;
  const objects = project?.objects ?? [];
  const joining = valid && choices[a].object !== choices[b].object;

  const apply = async () => {
    setWorking(true);
    const { object: o, request } = booleanRequest(op, choices[a], choices[b], deleteInput);
    const ok = await meshBoolean(o, request);
    setWorking(false);
    // The result takes the first one's place; pick something else for the next go.
    if (ok) {
      const { project: now, selected } = useSlicer.getState();
      if (selected) setPair(defaultPair(booleanChoices(now, selected.object, selected.instance), selected.volume));
    }
  };

  const labels = choiceLabels(choices, objects, (c) => KIND_LABELS[c.kind].toLowerCase());
  const picker = (label: string, value: number, onChange: (v: number) => void) => (
    <label className="transform-row boolean-pick">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {labels.map((text, k) => (
          <option key={k} value={k}>
            {text}
          </option>
        ))}
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
      <div className="segmented" role="radiogroup" aria-label="Operation">
        {BOOLEAN_OPS.map(({ op: o, label }) => (
          <button key={o} role="radio" aria-checked={op === o} className={op === o ? 'on' : ''} onClick={() => setOp(o)}>
            {label}
          </button>
        ))}
      </div>
      {!enough ? (
        <p className="muted hint">
          This combines two parts, or two objects on this plate. Add another object ({touch ? 'long-press' : 'right-click'} the empty plate), or add a
          part, negative part or modifier from the object's menu ({touch ? 'long-press the object' : 'right-click it'}, or the ⋯ button in the object
          list), place it, then come back here.
        </p>
      ) : (
        <>
          <p className="muted hint">
            {op === 'union'
              ? 'Joins the two into one part.'
              : op === 'difference'
                ? 'Cuts the second one out of the first.'
                : 'Keeps only where the two overlap.'}{' '}
            The result takes the first one's place, type and settings.{' '}
            {joining ? 'The two objects become one object. ' : ''}Undo brings both back.
          </p>
          {picker(first, a, (v) => setPair([v, b]))}
          {picker(second, b, (v) => setPair([a, v]))}
          {a === b && <p className="hint simplify-warning">Pick two different parts.</p>}
          {op !== 'union' && (
            <label className="check">
              <input type="checkbox" checked={deleteInput} onChange={(e) => setDeleteInput(e.target.checked)} />
              Delete input (also remove the second one)
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

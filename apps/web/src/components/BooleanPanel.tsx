import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BOOLEAN_OPS, defaultPair, pickerLabels, type BooleanOp } from '../lib/boolean';
import { kindLabel } from '../lib/volumes';
import { useSlicer } from '../state/store';
import { Note } from './Note';
import { Picker } from './Picker';

/**
 * Desktop's Mesh boolean tool for the selected object: union, difference or
 * intersection of two of its parts, the result in place of the first.
 */
export function BooleanPanel({ object }: { object: number }) {
  const volumes = useSlicer((s) => s.project?.objects[object]?.volumes ?? []);
  const picked = useSlicer((s) => (s.selected?.object === object ? s.selected.volume : undefined));
  const { setTool, meshBoolean } = useSlicer.getState();
  const { t } = useTranslation();
  const [op, setOp] = useState<BooleanOp>('union');
  const [[a, b], setPair] = useState(() => defaultPair(volumes, picked));
  const [deleteInput, setDeleteInput] = useState(false);
  const [working, setWorking] = useState(false);
  const [first, second] = pickerLabels(op);
  const enough = volumes.length >= 2;
  const valid = enough && a !== b && a < volumes.length && b < volumes.length;

  const apply = async () => {
    setWorking(true);
    const ok = await meshBoolean(object, { op, a, b, deleteInput: op !== 'union' && deleteInput });
    setWorking(false);
    // The result takes the first one's place; pick something else for the next go.
    if (ok) setPair(defaultPair(useSlicer.getState().project?.objects[object]?.volumes ?? [], useSlicer.getState().selected?.volume));
  };

  const picker = (label: string, value: number, onChange: (v: number) => void) => (
    <label className="transform-row boolean-pick">
      <span>{label}</span>
      <Picker
        field
        label={label}
        value={String(value)}
        options={volumes.map((v, k) => ({ value: String(k), label: t('booleanTool.partOption', { name: v.name, kind: kindLabel(v.kind).toLowerCase() }) }))}
        onChange={(v) => onChange(Number(v))}
      />
    </label>
  );

  return (
    <section className="tool-panel" aria-label={t('booleanTool.title')}>
      <div className="tool-panel-head">
        <strong>{t('booleanTool.title')}</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          {t('booleanTool.done')}
        </button>
      </div>
      <div className="chooser" role="radiogroup" aria-label={t('booleanTool.operation')}>
        {BOOLEAN_OPS.map(({ op: o, label }) => (
          <button key={o} role="radio" aria-checked={op === o} className={op === o ? 'on' : ''} onClick={() => setOp(o)}>
            {t(label)}
          </button>
        ))}
      </div>
      {!enough ? (
        <p className="muted hint">
          {t('booleanTool.needTwo')}
        </p>
      ) : (
        <>
          <p className="muted hint">
            {op === 'union'
              ? t('booleanTool.unionHint')
              : op === 'difference'
                ? t('booleanTool.differenceHint')
                : t('booleanTool.intersectionHint')}{' '}
            {t('booleanTool.resultHint')}
          </p>
          {picker(first, a, (v) => setPair([v, b]))}
          {picker(second, b, (v) => setPair([a, v]))}
          {a === b && <Note tone="warn">{t('booleanTool.pickDifferent')}</Note>}
          {op !== 'union' && (
            <label className="switch-row">
              <input className="switch" type="checkbox" checked={deleteInput} onChange={(e) => setDeleteInput(e.target.checked)} />
              {t('booleanTool.deleteInput')}
            </label>
          )}
        </>
      )}
      <div className="tool-row">
        <button className="primary" disabled={!valid || working} onClick={() => void apply()}>
          {working ? t('booleanTool.working') : t(BOOLEAN_OPS.find((x) => x.op === op)!.label)}
        </button>
      </div>
    </section>
  );
}

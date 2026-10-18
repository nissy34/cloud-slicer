import { useEffect, useState } from 'react';
import { useOption, useSlicer } from '../state/store';

/**
 * Editor for one Orca option, driven by the engine's option metadata: a
 * checkbox, a list or a text box, with Orca's unit and tooltip. A changed
 * value is marked and can be reset to the preset's.
 *
 * By default it edits the global overrides; pass `value` and `onChange` to
 * edit something else (an object's own settings), where reset means remove.
 */
export function OptionField({
  optKey,
  label,
  value: ownValue,
  onChange,
  resetLabel = 'Reset to the preset value',
}: {
  optKey: string;
  label?: string;
  value?: string;
  onChange?: (value: string | null) => void;
  resetLabel?: string;
}) {
  const def = useSlicer((s) => s.options[optKey]);
  const globalValue = useOption(optKey);
  const globalModified = useSlicer((s) => optKey in s.overrides);
  const setGlobal = useSlicer((s) => s.setOverride);
  const own = onChange !== undefined;
  const value = own ? ownValue : globalValue;
  const modified = own ? true : globalModified;
  const setOverride = own ? (_: string, v: string | null) => onChange(v) : setGlobal;
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  if (!def || value === undefined) return null;

  const title = def.tooltip || undefined;
  const text = label ?? (def.label || optKey);
  const commit = (v: string) => {
    if (v !== value) setOverride(optKey, v);
  };
  const reset = modified ? (
    <button className="icon reset" title={resetLabel} aria-label={`${resetLabel}: ${text}`} onClick={() => setOverride(optKey, null)}>
      {own ? '×' : '↺'}
    </button>
  ) : null;

  if (def.type === 'bool') {
    return (
      <div className={modified ? 'option modified' : 'option'} title={title}>
        <label className="check">
          <input type="checkbox" checked={value === '1'} onChange={(e) => commit(e.target.checked ? '1' : '0')} />
          <span>{text}</span>
        </label>
        {reset}
      </div>
    );
  }

  let editor: React.ReactNode;
  if (def.type === 'enum' && def.enumValues) {
    editor = (
      <select aria-label={text} value={value} onChange={(e) => commit(e.target.value)}>
        {!def.enumValues.includes(value) && <option value={value}>{value}</option>}
        {def.enumValues.map((v, i) => (
          <option key={v} value={v}>
            {def.enumLabels?.[i] || v}
          </option>
        ))}
      </select>
    );
  } else if (def.multiline || def.type === 'strings' || (def.type === 'string' && value.length > 60)) {
    editor = (
      <textarea
        aria-label={text}
        rows={Math.min(10, Math.max(3, draft.split('\n').length))}
        value={draft.replace(/\\n/g, '\n')}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value.replace(/\n/g, '\\n'))}
        onBlur={() => commit(draft)}
      />
    );
  } else {
    editor = (
      <span className="input-unit">
        <input
          aria-label={text}
          value={draft}
          inputMode={/float|int|percent/i.test(def.type) ? 'decimal' : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(draft);
            if (e.key === 'Escape') setDraft(value);
          }}
        />
        {def.sidetext && <span className="unit">{def.sidetext}</span>}
      </span>
    );
  }
  return (
    <div className={modified ? 'option modified' : 'option'} title={title}>
      <span className="option-label">{text}</span>
      {editor}
      {reset}
    </div>
  );
}

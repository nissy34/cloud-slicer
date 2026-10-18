import { useEffect, useState } from 'react';
import { entryType, isVectorType, processFlowModes, splitValues, valueAt, withValueAt } from '../lib/flow-variants';
import { decodeString, encodeString, slotEntryIndex, splitStrings } from '../lib/slot-values';
import { useOption, useSlicer } from '../state/store';

/**
 * Editor for one Orca option, driven by the engine's option metadata: a
 * checkbox, a list or a text box, with Orca's unit and tooltip. A changed
 * value is marked and can be reset to the preset's.
 *
 * By default it edits the global overrides; pass `value` and `onChange` to
 * edit something else (an object's own settings), where reset means remove.
 *
 * Vector options are edited one entry at a time: a flow-variant option
 * ("50,50", standard and high flow) at the flow variant the settings show,
 * like desktop; any other one as a single value while its entries agree.
 * With `slot`, a filament option edits that filament's entry (and, for a
 * flow-variant one, that filament's value for the flow variant shown).
 */
export function OptionField({
  optKey,
  label,
  value: ownValue,
  onChange,
  resetLabel = 'Reset to the preset value',
  slot,
}: {
  slot?: number;
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
  const variants = useSlicer((s) => processFlowModes(s.baseConfig).length);
  const flowVariant = useSlicer((s) => s.flowVariant);
  // The one value this field shows and how an edit of it maps back to the whole option.
  const slots = useSlicer((s) => s.selection?.filaments.length ?? 1);
  const baseConfig = useSlicer((s) => s.baseConfig);
  const vector = def !== undefined && value !== undefined && isVectorType(def.type);
  const entries = vector ? splitValues(value) : [];
  // A filament slot's own entry, when the value has one per slot.
  const slotIndex = slot !== undefined && vector ? slotEntryIndex(value, slot, slots, baseConfig, def.flow === 'filament', flowVariant) : null;
  const slotTexts = slot !== undefined && def?.type === 'strings' && value !== undefined ? splitStrings(value) : null;
  const slotText = slotTexts && slotTexts.length === slots ? slotTexts : null;
  const index = slotIndex ?? (def?.flow === 'process' ? Math.min(flowVariant, variants - 1) : 0);
  const perEntry = vector && (slotIndex !== null || def.flow === 'process' || entries.every((e) => e === entries[0]));
  const shown = slotText ? decodeString(slotText[slot!] ?? '') : perEntry ? valueAt(value, index) : value;
  const [draft, setDraft] = useState(shown ?? '');
  useEffect(() => setDraft(shown ?? ''), [shown]);
  if (!def || value === undefined || shown === undefined) return null;

  const type = perEntry ? entryType(def.type) : def.type;
  const title = def.tooltip || undefined;
  const text = label ?? (def.label || optKey);
  const commit = (v: string) => {
    if (v === shown) return;
    if (slotText) setOverride(optKey, slotText.map((t, i) => (i === slot ? encodeString(v) : t)).join(';'));
    else if (slotIndex !== null) setOverride(optKey, entries.map((e, i) => (i === slotIndex ? v : e)).join(','));
    else if (!perEntry) setOverride(optKey, v);
    else if (def.flow === 'process') setOverride(optKey, withValueAt(value, index, v, variants));
    else setOverride(optKey, entries.map(() => v).join(','));
  };
  // In a slot, only that filament's entry counts as changed, and reset puts back only it.
  const baseValue = baseConfig[optKey];
  const slotMode = !own && (slotText !== null || slotIndex !== null) && baseValue !== undefined;
  const slotChanged = slotMode && (slotText ? splitStrings(baseValue)[slot!] !== slotText[slot!] : splitValues(baseValue)[slotIndex!] !== entries[slotIndex!]);
  const changed = slotMode ? slotChanged : modified;
  const resetSlot = () => {
    const next = slotText
      ? slotText.map((t, i) => (i === slot ? splitStrings(baseValue)[i] : t)).join(';')
      : entries.map((e, i) => (i === slotIndex ? splitValues(baseValue)[i] : e)).join(',');
    setOverride(optKey, next === baseValue ? null : next);
  };
  const reset = changed ? (
    <button className="icon reset" title={resetLabel} aria-label={`${resetLabel}: ${text}`} onClick={() => (slotMode ? resetSlot() : setOverride(optKey, null))}>
      {own ? '×' : '↺'}
    </button>
  ) : null;

  if (type === 'bool') {
    return (
      <div className={changed ? 'option modified' : 'option'} title={title}>
        <label className="check">
          <input type="checkbox" checked={shown === '1'} onChange={(e) => commit(e.target.checked ? '1' : '0')} />
          <span>{text}</span>
        </label>
        {reset}
      </div>
    );
  }

  let editor: React.ReactNode;
  if (type === 'enum' && def.enumValues) {
    editor = (
      <select aria-label={text} value={shown} onChange={(e) => commit(e.target.value)}>
        {!def.enumValues.includes(shown) && <option value={shown}>{shown}</option>}
        {def.enumValues.map((v, i) => (
          <option key={v} value={v}>
            {def.enumLabels?.[i] || v}
          </option>
        ))}
      </select>
    );
  } else if (def.multiline || def.type === 'strings' || (type === 'string' && value.length > 60)) {
    editor = (
      <textarea
        aria-label={text}
        rows={Math.min(10, Math.max(3, draft.split('\n').length))}
        value={slotText ? draft : draft.replace(/\\n/g, '\n')}
        spellCheck={false}
        onChange={(e) => setDraft(slotText ? e.target.value : e.target.value.replace(/\n/g, '\\n'))}
        onBlur={() => commit(draft)}
      />
    );
  } else {
    editor = (
      <span className="input-unit">
        <input
          aria-label={text}
          value={draft}
          inputMode={/float|int|percent/i.test(type) ? 'decimal' : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(draft);
            if (e.key === 'Escape') setDraft(shown);
          }}
        />
        {def.sidetext && <span className="unit">{def.sidetext}</span>}
      </span>
    );
  }
  return (
    <div className={changed ? 'option modified' : 'option'} title={title}>
      <span className="option-label">{text}</span>
      {editor}
      {reset}
    </div>
  );
}

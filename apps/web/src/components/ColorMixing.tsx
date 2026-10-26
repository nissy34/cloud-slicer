import { useEffect, useMemo, useRef, useState } from 'react';
import { shortName } from '../lib/presets';
import {
  draftFromRow,
  MODE_LABELS,
  MODES,
  mixLabel,
  mixWarning,
  normalizePattern,
  normalizeWeights,
  patternIds,
  recipeFromDraft,
  textOn,
  type MixDraft,
  type MixRow,
} from '../lib/mixing';
import { NO_COLOURS, useSlicer } from '../state/store';
import { Dialog } from './Dialog';
import { ArrowDownUp, Delete, TriangleAlert, X } from 'lucide-react';
import { IconButton } from './IconButton';

/**
 * Desktop Snapmaker Orca's Color Mixing panel, under the filaments: each mix
 * is a virtual filament numbered after the physical ones, usable anywhere a
 * filament is (objects, parts, paint).
 */
export function ColorMixPanel() {
  const mixes = useSlicer((s) => s.mixes);
  const colours = useSlicer((s) => s.selection?.colours ?? NO_COLOURS);
  const deleteMix = useSlicer((s) => s.deleteMix);
  const [editing, setEditing] = useState<{ index: number } | 'new' | null>(null);
  // Only Snapmaker Orca has mixed filaments.
  const mixing = useSlicer((s) => s.engineInfo?.mixing ?? true);
  if (colours.length < 2 || !mixing) return null;
  const live = mixes.map((row, index) => ({ row, index })).filter(({ row }) => !row.deleted);
  return (
    <div className="mixes">
      <div className="group-head">
        <h3>Color mixing</h3>
        <button className="quiet" onClick={() => setEditing('new')} aria-label="Add mix">
          + Add mix
        </button>
      </div>
      {live.length === 0 ? (
        <p className="muted hint">Blend two or more filaments into a new colour, then use it like any filament.</p>
      ) : (
        <ol className="slots">
          {live.map(({ row, index }) => (
            <li key={row.stableId} className="slot mix-slot">
              <button
                className="swatch mix-badge"
                style={{ background: row.colour, color: textOn(row.colour) }}
                onClick={() => setEditing({ index })}
                title="Edit mix"
                aria-label={`Edit mix ${row.virtualId}`}
              >
                <span className="slot-number">{row.virtualId}</span>
              </button>
              <button className="mix-label" onClick={() => setEditing({ index })} title={mixLabel(row)}>
                {!row.compatible && (
                  <span className="danger" title="These materials can't be mixed">
                    <TriangleAlert size={14} aria-hidden />{' '}
                  </span>
                )}
                {mixLabel(row)}
              </button>
              <IconButton icon={X} label="Delete this mix" aria-label={`Delete mix ${row.virtualId}`} onClick={() => void deleteMix(index)} />
            </li>
          ))}
        </ol>
      )}
      {editing && (
        <MixDialog row={editing === 'new' ? undefined : mixes[editing.index]} index={editing === 'new' ? -1 : editing.index} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Desktop's Add Mix / Edit Mix dialog: Ratio, Cycle, Match and Gradient. */
function MixDialog({ row, index, onClose }: { row: MixRow | undefined; index: number; onClose: () => void }) {
  const colours = useSlicer((s) => s.selection?.colours ?? NO_COLOURS);
  const names = useSlicer((s) => s.selection?.filaments ?? NO_COLOURS);
  const nextId = useSlicer((s) => s.palette.length + 1);
  const { addMix, updateMix, previewMix, blendFilaments, matchColour } = useSlicer.getState();
  const [draft, setDraft] = useState<MixDraft>(() => draftFromRow(row, colours.length));
  const [look, setLook] = useState<{ colour: string; compatible: boolean } | null>(null);
  const [strip, setStrip] = useState<string[]>([]);
  const [matching, setMatching] = useState(false);
  const recipe = useMemo(() => recipeFromDraft(draft), [draft]);
  const change = (c: Partial<MixDraft>) => setDraft((d) => ({ ...d, ...c }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The engine colours the mix exactly as the panel will show it.
  useEffect(() => {
    let live = true;
    void previewMix(recipe).then((l) => live && setLook(l));
    return () => {
      live = false;
    };
  }, [recipe, previewMix]);

  // Ratio and gradient: the blend from A to B, for the slider and the strip.
  const [a, b] = draft.filaments;
  const pair = draft.mode === 'gradient' || (draft.mode === 'ratio' && draft.filaments.length === 2);
  useEffect(() => {
    if (!pair) return;
    let live = true;
    const steps = Array.from({ length: 11 }, (_, i) => [100 - i * 10, i * 10]);
    void blendFilaments([a, b], steps).then((c) => live && setStrip(c));
    return () => {
      live = false;
    };
  }, [pair, a, b, colours, blendFilaments]);

  // Match: search as the target or the minimum share changes.
  const matchTimer = useRef<number>();
  useEffect(() => {
    if (draft.mode !== 'match') return;
    window.clearTimeout(matchTimer.current);
    let live = true;
    matchTimer.current = window.setTimeout(() => {
      setMatching(true);
      void matchColour(draft.target, draft.minPercent)
        .then((m) => live && setDraft((d) => ({ ...d, match: m })))
        .finally(() => live && setMatching(false));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(matchTimer.current);
    };
  }, [draft.mode, draft.target, draft.minPercent, matchColour]);

  const filamentOption = (i: number) => (
    <option key={i} value={i + 1}>
      {i + 1} · {shortName(names[i] ?? '')}
    </option>
  );
  const pick = (slot: number, label: string) => (
    <label className="mix-filament">
      <span className="paint-swatch" style={{ background: colours[(draft.filaments[slot] ?? 1) - 1] }} />
      <select
        aria-label={label}
        value={draft.filaments[slot]}
        onChange={(e) => change({ filaments: draft.filaments.map((f, i) => (i === slot ? Number(e.target.value) : f)) })}
      >
        {colours.map((_, i) => (i + 1 === draft.filaments[slot] || !draft.filaments.includes(i + 1) ? filamentOption(i) : null))}
      </select>
    </label>
  );

  const incompatible = look !== null && !look.compatible;
  const warning = mixWarning(recipe, colours);
  const matchMissing = draft.mode === 'match' && !draft.match?.valid;
  const save = async () => {
    if (index < 0) await addMix(recipe);
    else await updateMix(index, recipe);
    onClose();
  };

  const setWeight = (k: number, value: number) => {
    // The other two share what is left, keeping their proportion.
    const w = [...draft.weights];
    const rest = w.reduce((s, v, i) => (i === k ? s : s + v), 0);
    w[k] = value;
    for (let i = 0; i < w.length; i++) if (i !== k) w[i] = rest > 0 ? ((100 - value) * draft.weights[i]) / rest : (100 - value) / (w.length - 1);
    change({ weights: normalizeWeights(w.map((v) => Math.max(0, v))) });
  };

  const sequence = patternIds(draft.pattern).slice(0, 48);
  return (
    <Dialog
      title={index < 0 ? 'Add mix' : 'Edit mix'}
      onClose={onClose}
      className="mix-dialog"
      footer={
        <>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={incompatible || matchMissing} onClick={() => void save()}>
            {index < 0 ? 'Add' : 'Save'}
          </button>
        </>
      }
    >
      <div className="segmented" role="radiogroup" aria-label="Mix mode">
        {MODES.map((m) => (
          <button key={m} role="radio" aria-checked={draft.mode === m} className={draft.mode === m ? 'on' : ''} onClick={() => change({ mode: m })}>
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      <div className="mix-preview">
        <span className="mix-preview-swatch" style={{ background: look?.colour ?? '#888', color: textOn(look?.colour ?? '#888') }}>
          {row?.virtualId || nextId}
        </span>
        <div>
          <strong>{matchMissing ? 'No mix found' : mixLabel(recipe)}</strong>
          <p className="muted small">{MODE_HINTS[draft.mode]}</p>
        </div>
      </div>

      {draft.mode === 'ratio' && (
        <div className="mix-body">
          {draft.filaments.map((_, k) => (
            <div key={k} className="mix-row">
              {pick(k, `Filament ${k + 1} of the mix`)}
              {draft.filaments.length === 3 && (
                <>
                  <input
                    type="range"
                    aria-label={`Share of filament ${draft.filaments[k]}`}
                    min={0}
                    max={100}
                    value={draft.weights[k]}
                    onChange={(e) => setWeight(k, Number(e.target.value))}
                  />
                  <span className="unit">{draft.weights[k]}%</span>
                </>
              )}
              {draft.filaments.length === 3 && (
                <IconButton icon={X} label="Remove this filament from the mix" onClick={() => change({ filaments: draft.filaments.filter((__, i) => i !== k), weights: [34, 33, 33] })} />
              )}
            </div>
          ))}
          {draft.filaments.length === 2 && (
            <label className="mix-slider">
              <span className="sr-only">Mix ratio</span>
              <input
                type="range"
                aria-label="Mix ratio"
                min={0}
                max={100}
                value={draft.percentB}
                style={{ background: gradient(strip) }}
                onChange={(e) => change({ percentB: Number(e.target.value) })}
              />
              <span className="mix-scale">
                <span>
                  F{a} {100 - draft.percentB}%
                </span>
                <span>
                  F{b} {draft.percentB}%
                </span>
              </span>
            </label>
          )}
          {draft.filaments.length === 2 && colours.length >= 3 && (
            <button
              className="quiet"
              onClick={() => {
                const free = colours.findIndex((_, i) => !draft.filaments.includes(i + 1)) + 1;
                change({ filaments: [...draft.filaments, free], weights: [34, 33, 33] });
              }}
            >
              + Add a third filament
            </button>
          )}
        </div>
      )}

      {draft.mode === 'cycle' && (
        <div className="mix-body">
          <label className="field">
            <span>Layer pattern</span>
            <input
              aria-label="Layer pattern"
              inputMode="numeric"
              value={draft.pattern}
              onChange={(e) => change({ pattern: normalizePattern(e.target.value) })}
            />
          </label>
          <div className="mix-quick">
            {colours.map((c, i) => (
              <button key={i} className="secondary" onClick={() => change({ pattern: draft.pattern + (i < 9 ? `${i + 1}` : `[${i + 1}]`) })}>
                <span className="paint-swatch" style={{ background: c }} />+{i + 1}
              </button>
            ))}
            <button className="secondary" onClick={() => change({ pattern: draft.pattern.replace(/(\[\d+\]|\d|,)$/, '') })} aria-label="Remove the last layer" title="Remove the last layer">
              <Delete size={16} aria-hidden />
            </button>
          </div>
          <div className="mix-sequence" aria-label="Layers, bottom first">
            {sequence.map((id, i) => (
              <span key={i} style={{ background: colours[id - 1] ?? '#ccc' }} title={`Layer ${i + 1}: filament ${id}`} />
            ))}
          </div>
        </div>
      )}

      {draft.mode === 'match' && (
        <div className="mix-body">
          <div className="mix-row">
            <label className="swatch" style={{ background: draft.target }} title="Target colour">
              <input type="color" aria-label="Target colour" value={draft.target.slice(0, 7)} onChange={(e) => change({ target: e.target.value.toUpperCase() })} />
            </label>
            <input
              aria-label="Target colour hex"
              className="mix-hex"
              defaultValue={draft.target}
              key={draft.target}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              onBlur={(e) => /^#?[0-9a-f]{6}$/i.test(e.target.value.trim()) && change({ target: `#${e.target.value.trim().replace('#', '').toUpperCase()}` })}
            />
            <span className="muted small">{matching ? 'Matching…' : draft.match?.valid ? closeness(draft.match.deltaE) : ''}</span>
          </div>
          <label className="transform-row">
            <span>Min share</span>
            <input type="range" aria-label="Minimum share of each filament" min={0} max={50} value={draft.minPercent} onChange={(e) => change({ minPercent: Number(e.target.value) })} />
            <span className="unit">{draft.minPercent}%</span>
          </label>
          {draft.match?.valid && (
            <div className="mix-compare">
              <span style={{ background: draft.target }}>Target</span>
              <span style={{ background: draft.match.colour, color: textOn(draft.match.colour) }}>Mix</span>
            </div>
          )}
        </div>
      )}

      {draft.mode === 'gradient' && (
        <div className="mix-body">
          <div className="mix-row">
            <span className="muted small mix-end">{draft.reversed ? 'Top' : 'Bottom'}</span>
            {pick(0, 'Gradient filament A')}
          </div>
          <div className="mix-row">
            <span className="muted small mix-end">{draft.reversed ? 'Bottom' : 'Top'}</span>
            {pick(1, 'Gradient filament B')}
          </div>
          <div className="mix-gradient" style={{ background: gradient(draft.reversed ? [...strip].reverse() : strip, 'to top') }} aria-hidden />
          <button className="quiet" onClick={() => change({ reversed: !draft.reversed })}>
            <ArrowDownUp size={16} aria-hidden /> Swap direction
          </button>
        </div>
      )}

      {incompatible && <p className="hint warn">Different filament types cannot be mixed. Please correct the settings.</p>}
      {!incompatible && warning && <p className="hint warn">{warning}</p>}
    </Dialog>
  );
}

const MODE_HINTS: Record<MixDraft['mode'], string> = {
  ratio: 'Alternates the filaments layer by layer in this ratio.',
  cycle: 'Repeats this layer sequence from the bottom up: 1122 is two layers of 1, then two of 2.',
  match: 'Finds the mix of your filaments closest to a colour.',
  gradient: 'Fades from one filament to the other up the height of the object.',
};

/** CSS gradient through colours, left to right (or `direction`). */
function gradient(colours: string[], direction = 'to right'): string | undefined {
  return colours.length ? `linear-gradient(${direction}, ${colours.join(', ')})` : undefined;
}

/** ΔE2000 in words. */
function closeness(deltaE: number): string {
  if (deltaE < 0) return '';
  const words = deltaE < 1 ? 'exact' : deltaE < 3 ? 'very close' : deltaE < 6 ? 'close' : deltaE < 12 ? 'roughly' : 'far off';
  return `${words} (ΔE ${deltaE.toFixed(1)})`;
}

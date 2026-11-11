import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filamentChoices } from '../lib/filament-choices';
import {
  applySuggestion,
  draftFromRow,
  MODE_LABELS,
  MODES,
  mixLabel,
  mixWarning,
  normalizePattern,
  patternIds,
  recipeFromDraft,
  textOn,
  type MixDraft,
  type MixRow,
} from '../lib/mixing';
import { i18n } from '../i18n';
import { NO_COLOURS, useSlicer } from '../state/store';
import { Dialog } from './Dialog';
import { ArrowDownUp, Delete, TriangleAlert, X } from 'lucide-react';
import { IconButton } from './IconButton';
import { Swatch } from './Swatch';
import { Slider } from './Slider';
import { Picker } from './Picker';
import { MixTriangle } from './MixTriangle';
import { MixSuggestions } from './MixSuggestions';

/**
 * Desktop Snapmaker Orca's Color Mixing panel, under the filaments: each mix
 * is a virtual filament numbered after the physical ones, usable anywhere a
 * filament is (objects, parts, paint).
 */
export function ColorMixPanel() {
  const { t } = useTranslation();
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
        <h3>{t('colorMixing.title')}</h3>
        <button className="quiet" onClick={() => setEditing('new')} aria-label={t('colorMixing.addMix')}>
          + {t('colorMixing.addMix')}
        </button>
      </div>
      {live.length === 0 ? (
        <p className="muted hint">{t('colorMixing.empty')}</p>
      ) : (
        <ol className="slots">
          {live.map(({ row, index }) => (
            <li key={row.stableId} className="slot mix-slot">
              <button
                className="swatch lg"
                style={{ background: row.colour, color: textOn(row.colour) }}
                onClick={() => setEditing({ index })}
                title={t('colorMixing.editMix')}
                aria-label={t('colorMixing.editMixN', { n: row.virtualId })}
              >
                {row.virtualId}
              </button>
              <button className="mix-label" onClick={() => setEditing({ index })} title={mixLabel(row)}>
                {!row.compatible && (
                  <span className="danger" title={t('colorMixing.cantMix')}>
                    <TriangleAlert size={14} aria-hidden />{' '}
                  </span>
                )}
                {mixLabel(row)}
              </button>
              <IconButton icon={X} label={t('colorMixing.deleteMix')} aria-label={t('colorMixing.deleteMixN', { n: row.virtualId })} onClick={() => void deleteMix(index)} />
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
  const { t } = useTranslation();
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

  // The project's filaments, like every filament picker: numbered square and preset name.
  // A filament already in the mix isn't offered again.
  const pick = (slot: number, label: string) => (
    <div className="mix-filament">
      <Picker
        field
        label={label}
        className="filament-field"
        value={String(draft.filaments[slot])}
        options={filamentChoices(colours, names, colours.length).filter((o) => Number(o.value) === draft.filaments[slot] || !draft.filaments.includes(Number(o.value)))}
        onChange={(v) => change({ filaments: draft.filaments.map((f, i) => (i === slot ? Number(v) : f)) })}
      />
    </div>
  );

  const incompatible = look !== null && !look.compatible;
  const warning = mixWarning(recipe, colours);
  const matchMissing = draft.mode === 'match' && !draft.match?.valid;
  const save = async () => {
    if (index < 0) await addMix(recipe);
    else await updateMix(index, recipe);
    onClose();
  };

  const sequence = patternIds(draft.pattern).slice(0, 48);
  return (
    <Dialog
      title={index < 0 ? t('colorMixing.addMix') : t('colorMixing.editMix')}
      onClose={onClose}
      className="mix-dialog"
      footer={
        <>
          <button className="secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={incompatible || matchMissing} onClick={() => void save()}>
            {index < 0 ? t('colorMixing.add') : t('colorMixing.save')}
          </button>
        </>
      }
    >
      <div className="chooser" role="radiogroup" aria-label={t('colorMixing.mode')}>
        {MODES.map((m) => (
          <button key={m} role="radio" aria-checked={draft.mode === m} className={draft.mode === m ? 'on' : ''} onClick={() => change({ mode: m })}>
            {t(MODE_LABELS[m])}
          </button>
        ))}
      </div>

      <div className="mix-preview">
        <span className="mix-preview-swatch" style={{ background: look?.colour ?? '#888', color: textOn(look?.colour ?? '#888') }}>
          {row?.virtualId || nextId}
        </span>
        <div>
          <strong>{matchMissing ? t('colorMixing.noMix') : mixLabel(recipe)}</strong>
          <p className="muted small">{t(MODE_HINTS[draft.mode])}</p>
        </div>
      </div>

      {draft.mode === 'ratio' && (
        <div className="mix-body">
          {draft.filaments.map((_, k) => (
            <div key={k} className="mix-row">
              {pick(k, t('colorMixing.filamentOfMix', { n: k + 1 }))}
              {draft.filaments.length === 3 && (
                <IconButton icon={X} label={t('colorMixing.removeFilament')} onClick={() => change({ filaments: draft.filaments.filter((__, i) => i !== k), weights: [34, 33, 33] })} />
              )}
            </div>
          ))}
          {draft.filaments.length === 3 && <MixTriangle filaments={draft.filaments} colours={colours} weights={draft.weights} onChange={(weights) => change({ weights })} />}
          {draft.filaments.length === 2 && (
            <label className="mix-slider">
              <span className="sr-only">{t('colorMixing.ratioLabel')}</span>
              <Slider
                aria-label={t('colorMixing.ratioLabel')}
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
              + {t('colorMixing.addThird')}
            </button>
          )}
        </div>
      )}

      {draft.mode === 'cycle' && (
        <div className="mix-body">
          <label className="field">
            <span>{t('colorMixing.layerPattern')}</span>
            <input
              aria-label={t('colorMixing.layerPattern')}
              inputMode="numeric"
              value={draft.pattern}
              onChange={(e) => change({ pattern: normalizePattern(e.target.value) })}
            />
          </label>
          <div className="mix-quick">
            {colours.map((c, i) => (
              <button key={i} className="secondary" onClick={() => change({ pattern: draft.pattern + (i < 9 ? `${i + 1}` : `[${i + 1}]`) })}>
                +<Swatch colour={c} number={i + 1} />
              </button>
            ))}
            <button className="secondary" onClick={() => change({ pattern: draft.pattern.replace(/(\[\d+\]|\d|,)$/, '') })} aria-label={t('colorMixing.removeLast')} title={t('colorMixing.removeLast')}>
              <Delete size={16} aria-hidden />
            </button>
          </div>
          <div className="mix-sequence" aria-label={t('colorMixing.layersBottomFirst')}>
            {sequence.map((id, i) => (
              <span key={i} style={{ background: colours[id - 1] ?? '#ccc' }} title={t('colorMixing.layerFilament', { layer: i + 1, n: id })} />
            ))}
          </div>
        </div>
      )}

      {draft.mode === 'match' && (
        <div className="mix-body">
          <div className="mix-row">
            <label className="swatch lg" style={{ background: draft.target }} title={t('colorMixing.target')}>
              <input type="color" aria-label={t('colorMixing.target')} value={draft.target.slice(0, 7)} onChange={(e) => change({ target: e.target.value.toUpperCase() })} />
            </label>
            <input
              aria-label={t('colorMixing.targetHex')}
              className="mix-hex"
              defaultValue={draft.target}
              key={draft.target}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              onBlur={(e) => /^#?[0-9a-f]{6}$/i.test(e.target.value.trim()) && change({ target: `#${e.target.value.trim().replace('#', '').toUpperCase()}` })}
            />
            <span className="muted small">{matching ? t('colorMixing.matching') : draft.match?.valid ? closeness(draft.match.deltaE) : ''}</span>
          </div>
          <label className="transform-row">
            <span>{t('colorMixing.minShare')}</span>
            <Slider aria-label={t('colorMixing.minShareLabel')} min={0} max={50} value={draft.minPercent} onChange={(e) => change({ minPercent: Number(e.target.value) })} />
            <span className="unit">{draft.minPercent}%</span>
          </label>
          {draft.match?.valid && (
            <div className="mix-compare">
              <span style={{ background: draft.target }}>{t('colorMixing.targetShort')}</span>
              <span style={{ background: draft.match.colour, color: textOn(draft.match.colour) }}>{t('colorMixing.mixShort')}</span>
            </div>
          )}
        </div>
      )}

      {draft.mode === 'gradient' && (
        <div className="mix-body">
          <div className="mix-row">
            <span className="muted small mix-end">{draft.reversed ? t('colorMixing.top') : t('colorMixing.bottom')}</span>
            {pick(0, t('colorMixing.gradientA'))}
          </div>
          <div className="mix-row">
            <span className="muted small mix-end">{draft.reversed ? t('colorMixing.bottom') : t('colorMixing.top')}</span>
            {pick(1, t('colorMixing.gradientB'))}
          </div>
          <div className="mix-gradient" style={{ background: gradient(draft.reversed ? [...strip].reverse() : strip, 'to top') }} aria-hidden />
          <button className="quiet" onClick={() => change({ reversed: !draft.reversed })}>
            <ArrowDownUp size={16} aria-hidden /> {t('colorMixing.swap')}
          </button>
        </div>
      )}

      {incompatible && <p className="hint warn">{t('colorMixing.differentTypes')}</p>}
      {!incompatible && warning && <p className="hint warn">{warning}</p>}
      <MixSuggestions draft={draft} colours={colours} onPick={(s, colour) => setDraft((d) => applySuggestion(d, s, colour))} />
    </Dialog>
  );
}

const MODE_HINTS: Record<MixDraft['mode'], string> = {
  ratio: 'colorMixing.ratioHint',
  cycle: 'colorMixing.cycleHint',
  match: 'colorMixing.matchHint',
  gradient: 'colorMixing.gradientHint',
};

/** CSS gradient through colours, left to right (or `direction`). */
function gradient(colours: string[], direction = 'to right'): string | undefined {
  return colours.length ? `linear-gradient(${direction}, ${colours.join(', ')})` : undefined;
}

/** ΔE2000 in words. */
function closeness(deltaE: number): string {
  if (deltaE < 0) return '';
  const words = deltaE < 1 ? 'colorMixing.exact' : deltaE < 3 ? 'colorMixing.veryClose' : deltaE < 6 ? 'colorMixing.close' : deltaE < 12 ? 'colorMixing.roughly' : 'colorMixing.farOff';
  return i18n.t('colorMixing.closeness', { words: i18n.t(words), deltaE: deltaE.toFixed(1) });
}

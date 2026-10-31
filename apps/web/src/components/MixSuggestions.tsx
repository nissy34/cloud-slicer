import { useEffect, useMemo, useState } from 'react';
import { minShare, mixSuggestions, recipeFromDraft, spreadWeights, type MixDraft, type MixSuggestion } from '../lib/mixing';
import { useSlicer } from '../state/store';

type Shown = MixSuggestion & { colour: string };

/**
 * Desktop's Mixing Recommendations under the Add Mix dialog: a grid of ready
 * mixes of your filaments for the current mode. Tapping one fills the dialog.
 */
export function MixSuggestions({ draft, colours, onPick }: { draft: MixDraft; colours: string[]; onPick: (s: MixSuggestion, colour: string) => void }) {
  const { blendFilaments, previewMix } = useSlicer.getState();
  const rows = draft.mode === 'ratio' ? draft.filaments.length : 2;
  const all = useMemo(() => mixSuggestions(draft.mode, rows, colours.length), [draft.mode, rows, colours.length]);
  const [shown, setShown] = useState<{ for: MixSuggestion[]; list: Shown[] }>({ for: [], list: [] });
  // Re-check when the colours or the materials change.
  const types = useSlicer((s) => s.overrides.filament_type ?? s.baseConfig.filament_type ?? '');
  const key = `${colours.join()}|${types}`;

  useEffect(() => {
    let live = true;
    if (!all.length) return;
    void (async () => {
      // Materials that can't be mixed aren't offered (desktop's is_filament_compatible: every pair).
      const ok = new Map<string, boolean>();
      const pairOk = async (a: number, b: number) => {
        const k = `${Math.min(a, b)}-${Math.max(a, b)}`;
        if (!ok.has(k)) ok.set(k, (await previewMix(recipeFromDraft({ ...base, filaments: [a, b] }))).compatible);
        return ok.get(k)!;
      };
      const usable: MixSuggestion[] = [];
      for (const s of all) {
        const [a, b, c] = s.filaments;
        if ((await pairOk(a, b)) && (c === undefined || ((await pairOk(a, c)) && (await pairOk(b, c))))) usable.push(s);
      }
      const blends = usable.length ? await blendFilaments(colours.map((_, i) => i + 1), usable.map((s) => spreadWeights(s, colours.length))) : [];
      const seen = new Set<string>();
      const out: Shown[] = [];
      usable.forEach((s, i) => {
        const colour = blends[i] ?? '#808080';
        // Match drops repeats of the same colour (build_color_match_presets).
        if (draft.mode === 'match') {
          if (seen.has(colour.toUpperCase())) return;
          seen.add(colour.toUpperCase());
        }
        out.push({ ...s, colour });
      });
      if (live) setShown({ for: all, list: out });
    })().catch(() => live && setShown({ for: all, list: [] }));
    return () => {
      live = false;
    };
    // colours are covered by key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, key, draft.mode]);

  // Only the list worked out for this mode and these filaments (never the last mode's).
  const list = shown.for === all ? shown.list : [];
  const visible = draft.mode === 'match' ? list.filter((s) => minShare(s) >= draft.minPercent) : list;
  if (!visible.length) return null;
  return (
    <section className="mix-suggestions" aria-label="Mixing recommendations">
      <h4>Mixing recommendations</h4>
      <div className="mix-suggestion-grid">
        {visible.map((s) => (
          <button
            key={`${s.filaments.join('-')}:${s.weights.join('-')}`}
            className="mix-suggestion"
            style={{ background: draft.mode === 'gradient' ? `linear-gradient(to top, ${colours[s.filaments[0] - 1]}, ${colours[s.filaments[1] - 1]})` : s.colour }}
            title={s.label}
            aria-label={`Use ${s.label}`}
            onClick={() => onPick(s, s.colour)}
          />
        ))}
      </div>
    </section>
  );
}

const base: MixDraft = {
  mode: 'ratio',
  filaments: [1, 2],
  percentB: 50,
  weights: [34, 33, 33],
  pattern: '12',
  target: '#808080',
  minPercent: 0,
  match: null,
  reversed: false,
};

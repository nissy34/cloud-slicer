import { useEffect, useState } from 'react';
import { DETAIL_LEVELS, simplifyBy, type SimplifyResult } from '../lib/simplify';
import { useSlicer } from '../state/store';

const count = (n: number) => n.toLocaleString('en-US');

/** Desktop's Simplify panel for the selected object: a detail level or a decimate ratio, then Apply. */
export function SimplifyPanel({ object }: { object: number }) {
  const project = useSlicer((s) => s.project);
  const { setTool, simplifyPreview, simplifyObject } = useSlicer.getState();
  // Desktop's defaults: Medium detail, or half the triangles.
  const [mode, setMode] = useState<'level' | 'ratio'>('level');
  const [level, setLevel] = useState(2);
  const [ratio, setRatio] = useState(50);
  const [result, setResult] = useState<SimplifyResult | null>(null);
  const [working, setWorking] = useState(false);
  const name = project?.objects[object]?.name;

  // Works out the result a moment after the choice settles, like desktop's live preview.
  useEffect(() => {
    let live = true;
    setWorking(true);
    const timer = window.setTimeout(() => {
      void simplifyPreview(object, simplifyBy(mode, level, ratio)).then((r) => {
        if (!live) return;
        setResult(r);
        setWorking(false);
      });
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [object, project, mode, level, ratio, simplifyPreview]);

  const apply = async () => {
    setWorking(true);
    await simplifyObject(object, simplifyBy(mode, level, ratio));
    setTool(null);
  };

  return (
    <section className="tool-panel" aria-label="Simplify">
      <div className="tool-panel-head">
        <strong>Simplify</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          Done
        </button>
      </div>
      <p className="muted hint">
        Fewer triangles make a big model open, slice and preview faster. Fine details can soften; Undo brings the old mesh back.
      </p>
      <div className="simplify-figures" aria-label="Triangles">
        <span>{name}</span>
        <span>
          {result ? count(result.triangles) : '…'} triangles
          {result?.after !== undefined && !working && <> → {count(result.after)}</>}
          {working && <span className="muted"> (working out…)</span>}
        </span>
      </div>
      <div className="chooser" role="radiogroup" aria-label="Simplify by">
        <button role="radio" aria-checked={mode === 'level'} className={mode === 'level' ? 'on' : ''} onClick={() => setMode('level')}>
          Detail level
        </button>
        <button role="radio" aria-checked={mode === 'ratio'} className={mode === 'ratio' ? 'on' : ''} onClick={() => setMode('ratio')}>
          Decimate ratio
        </button>
      </div>
      {mode === 'level' ? (
        <label className="transform-row">
          <span>Detail</span>
          <input type="range" aria-label="Detail level" min={0} max={4} step={1} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
          <span className="unit">{DETAIL_LEVELS[level]}</span>
        </label>
      ) : (
        <label className="transform-row" title="Share of the triangles to remove">
          <span>Remove</span>
          <input type="range" aria-label="Decimate ratio" min={0} max={99} step={1} value={ratio} onChange={(e) => setRatio(Number(e.target.value))} />
          <span className="unit">{ratio}%</span>
        </label>
      )}
      {result?.painted && <p className="hint simplify-warning">This object's painting (colours, supports, seams, fuzzy skin) will be removed, as on desktop.</p>}
      <div className="tool-row">
        <button className="primary" disabled={working || !result || result.after === undefined || result.after === result.triangles} onClick={() => void apply()}>
          Apply
        </button>
      </div>
    </section>
  );
}

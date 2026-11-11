import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DETAIL_LEVELS, simplifyBy, type SimplifyResult } from '../lib/simplify';
import { useSlicer } from '../state/store';
import { Slider } from './Slider';
import { Note } from './Note';

const count = (n: number) => n.toLocaleString('en-US');

/** Desktop's Simplify panel for the selected object: a detail level or a decimate ratio, then Apply. */
export function SimplifyPanel({ object }: { object: number }) {
  const project = useSlicer((s) => s.project);
  const { setTool, simplifyPreview, simplifyObject } = useSlicer.getState();
  const { t } = useTranslation();
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
    <section className="tool-panel" aria-label={t('simplifyTool.title')}>
      <div className="tool-panel-head">
        <strong>{t('simplifyTool.title')}</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          {t('simplifyTool.done')}
        </button>
      </div>
      <p className="muted hint">
        {t('simplifyTool.hint')}
      </p>
      <div className="simplify-figures" aria-label={t('simplifyTool.trianglesLabel')}>
        <span>{name}</span>
        <span>
          {result ? t('simplifyTool.triangles', { count: result.triangles, n: count(result.triangles) }) : t('simplifyTool.trianglesUnknown')}
          {result?.after !== undefined && !working && <> → {count(result.after)}</>}
          {working && <span className="muted"> {t('simplifyTool.workingOut')}</span>}
        </span>
      </div>
      <div className="chooser" role="radiogroup" aria-label={t('simplifyTool.by')}>
        <button role="radio" aria-checked={mode === 'level'} className={mode === 'level' ? 'on' : ''} onClick={() => setMode('level')}>
          {t('simplifyTool.detailLevel')}
        </button>
        <button role="radio" aria-checked={mode === 'ratio'} className={mode === 'ratio' ? 'on' : ''} onClick={() => setMode('ratio')}>
          {t('simplifyTool.ratio')}
        </button>
      </div>
      {mode === 'level' ? (
        <label className="transform-row">
          <span>{t('simplifyTool.detail')}</span>
          <Slider aria-label={t('simplifyTool.detailLevel')} min={0} max={4} step={1} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
          <span className="unit">{t(DETAIL_LEVELS[level])}</span>
        </label>
      ) : (
        <label className="transform-row" title={t('simplifyTool.removeTip')}>
          <span>{t('simplifyTool.remove')}</span>
          <Slider aria-label={t('simplifyTool.ratio')} min={0} max={99} step={1} value={ratio} onChange={(e) => setRatio(Number(e.target.value))} />
          <span className="unit">{ratio}%</span>
        </label>
      )}
      {result?.painted && <Note>{t('simplifyTool.paintKept')}</Note>}
      <div className="tool-row">
        <button className="primary" disabled={working || !result || result.after === undefined || result.after === result.triangles} onClick={() => void apply()}>
          {t('simplifyTool.apply')}
        </button>
      </div>
    </section>
  );
}

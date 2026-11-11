import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { DEFAULT_TEXT, clampStyle, missingLettersHint, scriptLabel, type FontChoice, type TextStyle } from '../lib/fonts';
import { kindLabel, keepsAPart } from '../lib/volumes';
import { addFontFile, availableFonts, canListComputerFonts, loadComputerFonts, nextTextStyle, rememberTextStyle, restoreFonts } from '../state/fonts';
import { useSlicer } from '../state/store';
import { ShapeActions, ShapePlacement, placementHint } from './ShapePlacement';
import { Note } from './Note';
import { Picker, type PickerAction } from './Picker';
import { FileUp, Monitor } from 'lucide-react';

const TYPES = ['part', 'negative', 'modifier'] as const;
/** The font list's groups: built-in fonts (Latin, then each other script), font files, the computer's. */
function fontGroups(fonts: FontChoice[]): [string, FontChoice[]][] {
  const scripts = [...new Set(fonts.flatMap((f) => (f.source === 'bundled' && f.script ? [f.script] : [])))];
  const groups: [string, FontChoice[]][] = [
    [i18n.t('textTool.builtIn'), fonts.filter((f) => f.source === 'bundled' && !f.script)],
    ...scripts.map((script): [string, FontChoice[]] => [i18n.t('textTool.builtInScript', { script: scriptLabel(script) }), fonts.filter((f) => f.script === script)]),
    [i18n.t('textTool.fontFiles'), fonts.filter((f) => f.source === 'file')],
    [i18n.t('textTool.onComputer'), fonts.filter((f) => f.source === 'computer')],
  ];
  return groups.filter(([, list]) => list.length);
}

/** Starts a text where desktop's Text tool would: on the picked object, else as an object of its own. */
export async function startText(object: number | null, type: (typeof TYPES)[number] = 'part') {
  const s = useSlicer.getState();
  s.setTool('text');
  await s.textVolume(object, nextTextStyle(), { type });
}

/**
 * Desktop's Text tool for the picked text: the words, font, height and depth,
 * and the finer settings, each change remade into the text where it stands.
 */
export function TextPanel() {
  const selected = useSlicer((s) => s.selected);
  const volumes = useSlicer((s) => (s.selected ? s.project?.objects[s.selected.object]?.volumes : undefined));
  const v = selected?.volume !== undefined ? volumes?.[selected.volume] : volumes?.length === 1 ? volumes[0] : undefined;
  const index = selected?.volume ?? 0;
  const { setTool } = useSlicer.getState();
  const { t } = useTranslation();
  // Closing the tool (Done, Esc, another tool) right after it added a text takes that text back.
  useEffect(() => () => void useSlicer.getState().dropUnusedText(), []);
  return (
    <section className="tool-panel text-panel" aria-label={t('textTool.title')}>
      <div className="tool-panel-head">
        <strong>{t('textTool.title')}</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          {t('textTool.done')}
        </button>
      </div>
      {v?.text && selected ? (
        <TextFields
          key={`${selected.object}-${index}`}
          object={selected.object}
          volume={index}
          start={v.text}
          kind={v.kind}
          onObject={!!volumes && volumes.length > 1}
          canChangeType={!!volumes && keepsAPart(volumes, index) && volumes.length > 1}
        />
      ) : (
        <>
          <p className="muted hint">
            {t('textTool.pickHint')}
          </p>
          <div className="tool-row">
            <button className="primary" onClick={() => void startText(selected?.object ?? null)}>
              {t('textTool.addText')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function TextFields({
  object,
  volume,
  start,
  kind,
  onObject,
  canChangeType,
}: {
  object: number;
  volume: number;
  start: TextStyle;
  kind: string;
  onObject: boolean;
  canChangeType: boolean;
}) {
  const [style, setStyle] = useState<TextStyle>({ ...DEFAULT_TEXT, ...start });
  const [fonts, setFonts] = useState(availableFonts);
  const [restoring, setRestoring] = useState(true);
  const [missing, setMissing] = useState('');
  const [working, setWorking] = useState(false);
  const [more, setMore] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // As the remake below would write it, so opening a text doesn't remake it unchanged.
  const applied = useRef(JSON.stringify(clampStyle({ ...DEFAULT_TEXT, ...start })));
  const { textVolume, volumeAction } = useSlicer.getState();
  const { t } = useTranslation();
  const missingFont = !restoring && !fonts.some((f) => f.name === style.font);

  // Font files kept in this browser, and the computer's fonts if already allowed.
  useEffect(() => {
    let live = true;
    void restoreFonts().then(() => {
      if (!live) return;
      setFonts(availableFonts());
      setRestoring(false);
    });
    return () => {
      live = false;
    };
  }, []);

  // Remakes the text a moment after the last change, like desktop's live preview.
  useEffect(() => {
    const want = clampStyle(style);
    const key = JSON.stringify(want);
    if (key === applied.current || !want.text.trim() || missingFont || restoring) return;
    const timer = window.setTimeout(async () => {
      applied.current = key;
      setWorking(true);
      const done = await textVolume(object, want, { volume });
      if (done) {
        rememberTextStyle(want);
        setMissing(done.missing);
      }
      setWorking(false);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [style, object, volume, missingFont, restoring, textVolume]);

  const set = <K extends keyof TextStyle>(key: K, value: TextStyle[K]) => setStyle((s) => ({ ...s, [key]: value }));
  const num = (key: 'size' | 'depth' | 'boldness' | 'skew' | 'charGap' | 'lineGap', label: string, unit: string, step: number, title?: string) => (
    <label className="num-field" title={title}>
      <span>
        {label}
        {unit && <span className="unit"> ({unit})</span>}
      </span>
      <input type="number" aria-label={label} inputMode="decimal" step={step} value={style[key]} onChange={(e) => set(key, Number(e.target.value))} />
    </label>
  );

  const pickFont = async (value: string) => {
    if (value === '__file') return fileInput.current?.click();
    if (value === '__computer') {
      try {
        await loadComputerFonts();
        setFonts(availableFonts());
      } catch {
        useSlicer.setState({ notice: t('textTool.noComputerFonts'), noticeWarn: true });
      }
      return;
    }
    set('font', value);
  };

  return (
    <>
      <textarea className="text-input" aria-label={t('textTool.text')} dir="auto" rows={2} value={style.text} onChange={(e) => set('text', e.target.value)} />
      {!style.text.trim() && <Note tone="warn">{t('textTool.typeText')}</Note>}
      <div className="transform-row text-row">
        <span>{t('textTool.font')}</span>
        <Picker
          field
          label={t('textTool.font')}
          value={missingFont ? null : style.font}
          placeholder={missingFont ? t('textTool.notOnDevice', { font: style.font }) : undefined}
          title={t('textTool.fontTip')}
          options={fontGroups(fonts).flatMap(([group, list]) => list.map((f) => ({ value: f.name, label: f.name, group })))}
          onChange={(name) => void pickFont(name)}
          actions={([
            { id: '__file', label: t('textTool.loadFontFile'), icon: FileUp },
            canListComputerFonts()
              ? !fonts.some((f) => f.source === 'computer') && { id: '__computer', label: t('textTool.useComputerFonts'), icon: Monitor }
              : { id: '__nocomputer', label: t('textTool.computerFontsOnly'), icon: Monitor, disabled: true },
          ] as (PickerAction | false)[]).filter((a): a is PickerAction => !!a)}
          onAction={(id) => void pickFont(id)}
        />
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".ttf,.otf,.ttc,font/ttf,font/otf"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const choice = await addFontFile(file);
          setFonts(availableFonts());
          set('font', choice.name);
        }}
      />
      {missingFont && <Note tone="warn">{t('textTool.missingFont')}</Note>}
      {missing && !missingFont && <Note tone="warn">{missingLettersHint(missing)}</Note>}
      <ShapePlacement
        object={object}
        volume={volume}
        followsSurface={style.useSurface}
        shapeKind="text"
        fields={
          <>
            {num('size', t('textTool.height'), 'mm', 0.5, t('textTool.heightTip'))}
            {num('depth', t('textTool.depth'), 'mm', 0.1, kind === 'negative' ? t('textTool.depthCutTip') : t('textTool.depthTip'))}
          </>
        }
      />
      <div className="align-row">
        <div className="chooser icons" role="radiogroup" aria-label={t('textTool.alignment')}>
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={style.align === a}
              aria-label={t(ALIGN_NAMES[a])}
              title={t(ALIGN_TIPS[a])}
              className={style.align === a ? 'on' : ''}
              onClick={() => set('align', a)}
            >
              <AlignIcon align={a} />
            </button>
          ))}
        </div>
        <div className="chooser icons" role="radiogroup" aria-label={t('textTool.verticalAlignment')}>
          {VALIGNS.map(({ side, value }) => (
            <button
              key={side}
              role="radio"
              aria-checked={style.valign === value}
              aria-label={t(VALIGN_NAMES[side])}
              title={t(VALIGN_TIPS[side])}
              className={style.valign === value ? 'on' : ''}
              onClick={() => set('valign', value)}
            >
              <VAlignIcon side={side} />
            </button>
          ))}
        </div>
      </div>
      {onObject && (
        <div className="shape-checks">
          <label className="switch-row" title={t('textTool.useSurfaceTip')}>
            <input className="switch" type="checkbox" checked={style.useSurface} onChange={(e) => set('useSurface', e.target.checked)} />
            {t('textTool.useSurface')}
          </label>
          <label className="switch-row" title={t('textTool.perLetterTip')}>
            <input className="switch" type="checkbox" checked={style.perGlyph} onChange={(e) => set('perGlyph', e.target.checked)} />
            {t('textTool.perLetter')}
          </label>
        </div>
      )}
      <ShapeActions object={object} volume={volume} />
      {canChangeType && (
        <div className="chooser" role="radiogroup" aria-label={t('textTool.textType')}>
          {TYPES.map((type) => (
            <button
              key={type}
              role="radio"
              aria-checked={kind === type}
              className={kind === type ? 'on' : ''}
              onClick={() => kind !== type && void volumeAction(object, { op: 'type', volume, type, remake: true }, t('textTool.changeType'))}
            >
              {type === 'negative' ? t('textTool.engraved') : kindLabel(type)}
            </button>
          ))}
        </div>
      )}
      <button className="ghost text-more" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? t('textTool.fewerSettings') : t('textTool.moreSettings')}
      </button>
      {more && (
        <>
          <div className="num-fields">
            {num('boldness', t('textTool.boldness'), 'mm', 0.05, t('textTool.boldnessTip'))}
            {num('skew', t('textTool.skew'), '', 0.05, t('textTool.skewTip'))}
            {num('charGap', t('textTool.letterGap'), '', 10, t('textTool.letterGapTip'))}
            {num('lineGap', t('textTool.lineGap'), '', 10, t('textTool.lineGapTip'))}
          </div>
        </>
      )}
      <p className="muted hint">{working ? t('textTool.making') : `${placementHint('text', onObject)} ${t('textTool.undoHint')}`}</p>
    </>
  );
}

const ALIGN_NAMES = { left: 'textTool.left', center: 'textTool.centre', right: 'textTool.right' } as const;
const ALIGN_TIPS = { left: 'textTool.leftTip', center: 'textTool.centreTip', right: 'textTool.rightTip' } as const;
const VALIGN_NAMES = { top: 'textTool.top', center: 'textTool.middle', bottom: 'textTool.bottom' } as const;
const VALIGN_TIPS = { top: 'textTool.topTip', center: 'textTool.middleTip', bottom: 'textTool.bottomTip' } as const;
/** Where the text goes from its point, top to bottom. Orca's own words are the other
 * way round (its "top" is the text's top on the point, so the text hangs below it). */
const VALIGNS = [
  { side: 'top', value: 'bottom' },
  { side: 'center', value: 'center' },
  { side: 'bottom', value: 'top' },
] as const;

/** Lines of text lined up left, centre or right, like a word processor's buttons. */
function AlignIcon({ align }: { align: 'left' | 'center' | 'right' }) {
  const widths = [14, 9, 14, 9];
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      {widths.map((w, i) => {
        const x = align === 'left' ? 2 : align === 'right' ? 16 - w : 9 - w / 2;
        return <line key={i} x1={x} x2={x + w} y1={3 + i * 4} y2={3 + i * 4} />;
      })}
    </svg>
  );
}

/** Two lines of text above, across or below the text's point (the dot). */
function VAlignIcon({ side }: { side: 'top' | 'center' | 'bottom' }) {
  const y = side === 'top' ? 3 : side === 'bottom' ? 11 : 7;
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <line x1="4" x2="14" y1={y} y2={y} />
      <line x1="4" x2="14" y1={y + 4} y2={y + 4} />
      <circle cx="9" cy="9" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

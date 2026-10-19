import { useEffect, useRef, useState } from 'react';
import { DEFAULT_TEXT, clampStyle, type FontChoice, type TextStyle } from '../lib/fonts';
import { KIND_LABELS, keepsAPart } from '../lib/volumes';
import { addFontFile, availableFonts, canListComputerFonts, loadComputerFonts, nextTextStyle, rememberTextStyle } from '../state/fonts';
import { useSlicer } from '../state/store';
import { ShapePlacement, placementHint } from './ShapePlacement';

const TYPES = ['part', 'negative', 'modifier'] as const;
const GROUPS: [FontChoice['source'], string][] = [
  ['bundled', 'Built in'],
  ['file', 'Font files'],
  ['computer', 'On this computer'],
];

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
  return (
    <section className="tool-panel text-panel" aria-label="Text shape">
      <div className="tool-panel-head">
        <strong>Text shape</strong>
        <button className="ghost" onClick={() => setTool(null)}>
          Done
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
            Pick a text in the object list or the 3D view to change it, or add one: on the selected object, or as an object of its own when nothing is
            selected.
          </p>
          <div className="tool-row">
            <button className="primary" onClick={() => void startText(selected?.object ?? null)}>
              Add text
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
  const [working, setWorking] = useState(false);
  const [more, setMore] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const applied = useRef(JSON.stringify(start));
  const { textVolume, volumeAction } = useSlicer.getState();
  const missingFont = !fonts.some((f) => f.name === style.font);

  // Remakes the text a moment after the last change, like desktop's live preview.
  useEffect(() => {
    const want = clampStyle(style);
    const key = JSON.stringify(want);
    if (key === applied.current || !want.text.trim() || missingFont) return;
    const timer = window.setTimeout(async () => {
      applied.current = key;
      setWorking(true);
      if (await textVolume(object, want, { volume })) rememberTextStyle(want);
      setWorking(false);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [style, object, volume, missingFont, textVolume]);

  const set = <K extends keyof TextStyle>(key: K, value: TextStyle[K]) => setStyle((s) => ({ ...s, [key]: value }));
  const num = (key: 'size' | 'depth' | 'boldness' | 'skew' | 'charGap' | 'lineGap', label: string, unit: string, step: number, title?: string) => (
    <label className="transform-row text-row" title={title}>
      <span>{label}</span>
      <input type="number" aria-label={label} inputMode="decimal" step={step} value={style[key]} onChange={(e) => set(key, Number(e.target.value))} />
      <span className="unit">{unit}</span>
    </label>
  );

  const pickFont = async (value: string) => {
    if (value === '__file') return fileInput.current?.click();
    if (value === '__computer') {
      try {
        await loadComputerFonts();
        setFonts(availableFonts());
      } catch {
        useSlicer.setState({ notice: "The browser didn't share this computer's fonts.", noticeWarn: true });
      }
      return;
    }
    set('font', value);
  };

  return (
    <>
      <textarea className="text-input" aria-label="Text" rows={2} value={style.text} onChange={(e) => set('text', e.target.value)} />
      {!style.text.trim() && <p className="hint simplify-warning">Type some text.</p>}
      <label className="transform-row text-row">
        <span>Font</span>
        <select aria-label="Font" value={missingFont ? '' : style.font} onChange={(e) => void pickFont(e.target.value)}>
          {missingFont && <option value="">{style.font} (not on this device)</option>}
          {GROUPS.map(([source, label]) => {
            const list = fonts.filter((f) => f.source === source);
            return list.length ? (
              <optgroup key={source} label={label}>
                {list.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
          <optgroup label="More fonts">
            <option value="__file">Load a font file…</option>
            {canListComputerFonts() && !fonts.some((f) => f.source === 'computer') && <option value="__computer">Use this computer's fonts…</option>}
          </optgroup>
        </select>
      </label>
      <input
        ref={fileInput}
        type="file"
        accept=".ttf,.otf,.ttc,font/ttf,font/otf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const choice = addFontFile(file);
          setFonts(availableFonts());
          set('font', choice.name);
        }}
      />
      {missingFont && <p className="hint simplify-warning">This text was made with a font that isn't on this device. Pick a font to change the text.</p>}
      {num('size', 'Height', 'mm', 0.5, 'Height of the letters')}
      {num('depth', 'Depth', 'mm', 0.1, kind === 'negative' ? 'How deep the text cuts in' : 'How far the text stands out')}
      <div className="segmented" role="radiogroup" aria-label="Alignment">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button key={a} role="radio" aria-checked={style.align === a} className={style.align === a ? 'on' : ''} onClick={() => set('align', a)}>
            {a === 'center' ? 'Centre' : a[0].toUpperCase() + a.slice(1)}
          </button>
        ))}
      </div>
      <div className="segmented" role="radiogroup" aria-label="Vertical alignment" title="Which part of the text sits at its middle point">
        {(['top', 'center', 'bottom'] as const).map((a) => (
          <button key={a} role="radio" aria-checked={style.valign === a} className={style.valign === a ? 'on' : ''} onClick={() => set('valign', a)}>
            {a === 'center' ? 'Middle' : a[0].toUpperCase() + a.slice(1)}
          </button>
        ))}
      </div>
      {onObject && (
        <div className="shape-checks">
          <label className="svg-ratio" title="The text bends with the object's surface instead of standing flat on it">
            <input type="checkbox" checked={style.useSurface} onChange={(e) => set('useSurface', e.target.checked)} />
            Use surface
          </label>
          <label className="svg-ratio" title="Each letter sits on the surface on its own, so text can go around a curved object">
            <input type="checkbox" checked={style.perGlyph} onChange={(e) => set('perGlyph', e.target.checked)} />
            Per letter
          </label>
        </div>
      )}
      <ShapePlacement object={object} volume={volume} followsSurface={style.useSurface} label="text" />
      {canChangeType && (
        <div className="segmented" role="radiogroup" aria-label="Text type">
          {TYPES.map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={kind === t}
              className={kind === t ? 'on' : ''}
              onClick={() => kind !== t && void volumeAction(object, { op: 'type', volume, type: t }, 'Change type')}
            >
              {t === 'negative' ? 'Engraved' : KIND_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      <button className="ghost text-more" aria-expanded={more} onClick={() => setMore(!more)}>
        {more ? 'Fewer settings' : 'More settings'}
      </button>
      {more && (
        <>
          {num('boldness', 'Boldness', 'mm', 0.05, 'Thicker (+) or thinner (−) letters')}
          {num('skew', 'Skew', '', 0.05, 'Slant the letters (0.2 is a light italic)')}
          {num('charGap', 'Letter gap', '', 10, 'Extra space between letters, in font units')}
          {num('lineGap', 'Line gap', '', 10, 'Extra space between lines, in font units')}
        </>
      )}
      <p className="muted hint">{working ? 'Making the text…' : `${placementHint('text', onObject)} Undo brings the last text back.`}</p>
    </>
  );
}

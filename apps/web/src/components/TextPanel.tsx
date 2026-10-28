import { useEffect, useRef, useState } from 'react';
import { DEFAULT_TEXT, clampStyle, missingLettersHint, type FontChoice, type TextStyle } from '../lib/fonts';
import { KIND_LABELS, keepsAPart } from '../lib/volumes';
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
    ['Built in', fonts.filter((f) => f.source === 'bundled' && !f.script)],
    ...scripts.map((script): [string, FontChoice[]] => [`Built in: ${script} and Latin`, fonts.filter((f) => f.script === script)]),
    ['Font files', fonts.filter((f) => f.source === 'file')],
    ['On this computer', fonts.filter((f) => f.source === 'computer')],
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
  // Closing the tool (Done, Esc, another tool) right after it added a text takes that text back.
  useEffect(() => () => void useSlicer.getState().dropUnusedText(), []);
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
  const [restoring, setRestoring] = useState(true);
  const [missing, setMissing] = useState('');
  const [working, setWorking] = useState(false);
  const [more, setMore] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // As the remake below would write it, so opening a text doesn't remake it unchanged.
  const applied = useRef(JSON.stringify(clampStyle({ ...DEFAULT_TEXT, ...start })));
  const { textVolume, volumeAction } = useSlicer.getState();
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
        useSlicer.setState({ notice: "The browser didn't share this computer's fonts.", noticeWarn: true });
      }
      return;
    }
    set('font', value);
  };

  return (
    <>
      <textarea className="text-input" aria-label="Text" dir="auto" rows={2} value={style.text} onChange={(e) => set('text', e.target.value)} />
      {!style.text.trim() && <Note tone="warn">Type some text.</Note>}
      <div className="transform-row text-row">
        <span>Font</span>
        <Picker
          field
          label="Font"
          value={missingFont ? null : style.font}
          placeholder={missingFont ? `${style.font} (not on this device)` : undefined}
          title="Built-in fonts, a font file you load (kept in this browser), or this computer's fonts in Chrome or Edge on a computer"
          options={fontGroups(fonts).flatMap(([group, list]) => list.map((f) => ({ value: f.name, label: f.name, group })))}
          onChange={(name) => void pickFont(name)}
          actions={([
            { id: '__file', label: 'Load a font file (.ttf, .otf)…', icon: FileUp },
            canListComputerFonts()
              ? !fonts.some((f) => f.source === 'computer') && { id: '__computer', label: "Use this computer's fonts…", icon: Monitor }
              : { id: '__nocomputer', label: "This computer's fonts: Chrome or Edge on a computer only", icon: Monitor, disabled: true },
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
      {missingFont && <Note tone="warn">This text was made with a font that isn't on this device. Pick a font to change the text.</Note>}
      {missing && !missingFont && <Note tone="warn">{missingLettersHint(missing)}</Note>}
      <ShapePlacement
        object={object}
        volume={volume}
        followsSurface={style.useSurface}
        label="text"
        fields={
          <>
            {num('size', 'Height', 'mm', 0.5, 'Height of the letters')}
            {num('depth', 'Depth', 'mm', 0.1, kind === 'negative' ? 'How deep the text cuts in' : 'How far the text stands out')}
          </>
        }
      />
      <div className="align-row">
        <div className="chooser icons" role="radiogroup" aria-label="Alignment">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={style.align === a}
              aria-label={ALIGN_NAMES[a]}
              title={`${ALIGN_NAMES[a]}: lines line up on the ${a === 'center' ? 'middle' : a}`}
              className={style.align === a ? 'on' : ''}
              onClick={() => set('align', a)}
            >
              <AlignIcon align={a} />
            </button>
          ))}
        </div>
        <div className="chooser icons" role="radiogroup" aria-label="Vertical alignment">
          {(['top', 'center', 'bottom'] as const).map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={style.valign === a}
              aria-label={VALIGN_NAMES[a]}
              title={`${VALIGN_NAMES[a]}: the text's ${a === 'center' ? 'middle' : a} sits on its point`}
              className={style.valign === a ? 'on' : ''}
              onClick={() => set('valign', a)}
            >
              <VAlignIcon valign={a} />
            </button>
          ))}
        </div>
      </div>
      {onObject && (
        <div className="shape-checks">
          <label className="switch-row" title="The text bends with the object's surface instead of standing flat on it">
            <input className="switch" type="checkbox" checked={style.useSurface} onChange={(e) => set('useSurface', e.target.checked)} />
            Use surface
          </label>
          <label className="switch-row" title="Each letter sits on the surface on its own, so text can go around a curved object">
            <input className="switch" type="checkbox" checked={style.perGlyph} onChange={(e) => set('perGlyph', e.target.checked)} />
            Per letter
          </label>
        </div>
      )}
      <ShapeActions object={object} volume={volume} />
      {canChangeType && (
        <div className="chooser" role="radiogroup" aria-label="Text type">
          {TYPES.map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={kind === t}
              className={kind === t ? 'on' : ''}
              onClick={() => kind !== t && void volumeAction(object, { op: 'type', volume, type: t, remake: true }, 'Change type')}
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
          <div className="num-fields">
            {num('boldness', 'Boldness', 'mm', 0.05, 'Thicker (+) or thinner (−) letters')}
            {num('skew', 'Skew', '', 0.05, 'Slant the letters (0.2 is a light italic)')}
            {num('charGap', 'Letter gap', '', 10, 'Extra space between letters, in font units')}
            {num('lineGap', 'Line gap', '', 10, 'Extra space between lines, in font units')}
          </div>
        </>
      )}
      <p className="muted hint">{working ? 'Making the text…' : `${placementHint('text', onObject)} Undo brings the last text back.`}</p>
    </>
  );
}

const ALIGN_NAMES = { left: 'Left', center: 'Centre', right: 'Right' } as const;
const VALIGN_NAMES = { top: 'Top', center: 'Middle', bottom: 'Bottom' } as const;

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

/** Two lines of text at the top, middle or bottom of a box, its point marked. */
function VAlignIcon({ valign }: { valign: 'top' | 'center' | 'bottom' }) {
  const y = valign === 'top' ? 4 : valign === 'bottom' ? 10 : 7;
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <rect x="1.5" y="1.5" width="15" height="15" rx="2" strokeWidth="1" opacity="0.5" />
      <line x1="5" x2="13" y1={y} y2={y} />
      <line x1="5" x2="13" y1={y + 4} y2={y + 4} />
    </svg>
  );
}

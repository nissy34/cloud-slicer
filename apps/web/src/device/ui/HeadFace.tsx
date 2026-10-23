import type { HeadMood } from '../heads';

/** Heater colour: cold metal, warm amber, hot orange-red. */
const heat = (t: number) => (t >= 170 ? 'var(--dv-hot)' : t >= 50 ? 'var(--dv-warm)' : 'var(--dv-metal)');

const EYES_OPEN = (
  <g className="dv-face-eyes">
    <ellipse cx="39" cy="48" rx="5" ry="6" fill="#fff" />
    <ellipse cx="61" cy="48" rx="5" ry="6" fill="#fff" />
    <circle cx="40" cy="49" r="2.6" fill="var(--dv-head-body)" />
    <circle cx="62" cy="49" r="2.6" fill="var(--dv-head-body)" />
  </g>
);

function Eyes({ mood }: { mood: HeadMood }) {
  if (mood === 'napping') return <path d="M34 50q5 4 10 0M56 50q5 4 10 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />;
  if (mood === 'hungry' || mood === 'worried')
    return (
      <g className="dv-face-eyes">
        <circle cx="39" cy="48" r="5" fill="#fff" />
        <circle cx="61" cy="48" r="5" fill="#fff" />
        <circle cx="39" cy="49" r="2.5" fill="var(--dv-head-body)" />
        <circle cx="61" cy="49" r="2.5" fill="var(--dv-head-body)" />
      </g>
    );
  return EYES_OPEN;
}

function Mouth({ mood }: { mood: HeadMood }) {
  const line = { stroke: '#fff', strokeWidth: 3, fill: 'none', strokeLinecap: 'round' as const };
  switch (mood) {
    case 'printing':
    case 'hot':
    case 'ready':
      return <path d="M41 62q9 8 18 0" {...line} />;
    case 'hungry':
      return <ellipse className="dv-face-mouth" cx="50" cy="65" rx="7" ry="6" fill="var(--dv-head-hi)" stroke="#fff" strokeWidth="2" />;
    case 'cooling':
      return <path d="M42 64q4-3 8 0t8 0" {...line} strokeWidth={2.5} />;
    case 'worried':
      return <path d="M42 67q8-7 16 0" {...line} />;
    case 'heating':
      return <ellipse cx="50" cy="64" rx="4" ry="3.5" fill="#fff" />;
    default:
      return <path d="M44 64h12" {...line} strokeWidth={2.5} />;
  }
}

function Extra({ mood }: { mood: HeadMood }) {
  switch (mood) {
    case 'napping':
      return (
        <g fill="var(--muted)" fontWeight="700">
          <text className="dv-face-z" x="76" y="24" fontSize="14">
            z
          </text>
          <text className="dv-face-z dv-face-z2" x="84" y="14" fontSize="10">
            z
          </text>
        </g>
      );
    case 'cooling':
      return <path className="dv-face-drop" d="M78 34q4 7 0 10q-4-3 0-10z" fill="#5db4ff" />;
    case 'hungry':
      // Thinking of a spool of filament, like the one it dreams of in bed.
      return (
        <g className="dv-face-think">
          <circle cx="85" cy="28" r="2.2" fill="#fff" stroke="var(--dv-outline)" strokeWidth="1.5" />
          <circle cx="90" cy="21" r="3.2" fill="#fff" stroke="var(--dv-outline)" strokeWidth="1.5" />
          <g className="dv-bed-dream">
            <path d="M82 9q-5-12 8-13q5-9 16-4q13-1 13 9q9 8-3 14h-28q-10-1-6-6z" fill="#fff" stroke="var(--dv-outline)" strokeWidth="1.8" />
            <rect x="91" y="-2" width="20" height="14" rx="2" fill="var(--dv-warm)" />
            <path d="M91 2.5h20M91 7h20" stroke="rgba(0,0,0,.2)" strokeWidth="1.2" />
            <rect x="88" y="-4" width="3.5" height="18" rx="1.2" fill="var(--dv-metal)" />
            <rect x="110.5" y="-4" width="3.5" height="18" rx="1.2" fill="var(--dv-metal)" />
          </g>
        </g>
      );
    case 'printing':
      return <path className="dv-face-spark" d="M86 20l3 6 6 3-6 3-3 6-3-6-6-3 6-3z" fill="var(--dv-warm)" />;
    case 'heating':
      return <path className="dv-face-steam" d="M80 40q4-5 0-10t0-10M88 44q4-5 0-10t0-10" stroke="var(--dv-warm)" strokeWidth="2.5" fill="none" strokeLinecap="round" />;
    case 'worried':
      return (
        <text x="80" y="30" fontSize="22" fontWeight="800" fill="var(--dv-warn)">
          !
        </text>
      );
    default:
      return null;
  }
}

/**
 * A baseball cap in the filament colour. The outline (dark on the light theme,
 * light on the dark one) keeps black and white filament visible on any card.
 */
function Cap({ colour }: { colour: string }) {
  const edge = { stroke: 'var(--dv-outline)', strokeWidth: 3, strokeLinejoin: 'round' as const };
  return (
    <g className="dv-face-cap">
      <path d="M18 36Q18 12 50 12Q82 12 82 36Z" fill={colour} {...edge} />
      <path d="M60 34Q86 31 100 37Q86 41 60 39Z" fill={colour} {...edge} />
      <circle cx="50" cy="12" r="3.5" fill="var(--dv-outline)" />
      <path d="M28 26Q36 18 48 17" stroke="rgba(255,255,255,.55)" strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  );
}

/** The character itself, in the 100 x 120 box both drawings share: filament, body, face and hot end. */
export function HeadBody({ mood, colour, loaded, temp }: { mood: HeadMood; colour: string | null; loaded: boolean | null; temp: number }) {
  const band = loaded && colour ? colour : 'var(--dv-head-hi)';
  return (
    <g className="dv-face-body">
      {loaded === false ? (
        <line x1="50" y1="2" x2="50" y2="22" stroke="var(--dv-metal)" strokeWidth="5" strokeDasharray="3 4" strokeLinecap="round" />
      ) : (
        <line x1="50" y1="0" x2="50" y2="22" stroke="var(--dv-outline)" strokeWidth="10" strokeLinecap="round" />
      )}
      {loaded !== false && (
        <line
          className="dv-face-strand"
          x1="50"
          y1="0"
          x2="50"
          y2="22"
          stroke={loaded && colour ? colour : 'var(--dv-metal)'}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={mood === 'printing' ? '5 3' : undefined}
        />
      )}
      <rect x="18" y="20" width="64" height="66" rx="20" fill="var(--dv-head-body)" />
      <Cap colour={band} />
      <Eyes mood={mood} />
      <Mouth mood={mood} />
      <rect x="36" y="86" width="28" height="11" rx="3" fill={heat(temp)} />
      <path d="M42 97H58L53 108H47Z" fill="var(--dv-brass)" />
    </g>
  );
}

/**
 * A tool head drawn as a little character: the filament going in at the top
 * in its colour (dashed when empty, grey when the printer doesn't say), a
 * heater block and glow that follow the temperature, and a face for its mood.
 * An empty head thinks of a spool.
 */
export function HeadFace({ mood, colour, loaded, temp, size = 56 }: { mood: HeadMood; colour: string | null; loaded: boolean | null; temp: number; size?: number }) {
  return (
    <svg className={`dv-face dv-face-${mood}`} viewBox="0 0 100 120" width={size} height={size * 1.2} aria-hidden>
      {temp >= 50 && <ellipse className="dv-face-glow" cx="50" cy="108" rx={temp >= 170 ? 20 : 14} ry="9" fill={heat(temp)} opacity=".45" />}
      <HeadBody mood={mood} colour={colour} loaded={loaded} temp={temp} />
      <Extra mood={mood} />
    </svg>
  );
}

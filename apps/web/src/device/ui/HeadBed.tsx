import { STILL_HOT, type HeadMood } from '../heads';
import { HeadBody } from './HeadFace';

/**
 * What a docked head is doing in its bed: asleep, a coffee break now and then,
 * getting up when the printer picks it up, or going back to bed when parked.
 */
export type BedScene = 'asleep' | 'coffee' | 'waking' | 'bedtime';

// Positioned groups set their own transform box, so the card's little animations never move them.
const PLACED = { transformBox: 'view-box', transformOrigin: '0 0' } as const;

const PHONES = (
  <g className="dv-bed-phones">
    <path d="M18 44Q18 12 50 12Q82 12 82 44" stroke="var(--dv-phones)" strokeWidth="4" fill="none" strokeLinecap="round" />
    <rect x="11" y="38" width="11" height="17" rx="5" fill="var(--dv-phones)" />
    <rect x="78" y="38" width="11" height="17" rx="5" fill="var(--dv-phones)" />
  </g>
);

/** How a docked head rests, from its mood: under or on top of the blanket, and what is around it. */
type Pose = 'nap' | 'hot' | 'cooling' | 'hungry' | 'heating' | 'worried';

function poseOf(mood: HeadMood, temp: number): Pose {
  if (mood === 'worried' || mood === 'hungry' || mood === 'heating' || mood === 'cooling') return mood;
  if (mood === 'hot' || temp >= STILL_HOT) return 'hot';
  return 'nap';
}

// Check me lies in bed with a thermometer in its open mouth, like a sick day.
const FACE: Record<Pose, HeadMood> = { nap: 'napping', hot: 'hot', cooling: 'cooling', hungry: 'hungry', heating: 'heating', worried: 'hungry' };

const THERMOMETER = (
  <g className="dv-bed-thermometer">
    <g transform="rotate(-15 50 66)" style={PLACED}>
      <rect x="50" y="61.5" width="48" height="9" rx="4.5" fill="#fff" stroke="var(--dv-outline)" strokeWidth="2.5" />
      <rect x="56" y="64.4" width="24" height="3.2" rx="1.6" fill="#e5484d" />
      <path d="M83 63v3M87.5 63v3" stroke="#7d8796" strokeWidth="1.6" />
    </g>
    <ellipse cx="50" cy="66" rx="7" ry="6" fill="var(--dv-head-hi)" stroke="#fff" strokeWidth="2.2" />
    <g transform="rotate(-15 50 66)" style={PLACED}>
      <rect x="50" y="63" width="8" height="6" fill="#fff" />
    </g>
  </g>
);

/**
 * A docked tool head lying back on its pillow, cap on the pillow, the face
 * tilting with it. Napping (headphones on), heating up and check me (with a
 * thermometer in its mouth) are
 * tucked in under a blanket in the filament colour, pulled up to the chin;
 * hot, cooling down (with a fan on the bedside table) and feed me (dreaming
 * of a spool) lie on top of it. Now and then a napping head takes a coffee
 * break: headphones on the bedpost, sits up, sips from the mug, lies back.
 * Getting up and going to bed are the same moves.
 */
export function HeadBed({ mood, colour, loaded, temp, scene, size = 60 }: { mood: HeadMood; colour: string | null; loaded: boolean | null; temp: number; scene: BedScene; size?: number }) {
  const blanketColour = loaded && colour ? colour : 'var(--dv-head-hi)';
  const pose = poseOf(mood, temp);
  const onTop = pose === 'hot' || pose === 'cooling' || pose === 'hungry';
  // Where the head rests: on the mattress, or a little higher on top of the blanket.
  const b = onTop ? 68 : 76;
  const edge = { stroke: 'var(--dv-outline)', strokeWidth: 2.5, strokeLinejoin: 'round' as const };
  const blanket = onTop ? (
    <g className="dv-bed-blanket">
      <path d="M28 68Q76 62 124 68V80H28Z" fill={blanketColour} {...edge} />
    </g>
  ) : (
    <g className="dv-bed-blanket">
      <path d={`M70 ${b - 44}Q80 ${b - 50} 96 ${b - 40}Q114 ${b - 30} 124 ${b - 20}V${b + 4}H64Q62 ${b - 24} 70 ${b - 44}Z`} fill={blanketColour} {...edge} />
      <path d={`M70 ${b - 44}Q80 ${b - 50} 96 ${b - 40}L97 ${b - 32}Q82 ${b - 42} 71 ${b - 36}Z`} fill="rgba(255,255,255,.45)" {...edge} strokeWidth={2} />
      <path d={`M86 ${b - 20}q8-4 16 2M102 ${b - 12}q8-3 14 2`} stroke="rgba(0,0,0,.18)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </g>
  );
  return (
    <svg className={`dv-bed dv-bed-${scene} dv-bed-pose-${pose}`} viewBox="0 0 170 104" width={size * 1.63} height={size} aria-hidden>
      <rect x="2" y="38" width="9" height="62" rx="3" fill="var(--dv-wood)" />
      <rect x="119" y="60" width="9" height="40" rx="3" fill="var(--dv-wood)" />
      <rect x="4" y="76" width="122" height="12" rx="4" fill="var(--dv-mattress)" />
      {onTop && blanket}
      <ellipse cx="24" cy={b - 6} rx="16" ry="8" fill="#fff" stroke="var(--border)" />
      <g className="dv-bed-lie">
        <g transform={`translate(50 ${b - 22}) rotate(-75) scale(.7) translate(-50 -54)`} style={PLACED}>
          <HeadBody mood={FACE[pose]} colour={colour} loaded={loaded} temp={temp} />
          {pose === 'nap' && PHONES}
          {pose === 'worried' && THERMOMETER}
        </g>
      </g>
      {!onTop && blanket}
      <g className="dv-bed-sit">
        <g transform="translate(60 16) scale(.62)" style={PLACED}>
          <HeadBody mood="ready" colour={colour} loaded={loaded} temp={temp} />
          <path className="dv-bed-sip" d="M34 50q5-4 10 0M56 50q5-4 10 0" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </g>
      </g>
      <g className="dv-bed-post">
        <path d="M-2 38Q6 22 14 38" stroke="var(--dv-phones)" strokeWidth="3" fill="none" />
        <rect x="-5" y="36" width="7" height="11" rx="3" fill="var(--dv-phones)" />
        <rect x="10" y="36" width="7" height="11" rx="3" fill="var(--dv-phones)" />
      </g>
      <rect x="134" y="66" width="34" height="6" rx="2" fill="var(--dv-wood)" />
      <rect x="138" y="72" width="5" height="28" fill="var(--dv-wood)" />
      <rect x="159" y="72" width="5" height="28" fill="var(--dv-wood)" />
      {pose === 'cooling' ? (
        <g className="dv-bed-fan">
          <g transform="translate(151 48)" style={PLACED}>
            <rect x="-2" y="8" width="4" height="10" fill="var(--dv-metal)" />
            <rect x="-8" y="16" width="16" height="3" rx="1.5" fill="var(--dv-metal)" />
            <circle r="11" fill="none" stroke="var(--dv-metal)" strokeWidth="2" />
            <g className="dv-bed-blades">
              <path d="M0 0L-3-10Q0-12 3-10ZM0 0L10-3Q12 0 10 3ZM0 0L3 10Q0 12-3 10ZM0 0L-10 3Q-12 0-10-3Z" fill="var(--dv-mattress)" />
            </g>
            <circle r="2.4" fill="var(--dv-outline)" />
          </g>
          <path className="dv-bed-wind" d="M134 40q-8-3-16 0M134 48q-10-3-20 0M134 56q-8-3-16 0" stroke="#7fc4ff" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      ) : (
        <>
          <path d="M154 66h12l-3-10h-6z" fill="#f2c94c" />
          <path d="M150 56h20l-5-14h-10z" fill="#ffe8a3" stroke="#e0b84a" />
          <g className="dv-bed-mug">
            <rect x="136" y="48" width="14" height="16" rx="3" fill="#fff" stroke="#8c6640" strokeWidth="2" />
            <path d="M150 52q7 0 7 5t-7 5" stroke="#8c6640" strokeWidth="2.5" fill="none" />
            <rect x="138" y="50" width="10" height="3.5" fill="#8c5a2b" />
            <path className="dv-bed-steam" d="M140 44q3-4 0-8M146 44q3-4 0-8" stroke="var(--muted)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </g>
        </>
      )}
      <BedExtra pose={pose} />
    </svg>
  );
}

/** Above the head: z's, sweat, a dream of a spool or heat waves. Hidden while the head gets up. */
function BedExtra({ pose }: { pose: Pose }) {
  switch (pose) {
    case 'hot':
      return (
        <g className="dv-bed-z" fill="#5db4ff">
          <path className="dv-face-drop" d="M66 22q4 7 0 10q-4-3 0-10z" />
          <path className="dv-face-drop dv-face-z2" d="M78 28q3 5 0 8q-3-2 0-8z" />
        </g>
      );
    case 'cooling':
      return <path className="dv-bed-z dv-face-drop" d="M70 26q3 5 0 8q-3-2 0-8z" fill="#5db4ff" />;
    case 'hungry':
      return (
        <g className="dv-bed-z">
          <circle cx="64" cy="30" r="2.5" fill="var(--surface)" stroke="var(--border)" />
          <circle cx="72" cy="22" r="3.5" fill="var(--surface)" stroke="var(--border)" />
          <g className="dv-bed-dream">
            <path d="M78 18q-3-12 10-12q5-9 15-3q12-2 12 9q8 7-3 14h-30q-9-3-4-8z" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
            <rect x="88" y="7" width="18" height="13" rx="2" fill="var(--dv-warm)" />
            <rect x="86" y="5" width="3" height="17" rx="1" fill="var(--dv-metal)" />
            <rect x="105" y="5" width="3" height="17" rx="1" fill="var(--dv-metal)" />
          </g>
        </g>
      );
    case 'heating':
      return (
        <path className="dv-bed-z dv-face-steam" d="M60 34q4-4 0-8t0-8M72 34q4-4 0-8t0-8M84 36q4-4 0-8t0-8" stroke="var(--dv-hot)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      );
    case 'worried':
      return null;
    default:
      return (
        <g className="dv-bed-z" fill="var(--muted)" fontWeight="700">
          <text className="dv-face-z" x="56" y="34" fontSize="15">
            z
          </text>
          <text className="dv-face-z dv-face-z2" x="66" y="24" fontSize="11">
            z
          </text>
        </g>
      );
  }
}

/** How long each scene plays, in ms; asleep has no end. */
export const BED_SCENE_MS = { coffee: 7000, waking: 1800, bedtime: 1800 } as const;

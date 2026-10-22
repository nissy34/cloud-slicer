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

/** How a docked head rests, from its mood: what it does in bed and what is on the bedside table. */
type Pose = 'nap' | 'hot' | 'cooling' | 'dream' | 'stretch' | 'worried';

function poseOf(mood: HeadMood, temp: number): Pose {
  if (mood === 'worried') return 'worried';
  if (mood === 'hungry') return 'dream';
  if (mood === 'heating') return 'stretch';
  if (mood === 'cooling') return 'cooling';
  if (mood === 'hot' || temp >= STILL_HOT) return 'hot';
  return 'nap';
}

/**
 * A docked tool head in bed, propped up on its pillow so the face shows.
 * Napping: headphones on, under a blanket in its filament colour; now and then
 * a coffee break (headphones on the bedpost, sits up, sips from the mug on the
 * bedside table, lies back). Hot: rests the same way but on top of the
 * blanket, sweating; cooling down adds a fan on the bedside table. No
 * filament: sits on top of the blanket, looks at you and thinks of a spool.
 * Heating up: sits up and stretches as the heat rises. Getting up and going
 * to bed are the same moves.
 */
export function HeadBed({ mood, colour, loaded, temp, scene, size = 60 }: { mood: HeadMood; colour: string | null; loaded: boolean | null; temp: number; scene: BedScene; size?: number }) {
  const blanketColour = loaded && colour ? colour : 'var(--dv-head-hi)';
  const pose = poseOf(mood, temp);
  const edge = { stroke: 'var(--dv-outline)', strokeWidth: 2.5 };
  const blanket = (
    <g className="dv-bed-blanket">
      <path d={pose === 'stretch' ? 'M30 66Q76 58 124 64V80H28Z' : 'M30 58Q76 48 124 56V80H28Z'} fill={blanketColour} {...edge} />
      <path d={pose === 'stretch' ? 'M30 66Q76 58 124 64' : 'M30 58Q76 48 124 56'} stroke="rgba(255,255,255,.55)" strokeWidth="4" fill="none" />
    </g>
  );
  const onTop = pose === 'hot' || pose === 'cooling' || pose === 'dream';
  const lying =
    pose === 'stretch' ? (
      <g transform="translate(30 10) scale(.6)" style={PLACED}>
        <g className="dv-bed-stretch">
          <HeadBody mood="heating" colour={colour} loaded={loaded} temp={temp} />
        </g>
      </g>
    ) : pose === 'dream' ? (
      // Sits up on top of the blanket, facing you.
      <g transform="translate(34 6) scale(.6)" style={PLACED}>
        <HeadBody mood="hungry" colour={colour} loaded={loaded} temp={temp} />
      </g>
    ) : (
      <g transform={`translate(26 ${onTop ? 12 : 16}) rotate(-16) scale(.6)`} style={PLACED}>
        <HeadBody mood={pose === 'nap' ? 'napping' : pose === 'worried' ? 'worried' : pose} colour={colour} loaded={loaded} temp={temp} />
        {pose === 'nap' && PHONES}
      </g>
    );
  return (
    <svg className={`dv-bed dv-bed-${scene} dv-bed-pose-${pose}`} viewBox="0 0 170 104" width={size * 1.63} height={size} aria-hidden>
      <rect x="2" y="34" width="9" height="66" rx="3" fill="var(--dv-wood)" />
      <rect x="119" y="60" width="9" height="40" rx="3" fill="var(--dv-wood)" />
      <rect x="4" y="76" width="122" height="12" rx="4" fill="var(--dv-mattress)" />
      <ellipse cx="20" cy="54" rx="12" ry="20" fill="#fff" stroke="var(--border)" />
      {onTop && blanket}
      <g className="dv-bed-lie">{lying}</g>
      {!onTop && blanket}
      <g className="dv-bed-sit">
        <g transform="translate(60 16) scale(.62)" style={PLACED}>
          <HeadBody mood="ready" colour={colour} loaded={loaded} temp={temp} />
          <path className="dv-bed-sip" d="M34 50q5-4 10 0M56 50q5-4 10 0" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </g>
      </g>
      <g className="dv-bed-post">
        <path d="M-2 34Q6 18 14 34" stroke="var(--dv-phones)" strokeWidth="3" fill="none" />
        <rect x="-5" y="32" width="7" height="11" rx="3" fill="var(--dv-phones)" />
        <rect x="10" y="32" width="7" height="11" rx="3" fill="var(--dv-phones)" />
      </g>
      <rect x="134" y="66" width="34" height="6" rx="2" fill="var(--dv-wood)" />
      <rect x="138" y="72" width="5" height="28" fill="var(--dv-wood)" />
      <rect x="159" y="72" width="5" height="28" fill="var(--dv-wood)" />
      {pose === 'cooling' ? (
        <g className="dv-bed-fan">
          <g transform="translate(151 48)" style={PLACED}>
            <rect x="-2" y="8" width="4" height="8" fill="var(--dv-metal)" />
            <rect x="-8" y="15" width="16" height="3" rx="1.5" fill="var(--dv-metal)" />
            <circle r="11" fill="none" stroke="var(--dv-metal)" strokeWidth="2" />
            <g className="dv-bed-blades">
              <path d="M0 0L-3-10Q0-12 3-10ZM0 0L10-3Q12 0 10 3ZM0 0L3 10Q0 12-3 10ZM0 0L-10 3Q-12 0-10-3Z" fill="var(--dv-mattress)" />
            </g>
            <circle r="2.4" fill="var(--dv-outline)" />
          </g>
          <path className="dv-bed-wind" d="M134 42q-8-3-16 0M134 50q-10-3-20 0M134 58q-8-3-16 0" stroke="#7fc4ff" strokeWidth="2" fill="none" strokeLinecap="round" />
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

/** Above the head: z's, sweat, a dream of a spool, steam or a "!". Hidden while the head gets up. */
function BedExtra({ pose }: { pose: Pose }) {
  switch (pose) {
    case 'hot':
    case 'cooling':
      return (
        <g className="dv-bed-z" fill="#5db4ff">
          <path className="dv-face-drop" d="M84 30q4 7 0 10q-4-3 0-10z" />
          <path className="dv-face-drop dv-face-z2" d="M96 38q3 5 0 8q-3-2 0-8z" />
        </g>
      );
    case 'dream':
      return (
        <g className="dv-bed-z" transform="translate(14 0)" style={PLACED}>
          <circle cx="80" cy="34" r="2.5" fill="var(--surface)" stroke="var(--border)" />
          <circle cx="88" cy="26" r="3.5" fill="var(--surface)" stroke="var(--border)" />
          <g className="dv-bed-dream">
            <path d="M92 22q-3-13 10-13q5-10 16-3q13-2 13 10q8 8-3 15h-34q-10-3-2-9z" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
            <rect x="101" y="11" width="22" height="16" rx="2" fill="var(--dv-warm)" />
            <rect x="98" y="8" width="4" height="22" rx="1.5" fill="var(--dv-metal)" />
            <rect x="122" y="8" width="4" height="22" rx="1.5" fill="var(--dv-metal)" />
            <path d="M104 16h16M104 21h16" stroke="rgba(0,0,0,.2)" />
          </g>
        </g>
      );
    case 'stretch':
      return (
        <path className="dv-bed-z dv-face-steam" d="M80 14q4-5 0-10M90 18q4-5 0-10" stroke="var(--dv-hot)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      );
    case 'worried':
      return (
        <text className="dv-bed-z" x="84" y="26" fontSize="22" fontWeight="800" fill="var(--dv-warn)">
          !
        </text>
      );
    default:
      return (
        <g className="dv-bed-z" fill="var(--muted)" fontWeight="700">
          <text className="dv-face-z" x="78" y="22" fontSize="15">
            z
          </text>
          <text className="dv-face-z dv-face-z2" x="88" y="12" fontSize="11">
            z
          </text>
        </g>
      );
  }
}

/** How long each scene plays, in ms; asleep has no end. */
export const BED_SCENE_MS = { coffee: 7000, waking: 1800, bedtime: 1800 } as const;

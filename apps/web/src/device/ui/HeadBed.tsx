import type { HeadMood } from '../heads';
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

/**
 * A docked tool head lying in bed with headphones on, under a blanket in its
 * filament colour. During a coffee break it hangs the headphones on the
 * bedpost, sits up (the blanket goes flat), sips from the mug on the bedside
 * table and lies back down; getting up and going to bed are the same moves.
 */
export function HeadBed({ mood, colour, loaded, temp, scene, size = 60 }: { mood: HeadMood; colour: string | null; loaded: boolean | null; temp: number; scene: BedScene; size?: number }) {
  const blanket = loaded && colour ? colour : 'var(--dv-head-hi)';
  const lying: HeadMood = mood === 'printing' || mood === 'ready' || mood === 'heating' || mood === 'hot' ? 'napping' : mood;
  return (
    <svg className={`dv-bed dv-bed-${scene}`} viewBox="0 0 170 104" width={size * 1.63} height={size} aria-hidden>
      <rect x="2" y="38" width="9" height="62" rx="3" fill="var(--dv-wood)" />
      <rect x="119" y="60" width="9" height="40" rx="3" fill="var(--dv-wood)" />
      <rect x="4" y="76" width="122" height="12" rx="4" fill="var(--dv-mattress)" />
      <ellipse cx="26" cy="68" rx="17" ry="9" fill="#fff" stroke="var(--border)" />
      <g className="dv-bed-lie">
        <g transform="translate(12 90) rotate(-90) scale(.78)" style={PLACED}>
          <HeadBody mood={lying} colour={colour} loaded={loaded} temp={temp} />
          {PHONES}
        </g>
      </g>
      <g className="dv-bed-blanket">
        <path d="M58 50Q92 42 124 54V80H56Z" fill={blanket} stroke="var(--dv-outline)" strokeWidth="2.5" />
        <path d="M58 50Q92 42 124 54" stroke="rgba(255,255,255,.55)" strokeWidth="4" fill="none" />
      </g>
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
      <path d="M154 66h12l-3-10h-6z" fill="#f2c94c" />
      <path d="M150 56h20l-5-14h-10z" fill="#ffe8a3" stroke="#e0b84a" />
      <g className="dv-bed-mug">
        <rect x="136" y="48" width="14" height="16" rx="3" fill="#fff" stroke="#8c6640" strokeWidth="2" />
        <path d="M150 52q7 0 7 5t-7 5" stroke="#8c6640" strokeWidth="2.5" fill="none" />
        <rect x="138" y="50" width="10" height="3.5" fill="#8c5a2b" />
        <path className="dv-bed-steam" d="M140 44q3-4 0-8M146 44q3-4 0-8" stroke="var(--muted)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </g>
      {temp >= 50 ? (
        <path className="dv-face-drop dv-bed-z" d="M60 14q4 7 0 10q-4-3 0-10z" fill="#5db4ff" />
      ) : (
        <g className="dv-bed-z" fill="var(--muted)" fontWeight="700">
          <text className="dv-face-z" x="64" y="28" fontSize="15">
            z
          </text>
          <text className="dv-face-z dv-face-z2" x="74" y="16" fontSize="11">
            z
          </text>
        </g>
      )}
    </svg>
  );
}

/** How long each scene plays, in ms; asleep has no end. */
export const BED_SCENE_MS = { coffee: 7000, waking: 1800, bedtime: 1800 } as const;

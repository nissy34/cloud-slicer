import { useId } from 'react';
import { formatMegabytes } from '../lib/format';
import type { Loading } from '../state/loading';
import './print-loader.css';

/**
 * A nozzle printing four layers, back and forth, in the app icon's look
 * (public/icon.svg). Pure SVG + CSS; with reduced motion it stands still.
 */
function PrintingNozzle() {
  // useId gives ":r1:", which isn't a usable url(#…) reference.
  const id = `pn${useId().replace(/[^\w-]/g, '')}`;
  const fill = `url(#${id})`;
  return (
    <svg className="print-nozzle" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2f6fe4" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect className="pn-bed" x="8" y="108" width="144" height="4" rx="2" />
      <g fill={fill}>
        <rect className="pn-layer pn-l1" x="20" y="96" width="120" height="11" rx="5.5" />
        <rect className="pn-layer pn-l2" x="30" y="82" width="100" height="11" rx="5.5" opacity=".9" />
        <rect className="pn-layer pn-l3" x="42" y="68" width="76" height="11" rx="5.5" opacity=".8" />
        <rect className="pn-layer pn-l4" x="56" y="54" width="48" height="11" rx="5.5" opacity=".7" />
      </g>
      {/* The tip is at (0, 0); the animation moves it along each layer. */}
      <g className="pn-head">
        <circle className="pn-glow" cx="0" cy="-1" r="5" fill={fill} />
        <rect className="pn-body" x="-15" y="-38" width="30" height="18" rx="2" />
        <path className="pn-body" d="M-11 -20h22l-8 17h-6z" />
      </g>
    </svg>
  );
}

/** The loading card: animation, what is happening, and progress when known. */
export function PrintLoader({ loading }: { loading: Loading }) {
  const { label, loaded, total } = loading;
  const progress = loading.progress ?? (total ? Math.min(1, (loaded ?? 0) / total) : undefined);
  const detail =
    loading.detail ?? (loaded ? (total ? `${formatMegabytes(loaded)} of ${formatMegabytes(total)}` : formatMegabytes(loaded)) : '');
  return (
    <div className="print-loader" data-testid="print-loader">
      <PrintingNozzle />
      <div className="pl-label">{label}</div>
      <div
        className={progress === undefined ? 'pl-bar indeterminate' : 'pl-bar'}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress === undefined ? undefined : Math.round(progress * 100)}
      >
        <span style={progress === undefined ? undefined : { width: `${progress * 100}%` }} />
      </div>
      <div className="pl-detail muted">{detail || ' '}</div>
    </div>
  );
}

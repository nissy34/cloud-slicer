import { forwardRef, type CSSProperties, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * The app's one slider (docs/architecture/design-system.md): a range input
 * whose track fills in blue up to the thumb. The fill is passed to CSS as
 * --fill (0 to 1), because only some browsers draw it themselves.
 */
export const Slider = forwardRef<HTMLInputElement, Props>(function Slider({ className, style, ...rest }, ref) {
  const min = Number(rest.min ?? 0);
  const max = Number(rest.max ?? 100);
  const value = Number(rest.value ?? rest.defaultValue ?? min);
  const fill = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  return <input ref={ref} type="range" className={['slider', className].filter(Boolean).join(' ')} style={{ '--fill': fill, ...style } as CSSProperties} {...rest} />;
});

// Motion that scripts start, which the stylesheet's reduced-motion rule can't
// reach (docs/architecture/design-system.md, Motion).

/** How to scroll something into view: smoothly, or at once when the device asks for less motion. */
export const scrollMotion = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

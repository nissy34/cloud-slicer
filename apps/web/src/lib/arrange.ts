// Desktop Orca's Arrange options (its toolbar pop-up, GLCanvas3D::_render_arrange_menu
// and ArrangeSettings): kept in this browser, like desktop keeps them in its app
// config rather than in the project.

/** What the engine's arrangePlate takes besides the spacing. */
export interface ArrangeOptions {
  rotate?: boolean;
  alignY?: boolean;
  multiMaterial?: boolean;
}

export interface ArrangeSettings {
  /** mm between objects; 0 means auto spacing. */
  spacing: number;
  /** "Auto rotate for arrangement". */
  rotate: boolean;
  /** "Allow multiple materials on same plate". */
  multiMaterial: boolean;
  /** "Align to Y axis"; null follows the printer (on for a bed that moves along Y), as desktop's Reset does. */
  alignY: boolean | null;
}

/** Desktop's ArrangeSettings defaults. */
export const DEFAULT_ARRANGE: ArrangeSettings = { spacing: 0, rotate: false, multiMaterial: true, alignY: null };

/** Desktop's spacing slider runs 0 to 100 mm. */
export const MAX_SPACING = 100;

/** What auto spacing is here: 6 mm apart (the gap Arrange always used). */
export const AUTO_SPACING = 6;

const KEY = 'cloud-slicer:arrange:v1';

/** Any value is taken; only what can't be a setting falls back to the default. */
export function cleanArrange(raw: unknown): ArrangeSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const spacing = Number(r.spacing);
  return {
    spacing: Number.isFinite(spacing) && spacing > 0 ? spacing : 0,
    rotate: typeof r.rotate === 'boolean' ? r.rotate : DEFAULT_ARRANGE.rotate,
    multiMaterial: typeof r.multiMaterial === 'boolean' ? r.multiMaterial : DEFAULT_ARRANGE.multiMaterial,
    alignY: typeof r.alignY === 'boolean' ? r.alignY : null,
  };
}

export function loadArrange(): ArrangeSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? cleanArrange(JSON.parse(raw)) : DEFAULT_ARRANGE;
  } catch {
    return DEFAULT_ARRANGE;
  }
}

export function saveArrange(settings: ArrangeSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable: the options last until the page closes
  }
}

/** Desktop's default for Align to Y axis: on for an i3-style printer (the bed moves along Y). */
export function alignYFor(settings: ArrangeSettings, printerStructure: string | undefined): boolean {
  return settings.alignY ?? printerStructure === 'i3';
}

/**
 * The spacing and options for one plate. Printing object by object, the gap is
 * at least the tool head's clearance (`clearance`), as desktop's ArrangeJob raises
 * the distance to the extruder clearance radius then.
 */
export function arrangeRequest(settings: ArrangeSettings, printerStructure: string | undefined, clearance?: number) {
  const chosen = settings.spacing > 0 ? settings.spacing : AUTO_SPACING;
  return {
    spacing: clearance === undefined ? chosen : Math.max(chosen, clearance),
    options: {
      rotate: settings.rotate,
      // Desktop greys Align to Y axis out while auto rotate is on.
      alignY: !settings.rotate && alignYFor(settings, printerStructure),
      multiMaterial: settings.multiMaterial,
    } satisfies ArrangeOptions,
  };
}

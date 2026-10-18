/** 5025 -> "1 h 24 min"; 59 -> "1 min". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '–';
  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** 12.345 -> "12.3 g"; 0 -> "–". */
export function formatGrams(grams: number): string {
  if (!Number.isFinite(grams) || grams <= 0) return '–';
  return `${grams < 10 ? grams.toFixed(1) : Math.round(grams)} g`;
}

/** 3DBenchy.stl -> 3DBenchy.gcode */
export function gcodeFileName(modelName: string): string {
  const base = modelName.replace(/\.[^.]+$/, '') || 'model';
  return `${base}.gcode`;
}

/** Engine stage text -> sentence case, e.g. "GENERATING SUPPORT" -> "Generating support". */
export function stageLabel(stage: string): string {
  const s = stage.trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

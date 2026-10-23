/** 5025 -> "1 h 24 min"; 59 -> "1 min". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '–';
  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** To the second, like desktop's time estimates: 3007 -> "50m 7s", 5045 -> "1h 24m 5s", 19 -> "19s". */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '–';
  const s = Math.round(seconds);
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  return [h && `${h}h`, (h || m) && `${m}m`, `${r}s`].filter(Boolean).join(' ');
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

/** Engine stage text -> sentence case, e.g. "GENERATING SUPPORT" -> "Generating support" (G-code keeps its capital). */
export function stageLabel(stage: string): string {
  const s = stage.trim().toLowerCase().replace(/\bg-code\b/g, 'G-code');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** A byte count for download progress, e.g. "12.4 MB". */
export function formatMegabytes(bytes: number): string {
  const mb = bytes / 1e6;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** An engine message as a sentence: "the letters can't be set" -> "The letters can't be set." */
export function sentence(message: string): string {
  const s = message.trim();
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1) + (/[.!?)]$/.test(s) ? '' : '.');
}

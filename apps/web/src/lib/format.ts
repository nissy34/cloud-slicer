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

/** 16332 -> "4h32m12s", as desktop writes {print_time} into file names. */
export function timeDhms(seconds: number): string {
  let left = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const parts: string[] = [];
  for (const [unit, size] of [['d', 86_400], ['h', 3600], ['m', 60]] as const) {
    const n = Math.floor(left / size);
    left -= n * size;
    if (n || parts.length) parts.push(`${n}${unit}`);
  }
  parts.push(`${left}s`);
  return parts.join('');
}

/**
 * The G-code file name as desktop makes it, from the process preset's
 * filename_format (the U1's: "{input_filename_base}_{filament_type[0]}_{print_time}.gcode").
 * {input_filename_base} is the model or project name (with "-plateN" on a
 * project with several plates), {print_time} the estimate, and any other
 * {key} or {key[i]} the setting's value. No format: "<name>.gcode".
 */
export function outputFileName(format: string | undefined, base: string, config: Record<string, string>, printSeconds: number): string {
  const stem = base.replace(/\.[^.]+$/, '') || 'model';
  if (!format?.trim()) return `${stem}.gcode`;
  const name = format
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\{\s*([a-z_]\w*)\s*(?:\[\s*(\d+)\s*\])?\s*\}/gi, (_, key: string, index?: string) => {
      if (key === 'input_filename_base') return stem;
      if (key === 'print_time') return timeDhms(printSeconds);
      const value = config[key] ?? '';
      const list = value.split(value.includes(';') ? ';' : ',').map((v) => v.trim().replace(/^"|"$/g, ''));
      return list[index ? Number(index) : 0] ?? '';
    })
    // A setting with no value leaves "a__b" or "_.gcode": tidy those up.
    .replace(/([_-])[_-]+/g, '$1')
    .replace(/[_-]+(\.[^.]+)$/, '$1')
    .replace(/[_.-]+$/, '');
  return /\.(gcode|bgcode)$/i.test(name) ? name : `${name || stem}.gcode`;
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

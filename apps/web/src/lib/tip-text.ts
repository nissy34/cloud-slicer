/** A tip without its keyboard shortcut ("Copy (Ctrl+C)" → "Copy"), for a touch screen. */
export function withoutKeys(text: string): string {
  return text.replace(/\s*\((?:Ctrl|Shift|Alt|Del|Esc|Enter|Tab|F\d+)\b[^)]*\)/g, '').trim();
}

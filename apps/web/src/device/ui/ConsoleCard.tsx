import { useEffect, useRef, useState } from 'react';
import { useDevice } from '../../state/device';
import { activeFilterCount, BUILT_IN_FILTERS, isHidden, readConsoleFilters, type ConsoleFilters } from '../console-filters';
import { Card } from './parts';

/** Filters are a choice per computer, the same for every printer. */
const FILTERS_KEY = 'cloud-slicer:console-filters:v1';

function loadFilters(): ConsoleFilters {
  try {
    return readConsoleFilters(JSON.parse(localStorage.getItem(FILTERS_KEY) ?? 'null'));
  } catch {
    return readConsoleFilters(null);
  }
}

function saveFilters(f: ConsoleFilters) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    // storage unavailable: filters last for this visit only
  }
}

export function ConsoleCard() {
  const lines = useDevice((s) => s.console);
  const run = useDevice((s) => s.run);
  const [text, setText] = useState('');
  const [filters, setFiltersState] = useState(loadFilters);
  const [editing, setEditing] = useState(false);
  const [word, setWord] = useState('');
  const [adding, setAdding] = useState(false);
  const log = useRef<HTMLOListElement>(null);
  const shown = lines.filter((l) => !isHidden(l, filters));
  const hidden = lines.length - shown.length;
  const active = activeFilterCount(filters);
  const setFilters = (f: ConsoleFilters) => {
    setFiltersState(f);
    saveFilters(f);
  };
  const addWord = () => {
    const w = word.trim();
    if (!w) return;
    setWord('');
    setAdding(false);
    if (!filters.custom.some((c) => c.text.toLowerCase() === w.toLowerCase())) setFilters({ ...filters, custom: [...filters.custom, { text: w, on: true }] });
  };
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [lines, filters]);
  return (
    <Card
      title="Console"
      className="dv-console-card"
      testId="console-card"
      actions={
        <button className="dv-link" onClick={() => setEditing(!editing)} aria-expanded={editing} data-testid="console-filter-button">
          {editing ? 'Done' : active ? `Filters (${active})` : 'Filters'}
        </button>
      }
    >
      {editing && (
        <div className="dv-console-filters" role="group" aria-label="Hide these lines" data-testid="console-filters">
          <span className="dv-console-filters-title">Hide these lines</span>
          <div className="dv-filter-chips">
            {BUILT_IN_FILTERS.map((b) => (
              <button key={b.key} className="dv-filter-chip" aria-pressed={filters[b.key]} title={`Hide lines like: ${b.example}`} onClick={() => setFilters({ ...filters, [b.key]: !filters[b.key] })}>
                {b.label}
              </button>
            ))}
            {filters.custom.map((c, i) => (
              <span key={c.text} className="dv-filter-chip dv-filter-word" data-on={c.on}>
                <button aria-pressed={c.on} title={`Hide lines containing “${c.text}”`} onClick={() => setFilters({ ...filters, custom: filters.custom.map((x, j) => (j === i ? { ...x, on: !x.on } : x)) })}>
                  “{c.text}”
                </button>
                <button className="dv-filter-remove" aria-label={`Remove the “${c.text}” filter`} title="Remove" onClick={() => setFilters({ ...filters, custom: filters.custom.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </span>
            ))}
            {adding ? (
              <form
                className="dv-filter-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  addWord();
                }}
              >
                <input
                  autoFocus
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && (setWord(''), setAdding(false))}
                  onBlur={() => !word.trim() && setAdding(false)}
                  placeholder="Hide lines containing…"
                  aria-label="Hide lines containing"
                  spellCheck={false}
                  autoCapitalize="off"
                />
                <button className="dv-filter-chip" type="submit" disabled={!word.trim()}>
                  Add
                </button>
              </form>
            ) : (
              <button className="dv-filter-chip dv-filter-new" onClick={() => setAdding(true)}>
                + Add
              </button>
            )}
          </div>
          <p className="muted">Tap a chip to switch it. What you send and errors always show.</p>
        </div>
      )}
      <ol className="dv-console" ref={log} aria-live="polite">
        {shown.map((l, i) => (
          <li key={i} className={l.kind}>
            {l.kind === 'command' ? '› ' : ''}
            {l.text}
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <p className="dv-console-hidden muted" data-testid="console-hidden">
          {hidden === 1 ? '1 line hidden by filters' : `${hidden} lines hidden by filters`}
        </p>
      )}
      <form
        className="dv-console-input"
        onSubmit={(e) => {
          e.preventDefault();
          const script = text.trim();
          if (!script) return;
          setText('');
          void run(script);
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Send G-code, e.g. M115" aria-label="G-code command" spellCheck={false} autoCapitalize="off" />
        <button className="secondary" type="submit">
          Send
        </button>
      </form>
    </Card>
  );
}

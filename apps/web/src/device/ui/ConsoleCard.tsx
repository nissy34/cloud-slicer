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
        <fieldset className="dv-console-filters" data-testid="console-filters">
          <legend>Hide these lines</legend>
          {BUILT_IN_FILTERS.map((b) => (
            <label key={b.key} title={b.example}>
              <input type="checkbox" checked={filters[b.key]} onChange={(e) => setFilters({ ...filters, [b.key]: e.target.checked })} />
              {b.label}
            </label>
          ))}
          {filters.custom.map((c, i) => (
            <span key={c.text} className="dv-console-word">
              <label>
                <input type="checkbox" checked={c.on} onChange={(e) => setFilters({ ...filters, custom: filters.custom.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)) })} />
                Containing “{c.text}”
              </label>
              <button className="dv-link" aria-label={`Remove the “${c.text}” filter`} title="Remove" onClick={() => setFilters({ ...filters, custom: filters.custom.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </span>
          ))}
          <form
            className="dv-console-add"
            onSubmit={(e) => {
              e.preventDefault();
              addWord();
            }}
          >
            <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="Hide lines containing…" aria-label="Hide lines containing" spellCheck={false} autoCapitalize="off" />
            <button className="secondary" type="submit" disabled={!word.trim()}>
              Add
            </button>
          </form>
          <p className="muted">What you send and errors always show.</p>
        </fieldset>
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

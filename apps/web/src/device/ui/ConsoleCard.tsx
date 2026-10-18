import { useEffect, useRef, useState } from 'react';
import { useDevice } from '../../state/device';
import { Card } from './parts';

export function ConsoleCard() {
  const lines = useDevice((s) => s.console);
  const run = useDevice((s) => s.run);
  const [text, setText] = useState('');
  const log = useRef<HTMLOListElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [lines]);
  return (
    <Card title="Console" className="dv-console-card" testId="console-card">
      <ol className="dv-console" ref={log} aria-live="polite">
        {lines.map((l, i) => (
          <li key={i} className={l.kind}>
            {l.kind === 'command' ? '› ' : ''}
            {l.text}
          </li>
        ))}
      </ol>
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

import { useEffect } from 'react';
import { create } from 'zustand';

interface Question {
  title: string;
  text: string;
  /** The button that goes ahead, e.g. "Discard changes". */
  action: string;
  answer(yes: boolean): void;
}

const useAsk = create<{ question: Question | null }>(() => ({ question: null }));

/** The app's own yes/no question in place of the browser's confirm(): resolves true when the person goes ahead. */
export function ask(q: Omit<Question, 'answer'>): Promise<boolean> {
  useAsk.getState().question?.answer(false);
  return new Promise((resolve) =>
    useAsk.setState({
      question: {
        ...q,
        answer: (yes) => {
          useAsk.setState({ question: null });
          resolve(yes);
        },
      },
    }),
  );
}

/** Calls onClose on Escape anywhere on the page while active (focus may be outside the dialog). */
export function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [active, onClose]);
}

export function AskDialog() {
  const q = useAsk((s) => s.question);
  useEffect(() => {
    if (!q) return;
    // Captured on window so a dialog underneath doesn't close on the same Escape.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      q.answer(false);
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [q]);
  if (!q) return null;
  return (
    <div className="dialog-backdrop ask-backdrop" onClick={(e) => e.target === e.currentTarget && q.answer(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="ask-title" aria-describedby="ask-text" data-testid="ask-dialog">
        <h2 id="ask-title">{q.title}</h2>
        <p id="ask-text">{q.text}</p>
        <div className="dialog-actions">
          <button className="secondary" onClick={() => q.answer(false)}>
            Cancel
          </button>
          <button className="primary" autoFocus onClick={() => q.answer(true)}>
            {q.action}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Asks before unsaved changes to the open project are thrown away; true straight away when there are none. */
export function discardOk(dirty: boolean, name: string): Promise<boolean> {
  if (!dirty) return Promise.resolve(true);
  return ask({ title: 'Discard unsaved changes?', text: `“${name}” has changes that aren't saved yet.`, action: 'Discard changes' });
}

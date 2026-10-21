import { useEffect } from 'react';
import { create } from 'zustand';
import { setLeaveQuestions } from '../state/projects';

interface Question {
  title: string;
  text: string;
  /** The button that goes ahead, e.g. "Discard changes". */
  action: string;
  /** A third button between Cancel and the action, e.g. "Don't save". */
  other?: string;
  answer(choice: 'action' | 'other' | 'cancel'): void;
}

const useAsk = create<{ question: Question | null }>(() => ({ question: null }));

function askChoice(q: Omit<Question, 'answer'>): Promise<'action' | 'other' | 'cancel'> {
  useAsk.getState().question?.answer('cancel');
  return new Promise((resolve) =>
    useAsk.setState({
      question: {
        ...q,
        answer: (choice) => {
          useAsk.setState({ question: null });
          resolve(choice);
        },
      },
    }),
  );
}

/** The app's own yes/no question in place of the browser's confirm(): resolves true when the person goes ahead. */
export async function ask(q: Omit<Question, 'answer' | 'other'>): Promise<boolean> {
  return (await askChoice(q)) === 'action';
}

/** Word's question when a new project or the draft is about to be replaced: Save, Don't save or Cancel. */
export async function askSave(name: string): Promise<'save' | 'discard' | 'cancel'> {
  const choice = await askChoice({
    title: `Save “${name}”?`,
    text: "It isn't in your online projects yet. Don't save throws it away.",
    action: 'Save',
    other: "Don't save",
  });
  return choice === 'action' ? 'save' : choice === 'other' ? 'discard' : 'cancel';
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
      q.answer('cancel');
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [q]);
  if (!q) return null;
  return (
    <div className="dialog-backdrop ask-backdrop" onClick={(e) => e.target === e.currentTarget && q.answer('cancel')}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="ask-title" aria-describedby="ask-text" data-testid="ask-dialog">
        <h2 id="ask-title">{q.title}</h2>
        <p id="ask-text">{q.text}</p>
        <div className={q.other ? 'dialog-actions wrap' : 'dialog-actions'}>
          <button className="secondary" onClick={() => q.answer('cancel')}>
            Cancel
          </button>
          {q.other && (
            <button className="secondary" onClick={() => q.answer('other')}>
              {q.other}
            </button>
          )}
          <button className="primary" autoFocus onClick={() => q.answer('action')}>
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

/** Files were shared to the app while a draft or a project from another device waits: add them to it, or start new. */
async function askAddTo(what: string, project: string): Promise<'add' | 'new' | 'cancel'> {
  const choice = await askChoice({
    title: `Open ${what}`,
    text: `You were working on “${project}”. Add it there, or start a new project with it?`,
    action: 'New project',
    other: `Add to ${project}`,
  });
  return choice === 'action' ? 'new' : choice === 'other' ? 'add' : 'cancel';
}

setLeaveQuestions({ discardOk, askSave, askAddTo });

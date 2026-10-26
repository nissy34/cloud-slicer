import { useState } from 'react';
import { create } from 'zustand';
import { Dialog } from './Dialog';

export type SimplifyAnswer = 'simplify' | 'open' | 'cancel';

interface Question {
  text: string;
  painted: boolean;
  answer(choice: SimplifyAnswer, dontAsk: boolean): void;
}

const useQuestion = create<{ question: Question | null }>(() => ({ question: null }));

/**
 * Asks, on a phone or tablet, whether to simplify a heavy model before the 3D
 * view draws it. Resolves with the choice and whether to stop asking on this device.
 */
export function askSimplifyFirst(text: string, painted: boolean): Promise<{ choice: SimplifyAnswer; dontAsk: boolean }> {
  useQuestion.getState().question?.answer('cancel', false);
  return new Promise((resolve) =>
    useQuestion.setState({
      question: {
        text,
        painted,
        answer: (choice, dontAsk) => {
          useQuestion.setState({ question: null });
          resolve({ choice, dontAsk });
        },
      },
    }),
  );
}

export function SimplifyFirstDialog() {
  const q = useQuestion((s) => s.question);
  const [dontAsk, setDontAsk] = useState(false);
  if (!q) return null;
  const answer = (choice: SimplifyAnswer) => {
    setDontAsk(false);
    q.answer(choice, dontAsk && choice !== 'cancel');
  };
  return (
    <Dialog
      title="Simplify this model first?"
      role="alertdialog"
      describedBy="simplify-first-text"
      testId="simplify-first"
      onClose={() => answer('cancel')}
      footer={
        <>
          <button className="secondary" onClick={() => answer('cancel')}>
            Cancel
          </button>
          <button className="secondary" onClick={() => answer('open')}>
            Open as is
          </button>
          <button className="primary" autoFocus onClick={() => answer('simplify')}>
            Simplify
          </button>
        </>
      }
    >
      <p id="simplify-first-text">{q.text}</p>
      {q.painted && <p className="warn">Simplifying removes its painting.</p>}
      <label className="check">
        <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
        <span>Don't ask again on this device</span>
      </label>
    </Dialog>
  );
}

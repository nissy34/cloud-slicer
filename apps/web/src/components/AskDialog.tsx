import { create } from 'zustand';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { Dialog } from './Dialog';
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

/** Word's question when a new project is about to be replaced: Save, Don't save or Cancel. */
export async function askSave(name: string): Promise<'save' | 'discard' | 'cancel'> {
  const choice = await askChoice({
    title: i18n.t('askDialog.saveTitle', { name }),
    text: i18n.t('askDialog.saveText'),
    action: i18n.t('askDialog.save'),
    other: i18n.t('askDialog.dontSave'),
  });
  return choice === 'action' ? 'save' : choice === 'other' ? 'discard' : 'cancel';
}

export function AskDialog() {
  const { t } = useTranslation();
  const q = useAsk((s) => s.question);
  if (!q) return null;
  return (
    <Dialog
      key={q.title}
      title={q.title}
      role="alertdialog"
      describedBy="ask-text"
      testId="ask-dialog"
      onClose={() => q.answer('cancel')}
      footer={
        <>
          <button className="secondary" onClick={() => q.answer('cancel')}>
            {t('common.cancel')}
          </button>
          {q.other && (
            <button className="secondary" onClick={() => q.answer('other')}>
              {q.other}
            </button>
          )}
          <button className="primary" autoFocus onClick={() => q.answer('action')}>
            {q.action}
          </button>
        </>
      }
    >
      <p id="ask-text">{q.text}</p>
    </Dialog>
  );
}

/** Asks before unsaved changes to the open project are thrown away; true straight away when there are none. */
export function discardOk(dirty: boolean, name: string): Promise<boolean> {
  if (!dirty) return Promise.resolve(true);
  return ask({ title: i18n.t('askDialog.discardTitle'), text: i18n.t('open.unsavedChanges', { name }), action: i18n.t('askDialog.discard') });
}

/** Files were shared to the app while a project from before waits: add them to it, or start new. */
async function askAddTo(what: string, project: string): Promise<'add' | 'new' | 'cancel'> {
  const choice = await askChoice({
    title: i18n.t('askDialog.openTitle', { what }),
    text: i18n.t('askDialog.addToText', { project }),
    action: i18n.t('askDialog.newProject'),
    other: i18n.t('askDialog.addTo', { project }),
  });
  return choice === 'action' ? 'new' : choice === 'other' ? 'add' : 'cancel';
}

setLeaveQuestions({ discardOk, askSave, askAddTo });

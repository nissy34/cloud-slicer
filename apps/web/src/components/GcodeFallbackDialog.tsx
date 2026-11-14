import { Trans, useTranslation } from 'react-i18next';
import { engineName } from '../lib/engines';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';

/**
 * Slicing stopped on G-code another slicer wrote (Bambu Studio 2.5's, say):
 * slice with the engine's own G-code for the printer instead, or see the error.
 */
export function GcodeFallbackDialog() {
  const { t } = useTranslation();
  const question = useSlicer((s) => s.gcodeFallback);
  const flavor = useSlicer((s) => s.flavor);
  if (!question) return null;
  const { answerGcodeFallback } = useSlicer.getState();
  const engine = engineName(flavor);
  return (
    <Dialog
      title={t('gcodeFallback.title', { engine })}
      testId="gcode-fallback"
      onClose={() => void answerGcodeFallback(false)}
      footer={
        <>
          <button className="secondary" onClick={() => void answerGcodeFallback(false)}>
            {t('common.cancel')}
          </button>
          <button className="primary" autoFocus onClick={() => void answerGcodeFallback(true)}>
            {t('gcodeFallback.yes')}
          </button>
        </>
      }
    >
      <p>
        <Trans i18nKey={'gcodeFallback.body'} values={{ app: question.app, engine, printer: question.printer }} components={{ b: <b /> }} />
      </p>
    </Dialog>
  );
}

// "Which printers work": in plain sight at the top of Add printer (table folded) and on the
// empty Device tab. One line names the kinds of printer the Device tab reaches;
// "See what each can do" opens a table of what works on each (open on wide
// screens). It says just as plainly that slicing doesn't depend on it.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PHONE } from '../../lib/breakpoints';
import { WORKS_FEATURES, WORKS_WITH } from '../brands';

/** folded: the table starts closed (in the Add a printer window, so its steps come first). */
export function WorksWith({ folded = false }: { folded?: boolean }) {
  const { t } = useTranslation();
  const [open] = useState(() => {
    if (folded) return false;
    try {
      return !window.matchMedia(PHONE).matches;
    } catch {
      return true;
    }
  });
  return (
    <div className="dv-works" data-testid="works-with">
      <p>
        <strong>{t('deviceScreen.worksWithLead')}</strong> {t('deviceScreen.worksWithList')}
      </p>
      <p className="dv-works-slicing">✓ {t('deviceScreen.worksSlicing')}</p>
      <details open={open}>
        <summary>{t('deviceScreen.worksSee')}</summary>
        <div className="dv-works-scroll">
          <table className="dv-works-table">
            <thead>
              <tr>
                <th scope="col">{t('deviceScreen.printer')}</th>
                {WORKS_FEATURES.map((f) => (
                  <th key={f.name} scope="col" aria-label={t(f.name)}>
                    {f.short ? (
                      <>
                        <span className="dv-works-long">{t(f.name)}</span>
                        <span className="dv-works-short">{t(f.short)}</span>
                      </>
                    ) : (
                      t(f.name)
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WORKS_WITH.map((w) => (
                <tr key={w.name}>
                  <th scope="row">
                    {t(w.name)}
                    <span className="muted"> ({t(w.examples)})</span>
                  </th>
                  {w.can.map((yes, i) => (
                    <td key={WORKS_FEATURES[i].name} className={yes ? 'yes' : 'no'} aria-label={yes ? t('deviceScreen.yes') : t('deviceScreen.no')}>
                      {yes ? '✓' : '–'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

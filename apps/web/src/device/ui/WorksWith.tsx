// "Which printers work": in plain sight at the top of Add printer and on the
// empty Device tab. One line names the kinds of printer the Device tab reaches;
// "See what each can do" opens a table of what works on each (open on wide
// screens). It says just as plainly that slicing doesn't depend on it.
import { useState } from 'react';
import { PHONE } from '../../lib/breakpoints';
import { WORKS_FEATURES, WORKS_WITH } from '../brands';

export function WorksWith() {
  const [open] = useState(() => {
    try {
      return !window.matchMedia(PHONE).matches;
    } catch {
      return true;
    }
  });
  return (
    <div className="dv-works" data-testid="works-with">
      <p>
        <strong>Sending prints and controlling the printer works with</strong> Klipper printers (Snapmaker U1, Voron, Qidi, Sovol…), Prusa with PrusaLink, OctoPrint, the Elegoo Centauri Carbon, and Bambu Lab printers.
      </p>
      <p className="dv-works-slicing">✓ Slicing works for every printer in the slicer's printer list, listed here or not: download the file to print it.</p>
      <details open={open}>
        <summary>See what each can do</summary>
        <div className="dv-works-scroll">
          <table className="dv-works-table">
            <thead>
              <tr>
                <th scope="col">Printer</th>
                {WORKS_FEATURES.map((f) => (
                  <th key={f.name} scope="col" aria-label={f.name}>
                    {f.short ? (
                      <>
                        <span className="dv-works-long">{f.name}</span>
                        <span className="dv-works-short">{f.short}</span>
                      </>
                    ) : (
                      f.name
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WORKS_WITH.map((w) => (
                <tr key={w.name}>
                  <th scope="row">
                    {w.name}
                    <span className="muted"> ({w.examples})</span>
                  </th>
                  {w.can.map((yes, i) => (
                    <td key={WORKS_FEATURES[i].name} className={yes ? 'yes' : 'no'} aria-label={yes ? 'Yes' : 'No'}>
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

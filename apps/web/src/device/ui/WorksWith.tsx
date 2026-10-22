// "Which printers work": in plain sight at the top of Add printer and on the
// empty Device tab. One line names the kinds of printer the Device tab reaches;
// "See what each can do" opens a table of what works on each (open on wide
// screens). It says just as plainly that slicing doesn't depend on it.
import { useState } from 'react';
import { WORKS_FEATURES, WORKS_WITH } from '../brands';

export function WorksWith() {
  const [open] = useState(() => {
    try {
      return window.matchMedia('(min-width: 700px)').matches;
    } catch {
      return true;
    }
  });
  return (
    <div className="dv-works" data-testid="works-with">
      <p>
        <strong>Sending prints and controlling the printer works with</strong> Klipper printers (Snapmaker U1, Voron, Qidi, Sovol…), Prusa with PrusaLink, OctoPrint, and the Elegoo Centauri Carbon.
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
                  <th key={f} scope="col">
                    {f}
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
                    <td key={WORKS_FEATURES[i]} className={yes ? 'yes' : 'no'} aria-label={yes ? 'Yes' : 'No'}>
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

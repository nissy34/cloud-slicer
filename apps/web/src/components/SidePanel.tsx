import { MATERIALS, PLATES, PRINTER, PROCESS } from '../lib/presets';
import { useSlicer } from '../state/store';

export function SidePanel() {
  const { material, plate, setMaterial, setPlate, model } = useSlicer();
  return (
    <aside className="panel">
      <section className="group">
        <h2>Printer</h2>
        <div className="preset">
          <div className="preset-name">{PRINTER.name}</div>
          <div className="preset-sub">{PRINTER.nozzle}</div>
        </div>
        <label className="field">
          <span>Build plate</span>
          <select value={plate} onChange={(e) => setPlate(e.target.value)}>
            {Object.entries(PLATES).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="group">
        <h2>Filament</h2>
        <label className="field">
          <span>Material</span>
          <select value={material} onChange={(e) => setMaterial(e.target.value)} aria-label="Material">
            {MATERIALS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="group">
        <h2>Process</h2>
        <div className="preset">
          <div className="preset-name">{PROCESS}</div>
          <div className="preset-sub">Full Orca settings arrive in phase 2</div>
        </div>
      </section>

      {model && (
        <section className="group">
          <h2>Object</h2>
          <div className="preset">
            <div className="preset-name" title={model.name}>
              {model.name}
            </div>
            <div className="preset-sub">
              {model.info.sizeX.toFixed(1)} × {model.info.sizeY.toFixed(1)} × {model.info.sizeZ.toFixed(1)} mm ·{' '}
              {model.info.triangleCount.toLocaleString()} triangles
            </div>
          </div>
        </section>
      )}
    </aside>
  );
}

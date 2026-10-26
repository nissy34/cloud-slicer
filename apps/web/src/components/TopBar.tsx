import { useState } from 'react';
import { AccountMenu } from '../account/AccountMenu';
import { useSlicer, type Tab } from '../state/store';
import { CalibrationDialog } from './CalibrationDialog';
import { PrintProgress } from './PrintHistory';
import { ProjectMenu } from './ProjectMenu';
import { ThemeMenu } from './ThemeMenu';

export const TABS: { id: Tab; label: string }[] = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'preview', label: 'Preview' },
  { id: 'device', label: 'Device' },
];

export function TopBar() {
  const tab = useSlicer((s) => s.tab);
  const setTab = useSlicer((s) => s.setTab);
  const ready = useSlicer((s) => s.engine === 'ready');
  const [calibrating, setCalibrating] = useState(false);
  const engineInfo = useSlicer((s) => s.engineInfo);
  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-mark" src="/icon.svg" alt="" />
        Cloud Slicer
      </div>
      <ProjectMenu />
      <PrintProgress />
      {engineInfo && (
        <span className="tag engine-badge" title={`Slicing with ${engineInfo.name} ${engineInfo.version}`}>
          {engineInfo.name} {engineInfo.version}
        </span>
      )}
      <nav className="tabs" role="tablist" aria-label="Workspace">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'tab active' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <button className="ghost calib-button" disabled={!ready} aria-label="Calibration" title="Calibration" onClick={() => setCalibrating(true)}>
        <CalibrationIcon />
        <span className="calib-label">Calibration</span>
      </button>
      {calibrating && <CalibrationDialog onClose={() => setCalibrating(false)} />}
      <ThemeMenu />
      <AccountMenu />
    </header>
  );
}

/** Desktop Orca's calibration icon (resources/images/calib_sf.svg), shown alone on a phone. */
function CalibrationIcon() {
  return (
    <svg className="calib-icon" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="square" strokeLinejoin="round">
      <path d="M7.5,15.5h-3a1,1,0,0,1-1-1v-3M15.5,11.5v3a1,1,0,0,1-1,1h-3M11.5,3.5h3a1,1,0,0,1,1,1v3M3.5,7.5v-3a1,1,0,0,1,1-1h3" />
      <path d="M9.5,3.5v2M9.5,8.5v2M9.5,13.5v2M15.5,9.5h-2M5.5,9.5h-2M10.5,9.5h-2" />
    </svg>
  );
}

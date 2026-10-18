import { useState } from 'react';
import { AccountMenu } from '../account/AccountMenu';
import { useSlicer, type Tab } from '../state/store';
import { CalibrationDialog } from './CalibrationDialog';
import { ProjectMenu } from './ProjectMenu';
import { ThemeMenu } from './ThemeMenu';

const TABS: { id: Tab; label: string }[] = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'preview', label: 'Preview' },
  { id: 'device', label: 'Device' },
];

function CalibrationIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

export function TopBar() {
  const tab = useSlicer((s) => s.tab);
  const setTab = useSlicer((s) => s.setTab);
  const ready = useSlicer((s) => s.engine === 'ready');
  const [calibrating, setCalibrating] = useState(false);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        Cloud Slicer
      </div>
      <ProjectMenu />
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
      <button className="ghost calibration-button" disabled={!ready} onClick={() => setCalibrating(true)} title="Calibration">
        <CalibrationIcon />
        <span className="topbar-label">Calibration</span>
      </button>
      {calibrating && <CalibrationDialog onClose={() => setCalibrating(false)} />}
      <ThemeMenu />
      <AccountMenu />
    </header>
  );
}

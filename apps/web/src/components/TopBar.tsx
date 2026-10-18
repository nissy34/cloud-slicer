import { useState } from 'react';
import { AccountMenu } from '../account/AccountMenu';
import { useSlicer, type Tab } from '../state/store';
import { CalibrationDialog } from './CalibrationDialog';
import { ProjectMenu } from './ProjectMenu';

const TABS: { id: Tab; label: string }[] = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'preview', label: 'Preview' },
  { id: 'device', label: 'Device' },
];

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
      <button className="ghost" disabled={!ready} onClick={() => setCalibrating(true)}>
        Calibration
      </button>
      {calibrating && <CalibrationDialog onClose={() => setCalibrating(false)} />}
      <AccountMenu />
    </header>
  );
}

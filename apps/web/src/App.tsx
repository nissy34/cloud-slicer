import { useEffect } from 'react';
import { ImportPresetsDialog } from './account/ImportPresets';
import { PresetSettingsDialog } from './components/PresetSettingsDialog';
import { SettingsPromptDialog } from './components/SettingsPrompt';
import { AskDialog } from './components/AskDialog';
import { ActionBar } from './components/ActionBar';
import { ConvertDialog } from './components/ConvertDialog';
import { GcodeFallbackDialog } from './components/GcodeFallbackDialog';
import { OpenProjectDialog } from './components/OpenProjectDialog';
import { SetupWizard } from './components/SetupWizard';
import { OpenModel } from './components/OpenModel';
import { Preview } from './components/Preview';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Viewport } from './components/Viewport';
import { LoadingOverlay } from './components/LoadingOverlay';
import { DeviceScreen } from './device';
import { AdminScreen } from './components/AdminScreen';
import { ContinueCard, ViewOnlyBanner } from './components/ContinueCard';
import { useProjects } from './state/projects';
import { useSlicer } from './state/store';

export function App() {
  const tab = useSlicer((s) => s.tab);
  const viewOnly = useProjects((s) => s.elsewhere !== null);
  // View only (the project is being edited on another device): editing keys do nothing.
  useEffect(() => {
    if (!viewOnly) return;
    const block = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('.dialog, .view-only-banner, .account, .menu-pop')) return;
      if (e.key === 'Escape' || e.key === 'Tab') return;
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.key === 'Delete' || e.key === 'Backspace') e.preventDefault();
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, [viewOnly]);
  return (
    <div className={viewOnly ? 'app view-only' : 'app'}>
      <TopBar />
      <ConvertDialog />
      <GcodeFallbackDialog />
      <OpenProjectDialog />
      <SetupWizard />
      <ImportPresetsDialog />
      <PresetSettingsDialog />
      <SettingsPromptDialog />
      <AskDialog />
      {tab !== 'device' && tab !== 'admin' && (
        <div className="body">
          <Sidebar />
          <main className="main">
            <ViewOnlyBanner />
            {tab === 'prepare' && <ContinueCard />}
            {tab === 'prepare' ? (
              <OpenModel>
                <Viewport />
              </OpenModel>
            ) : (
              <div className="workspace">
                <Preview />
                <LoadingOverlay />
              </div>
            )}
            <ActionBar />
          </main>
        </div>
      )}
      {tab === 'device' && <DeviceScreen />}
      {tab === 'admin' && <AdminScreen />}
    </div>
  );
}

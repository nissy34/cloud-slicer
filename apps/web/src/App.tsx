import { useEffect, type CSSProperties } from 'react';
import { ImportPresetsDialog } from './account/ImportPresets';
import { PresetSettingsDialog } from './components/PresetSettingsDialog';
import { SettingsPromptDialog } from './components/SettingsPrompt';
import { AskDialog } from './components/AskDialog';
import { SimplifyFirstDialog } from './components/SimplifyFirstDialog';
import { ActionBar } from './components/ActionBar';
import { BottomTabs } from './components/BottomTabs';
import { ConvertDialog } from './components/ConvertDialog';
import { GcodeFallbackDialog } from './components/GcodeFallbackDialog';
import { OpenProjectDialog } from './components/OpenProjectDialog';
import { PlateSettingsDialog } from './components/PlateSettingsDialog';
import { SetupWizard } from './components/SetupWizard';
import { OpenModel } from './components/OpenModel';
import { Preview } from './components/Preview';
import { Sidebar } from './components/Sidebar';
import { SidebarResize, SidebarToggle } from './components/SidebarFrame';
import { useSidebar } from './state/sidebar';
import { TopBar } from './components/TopBar';
import { Viewport } from './components/Viewport';
import { LoadingOverlay } from './components/LoadingOverlay';
import { DeviceScreen } from './device';
import { AdminScreen } from './components/AdminScreen';
import { Notices } from './components/Notices';
import { PrintHistoryDialog } from './components/PrintHistory';
import './state/prints';
import { useProjects } from './state/projects';
import { useSlicer } from './state/store';

export function App() {
  const tab = useSlicer((s) => s.tab);
  const viewOnly = useProjects((s) => s.elsewhere !== null);
  const sideWidth = useSidebar((s) => s.width);
  const sideHidden = useSidebar((s) => s.hidden);
  // View only (the project is being edited on another device): editing keys do nothing.
  useEffect(() => {
    if (!viewOnly) return;
    const block = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('.win, .notice, .account, .menu-pop')) return;
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
      <PlateSettingsDialog />
      <SetupWizard />
      <ImportPresetsDialog />
      <PresetSettingsDialog />
      <SettingsPromptDialog />
      <AskDialog />
      <SimplifyFirstDialog />
      <PrintHistoryDialog />
      {tab !== 'device' && tab !== 'admin' && (
        <div className={sideHidden ? 'body side-hidden' : 'body'} style={{ '--side-w': `${sideWidth}px` } as CSSProperties}>
          <Sidebar />
          <SidebarResize />
          <main className="main">
            <SidebarToggle />
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
      <BottomTabs />
      <Notices />
    </div>
  );
}

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
import { useSlicer } from './state/store';

export function App() {
  const tab = useSlicer((s) => s.tab);
  return (
    <div className="app">
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

import { ActionBar } from './components/ActionBar';
import { ComingSoon } from './components/ComingSoon';
import { ConvertDialog } from './components/ConvertDialog';
import { OpenModel } from './components/OpenModel';
import { Preview } from './components/Preview';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Viewport } from './components/Viewport';
import { useSlicer } from './state/store';

export function App() {
  const tab = useSlicer((s) => s.tab);
  return (
    <div className="app">
      <TopBar />
      <ConvertDialog />
      {tab !== 'device' && (
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
              </div>
            )}
            <ActionBar />
          </main>
        </div>
      )}
      {tab === 'device' && (
        <ComingSoon title="Device" phase={4}>
          Live status, camera, filament slots, and send and print for your printers.
        </ComingSoon>
      )}
    </div>
  );
}

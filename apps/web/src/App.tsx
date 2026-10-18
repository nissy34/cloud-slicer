import { ActionBar } from './components/ActionBar';
import { OpenModel } from './components/OpenModel';
import { Preview } from './components/Preview';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Viewport } from './components/Viewport';
import { DeviceScreen } from './device';
import { useSlicer } from './state/store';

export function App() {
  const tab = useSlicer((s) => s.tab);
  return (
    <div className="app">
      <TopBar />
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
      {tab === 'device' && <DeviceScreen />}
    </div>
  );
}

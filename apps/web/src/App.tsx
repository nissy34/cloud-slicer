import { ActionBar } from './components/ActionBar';
import { ComingSoon } from './components/ComingSoon';
import { OpenModel } from './components/OpenModel';
import { SidePanel } from './components/SidePanel';
import { TopBar } from './components/TopBar';
import { Viewport } from './components/Viewport';
import { useSlicer } from './state/store';

export function App() {
  const tab = useSlicer((s) => s.tab);
  return (
    <div className="app">
      <TopBar />
      {tab === 'prepare' && (
        <div className="body">
          <SidePanel />
          <main className="main">
            <OpenModel>
              <Viewport />
            </OpenModel>
            <ActionBar />
          </main>
        </div>
      )}
      {tab === 'preview' && (
        <ComingSoon title="Preview" phase={2}>
          The layer-by-layer G-code preview, with legends for feature, speed, flow, temperature and tool.
        </ComingSoon>
      )}
      {tab === 'device' && (
        <ComingSoon title="Device" phase={4}>
          Live status, camera, filament slots, and send and print for your printers.
        </ComingSoon>
      )}
    </div>
  );
}

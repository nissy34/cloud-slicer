import { job as jobOf } from '../device/status';
import { useDevice } from '../state/device';
import { useSlicer } from '../state/store';
import { TABS } from './TopBar';

const ICONS: Record<string, JSX.Element> = {
  prepare: <path d="M12 2.5 3.5 7.2v9.6l8.5 4.7 8.5-4.7V7.2zM3.5 7.2 12 12l8.5-4.8M12 12v9.5" />,
  preview: <path d="m12 3.5 8.5 4.5-8.5 4.5-8.5-4.5zM3.5 12.5l8.5 4.5 8.5-4.5M3.5 16.5l8.5 4.5 8.5-4.5" />,
  device: <path d="M4.5 3.5h15v17h-15zM4.5 8h15M9.5 8v4.5h5V8M7.5 17.5h9" />,
};

/** The Device tab's mark: the print's percentage while it prints, a red dot when the printer needs attention. */
function useDeviceMark(): { text: string; tone: 'busy' | 'warn' | 'error' } | null {
  // One string, so the tab re-renders only when the mark changes, not on every temperature report.
  const mark = useDevice((d) => {
    if (d.conn.state !== 'online') return '';
    const j = jobOf(d.objects);
    if (d.errors.length || j.state === 'error') return 'error:';
    if (j.state === 'paused') return 'warn:Paused';
    if (j.state === 'printing') return `busy:${Math.floor(j.progress * 100)}%`;
    return '';
  });
  if (!mark) return null;
  const [tone, text] = mark.split(':') as ['busy' | 'warn' | 'error', string];
  return { tone, text };
}

/** Phones: Prepare, Preview and Device as tabs at the bottom of the screen, under the Slice bar. */
export function BottomTabs() {
  const tab = useSlicer((s) => s.tab);
  const setTab = useSlicer((s) => s.setTab);
  const mark = useDeviceMark();
  return (
    <nav className="bottom-tabs" role="tablist" aria-label="Workspace" data-testid="bottom-tabs">
      {TABS.map((t) => (
        <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'bottom-tab active' : 'bottom-tab'} onClick={() => setTab(t.id)}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
            {ICONS[t.id]}
          </svg>
          {t.id === 'device' && mark && (
            <span className={`bottom-tab-mark ${mark.tone}`} data-testid="device-tab-mark" aria-label={mark.tone === 'error' ? 'The printer needs attention' : mark.text}>
              {mark.text}
            </span>
          )}
          {t.label}
        </button>
      ))}
    </nav>
  );
}

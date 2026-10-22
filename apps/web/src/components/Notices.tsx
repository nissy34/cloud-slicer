// Messages: one card look, all in one place at the bottom centre, above the
// Slice bar (or the bottom of the screen on the Device and Admin tabs). Short
// news goes away by itself after a few seconds; problems and messages with
// buttons stay until answered. Several stack, newest at the bottom, at most 3.
import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useDevice } from '../state/device';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { ContinueCard, ViewOnlyBanner } from './ContinueCard';
import { Notice, NOTICE_MS } from './Notice';

/** Goes away by itself after NOTICE_MS unless it is a problem. */
function useAutoHide(key: unknown, problem: boolean, hide: () => void) {
  useEffect(() => {
    if (!key || problem) return;
    const t = setTimeout(hide, NOTICE_MS);
    return () => clearTimeout(t);
  }, [key, problem]);
}

function ProjectMessage() {
  const message = useProjects((s) => s.message);
  const warn = useProjects((s) => s.messageWarn);
  const clear = () => {
    if (useProjects.getState().message === message) useProjects.getState().clearMessage();
  };
  useAutoHide(message, warn, clear);
  if (!message) return null;
  return <Notice tone={warn ? 'error' : 'ok'} title={message} onClose={clear} testId="project-message" />;
}

function DeviceMessage() {
  const toast = useDevice((s) => s.toast);
  const clear = () => {
    if (useDevice.getState().toast === toast) useDevice.setState({ toast: null });
  };
  useAutoHide(toast, Boolean(toast?.error), clear);
  if (!toast) return null;
  return <Notice tone={toast.error ? 'error' : 'ok'} title={toast.text} onClose={clear} testId="device-toast" />;
}

/** Above the Slice bar, centred on it; the bottom of the screen where there is none. */
function usePlace(): CSSProperties {
  const tab = useSlicer((s) => s.tab);
  const engine = useSlicer((s) => s.engine);
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const bar = tab === 'prepare' || tab === 'preview' ? document.querySelector<HTMLElement>('.actionbar') : null;
    if (!bar) return setStyle({});
    const place = () => {
      const r = bar.getBoundingClientRect();
      setStyle({ bottom: window.innerHeight - r.top + 12, left: r.left + r.width / 2, width: `min(440px, ${r.width - 24}px)` });
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(bar);
    window.addEventListener('resize', place);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [tab, engine]);
  return style;
}

export function Notices() {
  const tab = useSlicer((s) => s.tab);
  const slicer = tab !== 'device' && tab !== 'admin';
  const viewOnly = useProjects((s) => s.elsewhere !== null);
  const offer = useProjects((s) => s.offer !== null && !s.busy);
  const message = useProjects((s) => Boolean(s.message));
  const toast = useDevice((s) => s.toast !== null);
  const style = usePlace();
  const cards: [string, ReactNode][] = [];
  if (slicer && viewOnly) cards.push(['view-only', <ViewOnlyBanner />]);
  if (tab === 'prepare' && offer) cards.push(['continue', <ContinueCard />]);
  if (message) cards.push(['project', <ProjectMessage />]);
  if (toast) cards.push(['device', <DeviceMessage />]);
  return (
    <div className="notices" style={style} aria-live="polite">
      {cards.slice(-3).map(([key, card]) => (
        <div key={key} className="notice-slot">
          {card}
        </div>
      ))}
    </div>
  );
}

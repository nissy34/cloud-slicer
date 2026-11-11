import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDriveOpen } from '../account/useDriveOpen';
import { MODEL_EXTENSIONS } from '../lib/presets';
import { useLoading } from '../state/loading';
import { useProjects } from '../state/projects';
import { useSlicer } from '../state/store';
import { ask } from './AskDialog';
import { LoadingOverlay } from './LoadingOverlay';
import { ChooseBar } from './ChooseBar';
import { GroupMenu } from './GroupMenu';
import { ObjectMenu } from './ObjectMenu';
import { PlateMenu } from './PlateMenu';
import { Toolbar } from './Toolbar';

/** File button plus drag-and-drop anywhere over the workspace. */
export function OpenModel({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const openFiles = useProjects((s) => s.openFiles);
  const hasModel = useSlicer((s) => (s.project?.objects.length ?? 0) > 0);
  const plates = useSlicer((s) => s.project?.plates.length ?? 1);
  const { deletePlate } = useSlicer.getState();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const loading = useLoading() !== null;
  const driveOpen = useDriveOpen();

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void openFiles([...e.dataTransfer.files]);
  };

  return (
    <div
      className="workspace"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {children}
      <input
        ref={input}
        type="file"
        multiple
        accept={MODEL_EXTENSIONS.join(',')}
        hidden
        data-testid="model-input"
        onChange={(e) => {
          if (e.target.files?.length) void openFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
      {!hasModel && !dragging && !loading && (
        <div className="empty">
          <p>{t('open.drop')}</p>
          <div className="empty-buttons">
            <button className="primary" onClick={() => input.current?.click()}>
              {t('open.openModel')}
            </button>
            {driveOpen.offered && (
              <button
                className="secondary"
                disabled={!driveOpen.available}
                title={driveOpen.reason || undefined}
                data-testid="empty-open-from-drive"
                onClick={() => driveOpen.open()}
              >
                {t('open.fromDrive')}
              </button>
            )}
          </div>
          {/* Grayed out: say why in plain sight (a tooltip never shows on a phone). */}
          {driveOpen.offered && driveOpen.reason && (
            <p className="empty-note" data-testid="empty-drive-note">
              {driveOpen.reason}
            </p>
          )}
        </div>
      )}
      {/* Always there, so a first visit shows what the slicer can do; tools that need a model wait greyed out. */}
      <Toolbar onAdd={() => input.current?.click()} />
      {hasModel && (
        <>
          <div className="workspace-tools">
            {plates > 1 && (
              <button className="ghost" title={t('open.deletePlateTip')} onClick={() => void deletePlate()}>
                {t('open.deletePlate')}
              </button>
            )}
            <button
              className="ghost"
              onClick={async () => {
                const p = useProjects.getState();
                if (
                  !p.dirty ||
                  (await ask({
                    title: t('open.clearAsk'),
                    text: t('open.unsavedChanges', { name: p.current.name }),
                    action: t('open.clearAll'),
                  }))
                )
                  void p.newProject();
              }}
            >
              {t('open.clearAll')}
            </button>
          </div>
        </>
      )}
      {dragging && <div className="dropzone">{t('open.dropToAdd')}</div>}
      {hasModel && <ChooseBar />}
      <ObjectMenu />
      <GroupMenu />
      <PlateMenu onAdd={() => input.current?.click()} />
      <LoadingOverlay />
    </div>
  );
}

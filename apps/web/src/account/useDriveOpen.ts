// Open from Google Drive, for the Project menu and the empty plate: whether it
// can be used here, why not, and the click that opens Google's file window.
import { useTranslation } from 'react-i18next';
import { useAccount } from '../state/account';
import { useProjects } from '../state/projects';
import type { OpenMode } from '../state/store';
import { pickFromDrive } from './drive-picker';

export function useDriveOpen() {
  const { t } = useTranslation();
  const status = useAccount((s) => s.status);
  const user = useAccount((s) => s.user);
  const signedIn = status === 'signedIn';
  const drive = signedIn && user?.drive === true && user.projects !== false;
  // Still asking who is signed in: grayed, with no reason yet (no flash of "Sign in…").
  const reason =
    status === 'loading'
      ? ' '
      : !signedIn
        ? t('accountErrors.driveSignIn')
        : !drive
          ? user?.projects === false
            ? t('projectMenu.projectsOff')
            : t('accountErrors.driveConnectFirst')
          : !user?.drivePicker
            ? t('accountErrors.pickerNotSetUp')
            : '';
  return {
    /** The site has accounts at all (not a local build without them): otherwise there is nothing to show. */
    offered: status !== 'unavailable',
    available: !reason,
    /** Why it is grayed out ('' when it isn't). */
    reason: reason.trim(),
    /** Call straight from the click: the browser only allows Google's window from one. */
    open(mode?: OpenMode) {
      const p = useProjects.getState();
      pickFromDrive().then(
        (picked) => p.openFromDrive(picked, mode),
        (e: Error) => useProjects.setState({ message: e.message, messageWarn: true }),
      );
    },
  };
}

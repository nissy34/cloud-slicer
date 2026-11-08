// Open from Google Drive, for the Project menu and the empty plate: whether it
// can be used here, why not, and the click that opens Google's file window.
import { useAccount } from '../state/account';
import { useProjects } from '../state/projects';
import type { OpenMode } from '../state/store';
import { pickFromDrive } from './drive-picker';

export function useDriveOpen() {
  const status = useAccount((s) => s.status);
  const user = useAccount((s) => s.user);
  const signedIn = status === 'signedIn';
  const drive = signedIn && user?.drive === true && user.projects !== false;
  const reason = !signedIn
    ? 'Sign in with Google to open files from your Google Drive.'
    : !drive
      ? user?.projects === false
        ? 'Online projects are turned off for your account.'
        : 'Connect Google Drive in the account menu first.'
      : !user?.drivePicker
        ? "Open from Google Drive isn't set up on this site yet."
        : '';
  return {
    available: !reason,
    /** Why it is grayed out ('' when it isn't). */
    reason,
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

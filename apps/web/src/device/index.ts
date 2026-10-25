// The Device tab. Other parts of the app use only this entry point:
//   <DeviceScreen />                       the tab itself
//   sendToPrinter(blob, 'plate.gcode', profile)  opens the print dialog for sliced G-code
//                                                (profile: the printer preset it was sliced
//                                                with); show the Device tab after calling it
export { DeviceScreen } from './ui/DeviceScreen';
import { useDevice } from '../state/device';
import type { PrintOrigin } from '../lib/prints';

/** `file` is the G-code, or a .gcode.3mf holding `gcode`; `origin`: the saved project's plate, for the print history. */
export function sendToPrinter(file: Blob, fileName: string, slicedFor?: string, gcode?: Blob, origin?: PrintOrigin) {
  useDevice.getState().requestSend(file, fileName, slicedFor, gcode, origin);
}

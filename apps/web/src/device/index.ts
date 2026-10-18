// The Device tab. Other parts of the app use only this entry point:
//   <DeviceScreen />                       the tab itself
//   sendToPrinter(blob, 'plate.gcode', profile)  opens the print dialog for sliced G-code
//                                                (profile: the printer preset it was sliced
//                                                with); show the Device tab after calling it
export { DeviceScreen } from './ui/DeviceScreen';
import { useDevice } from '../state/device';

export function sendToPrinter(gcode: Blob, fileName: string, slicedFor?: string) {
  useDevice.getState().requestSend(gcode, fileName, slicedFor);
}

/**
 * How far down the phone's toolbar moves so it stays on screen: as far as the
 * 3D view is scrolled up out of sight (hiddenAbove), but never past the room
 * the view has left under it, so it leaves together with the view's last bit.
 */
export function toolbarShift(hiddenAbove: number, room: number): number {
  return Math.round(Math.min(Math.max(hiddenAbove, 0), Math.max(room, 0)));
}

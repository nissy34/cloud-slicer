// Mesh boolean of two volumes (engine/src/boolean_api.cpp), like desktop
// Orca's Mesh Boolean tool. The two may be parts of one object, or of two
// objects on the plate: those are joined into one object first, as desktop's
// Assemble does.
import type { ProjectInfo, VolumeInfo } from '../engine/protocol';

export type BooleanOp = 'union' | 'difference' | 'intersection';
export const BOOLEAN_OPS: { op: BooleanOp; label: string }[] = [
  { op: 'union', label: 'Union' },
  { op: 'difference', label: 'Difference' },
  { op: 'intersection', label: 'Intersection' },
];

export interface BooleanRequest {
  op: BooleanOp;
  /** The volume kept (subtracted from, for a difference). */
  a: number;
  /** A volume of the same object, or of bObject. */
  b: number;
  /** Drop the second volume too (a union always does). */
  deleteInput?: boolean;
  /** Another object b belongs to; the two are joined first. */
  bObject?: number;
  aInstance?: number;
  bInstance?: number;
}

/** Desktop's captions for the two pickers. */
export function pickerLabels(op: BooleanOp): [string, string] {
  return op === 'difference' ? ['Subtract from', 'Subtract with'] : ['Part 1', 'Part 2'];
}

/** A part the pickers offer: volume `volume` of object `object` (its copy `instance`). */
export interface BooleanChoice {
  object: number;
  instance: number;
  volume: number;
  name: string;
  kind: VolumeInfo['kind'];
}

/**
 * The parts the pickers offer: the selected object's, then those of every
 * other object on the same plate (their first copy there), so two separate
 * objects can be combined.
 */
export function booleanChoices(project: Pick<ProjectInfo, 'objects'> | null, object: number, instance: number): BooleanChoice[] {
  const objects = project?.objects ?? [];
  const plate = objects[object]?.instances[instance]?.plate;
  const out: BooleanChoice[] = [];
  const add = (o: number, i: number) =>
    objects[o].volumes.forEach((v, k) => out.push({ object: o, instance: i, volume: k, name: v.name, kind: v.kind }));
  if (objects[object]) add(object, instance);
  objects.forEach((obj, o) => {
    if (o === object) return;
    const i = obj.instances.findIndex((inst) => inst.plate === plate);
    if (i >= 0) add(o, i);
  });
  return out;
}

/**
 * The starting pair (indices into the choices): the picked volume of the
 * selected object (else its first) and the next one along, wrapping round.
 */
export function defaultPair(choices: Pick<BooleanChoice, 'object' | 'volume'>[], picked?: number): [number, number] {
  if (choices.length < 2) return [0, 0];
  const at = picked === undefined ? -1 : choices.findIndex((c) => c.object === choices[0].object && c.volume === picked);
  const a = at >= 0 ? at : 0;
  return [a, a === choices.length - 1 ? 0 : a + 1];
}

/** The engine request for choices a and b: on a's object, joining b's when it is another. */
export function booleanRequest(op: BooleanOp, a: BooleanChoice, b: BooleanChoice, deleteInput: boolean): { object: number; request: BooleanRequest } {
  const request: BooleanRequest = { op, a: a.volume, b: b.volume, deleteInput: op !== 'union' && deleteInput };
  if (a.object !== b.object) Object.assign(request, { bObject: b.object, aInstance: a.instance, bInstance: b.instance });
  return { object: a.object, request };
}

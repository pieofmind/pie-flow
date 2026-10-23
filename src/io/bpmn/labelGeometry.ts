/**
 * Shapes whose label sits OUTSIDE the shape (bpmn-js convention: events,
 * gateways, data objects / stores) and where it sits by default — shared by
 * BPMN export (DI label bounds) and import (DI label → labelOffset), so a
 * label left at its default place round-trips with no offset.
 */

const isEvent = (shape: string): boolean =>
  shape.includes("event") || shape.includes("bpmn-start") || shape.includes("bpmn-intermediate") || shape.includes("bpmn-end");
const isGateway = (shape: string): boolean => shape.includes("gateway");
const isData = (shape: string): boolean => shape.startsWith("bpmn-data-");

/** True when the shape's label is drawn outside the shape. */
export function hasExternalLabel(shape: string): boolean {
  return isEvent(shape) || isGateway(shape) || isData(shape);
}

/** Default vertical distance from the shape's centre to its label's centre
 *  (label below the shape: half the shape + 6px gap + half a 20px label). */
export function defaultLabelDy(shape: string, height: number): number {
  if (isGateway(shape)) return 37;
  if (isData(shape)) return height / 2 + 16;
  return 36;
}

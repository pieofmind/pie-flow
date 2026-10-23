/**
 * Geometry for BPMN boundary events (`attachedTo` set): the event's centre
 * always sits on its host activity's border, like bpmn-js. Pure functions,
 * shared by the Board canvas and the tests.
 */

export interface Box { x: number; y: number; width: number; height: number }
export type Side = "top" | "right" | "bottom" | "left";

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const centreOf = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Distance from the event's centre to each edge (segment) of the host. */
function edgeDistances(event: Box, host: Box): Record<Side, number> {
  const c = centreOf(event);
  const along = (v: number, lo: number, hi: number) => v - clamp(v, lo, hi);
  const dist = (dx: number, dy: number) => Math.hypot(dx, dy);
  return {
    top: dist(along(c.x, host.x, host.x + host.width), c.y - host.y),
    bottom: dist(along(c.x, host.x, host.x + host.width), c.y - (host.y + host.height)),
    left: dist(c.x - host.x, along(c.y, host.y, host.y + host.height)),
    right: dist(c.x - (host.x + host.width), along(c.y, host.y, host.y + host.height)),
  };
}

/** Host edge closest to the event's centre. */
export function hostSide(event: Box, host: Box): Side {
  const d = edgeDistances(event, host);
  return (Object.keys(d) as Side[]).reduce((best, s) => (d[s] < d[best] ? s : best), "top");
}

/** Distance from the event's centre to the host's border. */
export function distanceToBorder(event: Box, host: Box): number {
  return Math.min(...Object.values(edgeDistances(event, host)));
}

/** How close (event centre → host border) a boundary event must be to stay
 *  on / attach to a host. Dragged further, it comes off. */
export const ATTACH_DISTANCE = 30;

/** Host whose border is nearest the event's centre, within `maxDist`; null
 *  when the event was dropped clear of every host. */
export function pickHost(event: Box, hosts: ReadonlyArray<{ id: string; box: Box }>, maxDist = ATTACH_DISTANCE): string | null {
  let best: { id: string; d: number } | null = null;
  for (const h of hosts) {
    const d = distanceToBorder(event, h.box);
    if (d <= maxDist && (!best || d < best.d)) best = { id: h.id, d };
  }
  return best?.id ?? null;
}

/** Position (top-left) of `event` with its centre on `side` of `host`, at
 *  fraction `t` (0..1) along that edge (left→right / top→bottom). */
function placeOn(event: Box, host: Box, side: Side, t: number): { x: number; y: number } {
  const horizontal = side === "top" || side === "bottom";
  const cx = horizontal ? host.x + t * host.width : side === "left" ? host.x : host.x + host.width;
  const cy = horizontal ? (side === "top" ? host.y : host.y + host.height) : host.y + t * host.height;
  return { x: cx - event.width / 2, y: cy - event.height / 2 };
}

/** Fraction along `side` of `host` where the event's centre projects. */
function fractionOn(event: Box, host: Box, side: Side): number {
  const c = centreOf(event);
  return side === "top" || side === "bottom"
    ? clamp(host.width ? (c.x - host.x) / host.width : 0.5, 0, 1)
    : clamp(host.height ? (c.y - host.y) / host.height : 0.5, 0, 1);
}

/** Where a dragged boundary event lands: slid onto the nearest host edge. */
export function snapToHostBorder(event: Box, host: Box): { x: number; y: number } {
  const side = hostSide(event, host);
  return placeOn(event, host, side, fractionOn(event, host, side));
}

/** New position of a boundary event after its host went from `before` to
 *  `after` (move and/or resize): same edge, same fraction along it. */
export function followHost(event: Box, before: Box, after: Box): { x: number; y: number } {
  const side = hostSide(event, before);
  return placeOn(event, after, side, fractionOn(event, before, side));
}

/** Which side of an event its label goes. A boundary event's label goes
 *  outside its host (the host edge it sits on); a free event keeps the old
 *  rule — flip above only when edges leave below and the top is free. */
export function eventLabelSide(o: { boundary?: Side; edgeBelow?: boolean; edgeAbove?: boolean }): Side {
  if (o.boundary) return o.boundary;
  return o.edgeBelow && !o.edgeAbove ? "top" : "bottom";
}

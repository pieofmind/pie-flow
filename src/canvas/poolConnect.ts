/**
 * Where an arrow dropped on a BPMN pool ends: on the pool's top or bottom
 * border, straight above / below the arrow's other end, so a message flow
 * between pools is drawn as a vertical line (bpmn.io convention). Pure; the
 * Board turns the result into a `topLeft` anchor on the pool, which keeps the
 * same offset when the pool moves.
 */

export interface PoolBox { x: number; y: number; width: number; height: number; blackBox?: boolean }
export interface Pt { x: number; y: number }

/** How close to a pool's top / bottom border a drop must land to end on it.
 *  (A black-box pool takes a drop anywhere on it.) */
export const POOL_EDGE_BAND = 16;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** Anchor offset (from the pool's top-left) for an arrow dropped at `drop`
 *  whose other end is at `other`; null when the drop doesn't target the pool. */
export function poolDropAnchor(pool: PoolBox, drop: Pt, other: Pt): { dx: number; dy: number } | null {
  const top = pool.y, bottom = pool.y + pool.height;
  if (drop.x < pool.x || drop.x > pool.x + pool.width) return null;
  const nearTop = Math.abs(drop.y - top) <= POOL_EDGE_BAND;
  const nearBottom = Math.abs(drop.y - bottom) <= POOL_EDGE_BAND;
  const onBody = drop.y >= top && drop.y <= bottom;
  if (!nearTop && !nearBottom && !(pool.blackBox && onBody)) return null;
  // Border facing the other end; if it is level with the pool, the nearest one.
  const toBottom = other.y > bottom ? true
    : other.y < top ? false
      : Math.abs(drop.y - bottom) < Math.abs(drop.y - top);
  return { dx: clamp(other.x - pool.x, 0, pool.width), dy: toBottom ? pool.height : 0 };
}

/**
 * Lane geometry for `bpmn-pool` — shared by the Board (render, laneId
 * assignment, divider drag) and the BPMN export so both agree on where each
 * lane starts and ends.
 *
 * `lanes[i].height` is optional. Pools saved before it existed have no
 * heights and keep the old equal split. Stored heights are relative: when the
 * pool is resized they scale proportionally to fill the pool.
 */

export interface PoolLane { id: string; label?: string; height?: number }

const hasHeight = (ln: PoolLane): boolean => typeof ln.height === "number" && Number.isFinite(ln.height) && ln.height > 0;

/** Relative weight of each lane, or null when no lane has a height (legacy
 *  pool → equal split). A lane without a height (e.g. just added) weighs as
 *  much as an average sized lane. Used as the CSS flex weight on the Board. */
export function laneWeights(lanes: readonly PoolLane[]): number[] | null {
  const known = lanes.filter(hasHeight);
  if (!known.length) return null;
  const avg = known.reduce((s, ln) => s + (ln.height as number), 0) / known.length;
  return lanes.map((ln) => (hasHeight(ln) ? (ln.height as number) : avg));
}

/** Height of each lane (top→bottom), always summing to `poolH`. */
export function laneHeights(lanes: readonly PoolLane[], poolH: number): number[] {
  if (!lanes.length) return [];
  const w = laneWeights(lanes);
  if (!w) return lanes.map(() => poolH / lanes.length);
  const total = w.reduce((s, h) => s + h, 0);
  return w.map((h) => (h * poolH) / total);
}

/** Index of the lane containing `relY` (offset from the pool top), clamped
 *  to the first / last lane. -1 when the pool has no lanes. */
export function laneIndexAt(lanes: readonly PoolLane[], poolH: number, relY: number): number {
  const hs = laneHeights(lanes, poolH);
  let acc = 0;
  for (let i = 0; i < hs.length; i++) {
    acc += hs[i];
    if (relY < acc) return i;
  }
  return hs.length - 1;
}

/** Move the divider below lane `index` by `dy`: height shifts between that
 *  lane and the next one only, the pool keeps its size. Every lane gets an
 *  explicit height in the result. */
export function resizeLaneBoundary<T extends PoolLane>(
  lanes: readonly T[],
  poolH: number,
  index: number,
  dy: number,
  minHeight: number,
): T[] {
  const hs = laneHeights(lanes, poolH);
  if (index < 0 || index >= hs.length - 1) return lanes.map((ln, i) => ({ ...ln, height: Math.round(hs[i]) }));
  const pair = hs[index] + hs[index + 1];
  const upper = Math.min(Math.max(hs[index] + dy, minHeight), pair - minHeight);
  const next = hs.map((h, i) => (i === index ? upper : i === index + 1 ? pair - upper : h));
  return lanes.map((ln, i) => ({ ...ln, height: Math.round(next[i]) }));
}

/** The pool was resized from `prevH` to `newH` by dragging its `edge`: the
 *  height change goes to the lane on that edge (like bpmn-js), so the other
 *  lanes — and the shapes in them — stay put. Shrinking past a lane's minimum
 *  takes the rest from its neighbours. Every lane gets an explicit height. */
export function resizePoolLanes<T extends PoolLane>(
  lanes: readonly T[],
  prevH: number,
  newH: number,
  edge: "top" | "bottom",
  minHeight = 30,
): T[] {
  const hs = laneHeights(lanes, prevH);
  const order = hs.map((_, i) => i);
  if (edge === "bottom") order.reverse();
  let delta = newH - prevH;
  if (delta > 0) hs[order[0]] += delta;
  for (const i of order) {
    if (delta >= 0) break;
    const take = Math.min(-delta, Math.max(0, hs[i] - minHeight));
    hs[i] -= take;
    delta += take;
  }
  return lanes.map((ln, i) => ({ ...ln, height: Math.round(hs[i]) }));
}

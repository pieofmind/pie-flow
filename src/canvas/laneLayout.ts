/**
 * Lane geometry for `bpmn-pool` — shared by the Board (render, laneId
 * assignment, divider drag) and the BPMN export so both agree on where each
 * lane starts and ends.
 *
 * `lanes[i].height` is optional. Pools saved before it existed have no
 * heights and keep the old equal split. Stored heights are relative: when the
 * pool is resized they scale proportionally to fill the pool.
 */

/** A pool lane; `lanes` = its child lanes (any depth of nesting). */
export interface PoolLane { id: string; label?: string; height?: number; lanes?: PoolLane[] }

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

/**
 * Lanes along the pool's stacking axis. A horizontal pool stacks its lanes
 * top→bottom and keeps each lane's size in `height`; a vertical pool lines
 * them up left→right and keeps it in `width`. The functions above work on
 * `height`; these two map a pool's lanes to / from that form.
 */
type SizedLane = PoolLane & { width?: number; lanes?: SizedLane[] };
export function asStackLanes<T extends SizedLane>(lanes: readonly T[], horizontal: boolean): PoolLane[] {
  return horizontal ? [...lanes] : lanes.map((ln) => ({
    id: ln.id, label: ln.label, height: ln.width,
    ...(ln.lanes?.length ? { lanes: asStackLanes(ln.lanes, false) } : {}),
  }));
}
export function fromStackLanes<T extends PoolLane & { width?: number }>(lanes: readonly T[], sized: readonly PoolLane[], horizontal: boolean): T[] {
  return lanes.map((ln, i) => (horizontal
    ? { ...ln, height: sized[i]?.height }
    : { ...ln, width: sized[i]?.height }));
}

/** Id of the leaf lane at `rel` (offset along the stacking axis from the
 *  pool's start): the lane under it, or — recursively — that lane's child under
 *  it when it has child lanes (children split their parent's band by their own sizes). */
export function leafLaneAt(lanes: readonly PoolLane[], extent: number, rel: number): string | undefined {
  if (!lanes.length) return undefined;
  const hs = laneHeights(lanes, extent);
  const i = laneIndexAt(lanes, extent, rel);
  const lane = lanes[i];
  if (!lane.lanes?.length) return lane.id;
  const start = hs.slice(0, i).reduce((a, b) => a + b, 0);
  return leafLaneAt(lane.lanes, hs[i], rel - start);
}

/** Every lane id of a pool, parents and descendants at any depth. */
export function allLaneIds(lanes: readonly PoolLane[]): string[] {
  return lanes.flatMap((ln) => [ln.id, ...allLaneIds(ln.lanes ?? [])]);
}

/** The lane `id` with the list it sits in and the extent that list shares
 *  (the pool's for top-level lanes, else its parent lane's band). */
export function laneBandOf<T extends PoolLane>(
  lanes: readonly T[],
  id: string,
  extent: number,
): { siblings: T[]; index: number; extent: number; parent?: T } | undefined {
  const index = lanes.findIndex((ln) => ln.id === id);
  if (index >= 0) return { siblings: [...lanes], index, extent };
  const hs = laneHeights(lanes, extent);
  for (let i = 0; i < lanes.length; i++) {
    const kids = lanes[i].lanes as T[] | undefined;
    const hit = kids?.length ? laneBandOf(kids, id, hs[i]) : undefined;
    if (hit) return { ...hit, parent: hit.parent ?? lanes[i] };
  }
  return undefined;
}

// ── Lane edits (pure; the Board's lane-title menu calls these) ───────────────
type EditLane = PoolLane & { label?: string };

/** Apply `fn` to the lane `id` wherever it is in the tree. */
const mapLane = <T extends EditLane>(lanes: readonly T[], id: string, fn: (ln: T) => T): T[] =>
  lanes.map((ln) => {
    if (ln.id === id) return fn(ln);
    return ln.lanes?.length ? { ...ln, lanes: mapLane(ln.lanes as T[], id, fn) } : ln;
  });

/** Replace the list of child lanes of lane `parentId` (null = the pool's own lanes). */
export function setSiblings<T extends EditLane>(lanes: readonly T[], parentId: string | null, fn: (kids: T[]) => T[]): T[] {
  if (parentId === null) return fn([...lanes]);
  return mapLane(lanes, parentId, (ln) => ({ ...ln, lanes: fn((ln.lanes ?? []) as T[]) }));
}

/** Lane `laneId` gets two child lanes (its band split equally). */
export function splitLane<T extends EditLane>(lanes: readonly T[], laneId: string, ids: [string, string]): T[] {
  return mapLane(lanes, laneId, (ln) => ({
    ...ln,
    lanes: [{ id: ids[0], label: `${ln.label ?? "Lane"} 1` }, { id: ids[1], label: `${ln.label ?? "Lane"} 2` }],
  }));
}

/** Lane `laneId` loses its child lanes (shapes fall back into it). */
export function mergeChildLanes<T extends EditLane>(lanes: readonly T[], laneId: string): T[] {
  return mapLane(lanes, laneId, (ln) => {
    const { lanes: _children, ...rest } = ln;
    return rest as T;
  });
}

/** A new lane right after the child lane `afterId`, at any depth. */
export function addChildLane<T extends EditLane>(lanes: readonly T[], afterId: string, newId: string): T[] {
  return lanes.map((ln) => {
    const kids = (ln.lanes ?? []) as T[];
    const i = kids.findIndex((c) => c.id === afterId);
    if (i >= 0) {
      const children = [...kids];
      children.splice(i + 1, 0, { id: newId, label: `Lane ${children.length + 1}` } as T);
      return { ...ln, lanes: children };
    }
    return kids.length ? { ...ln, lanes: addChildLane(kids, afterId, newId) } : ln;
  });
}

/** Remove child lane `childId` at any depth; a lane left with one child has its children merged. */
export function removeChildLane<T extends EditLane>(lanes: readonly T[], childId: string): T[] {
  return lanes.map((ln) => {
    const kids = (ln.lanes ?? []) as T[];
    if (kids.some((c) => c.id === childId)) {
      const children = kids.filter((c) => c.id !== childId);
      if (children.length < 2) {
        const { lanes: _children, ...rest } = ln;
        return rest as T;
      }
      return { ...ln, lanes: children };
    }
    return kids.length ? { ...ln, lanes: removeChildLane(kids, childId) } : ln;
  });
}

/** The space tool opened (or closed) `delta` of room at offset `rel` of a pool:
 *  the leaf lane there grows by it, every lane above it in the tree with it, and
 *  the others keep their size. Every lane gets an explicit height. */
export function growLaneAt<T extends PoolLane>(lanes: readonly T[], extent: number, rel: number, delta: number): T[] {
  const hs = laneHeights(lanes, extent);
  const at = laneIndexAt(lanes, extent, rel);
  const start = hs.slice(0, Math.max(at, 0)).reduce((a, b) => a + b, 0);
  return lanes.map((ln, k) => {
    const h = hs[k] + (k === at ? delta : 0);
    const kids = k === at && ln.lanes?.length ? growLaneAt(ln.lanes as T[], hs[k], rel - start, delta) : ln.lanes;
    return { ...ln, height: Math.round(h), ...(kids ? { lanes: kids } : {}) };
  });
}

/** Height of the leaf lane at offset `rel` (how much room it can give up). */
export function leafLaneSize(lanes: readonly PoolLane[], extent: number, rel: number): number {
  if (!lanes.length) return extent;
  const hs = laneHeights(lanes, extent);
  const at = laneIndexAt(lanes, extent, rel);
  const lane = lanes[at];
  if (!lane.lanes?.length) return hs[at];
  return leafLaneSize(lane.lanes, hs[at], rel - hs.slice(0, at).reduce((a, b) => a + b, 0));
}

/** `fromStackLanes` at every depth. */
export function fromStackLanesDeep<T extends PoolLane & { width?: number }>(lanes: readonly T[], sized: readonly PoolLane[], horizontal: boolean): T[] {
  return lanes.map((ln, i) => {
    const sz = sized[i];
    const kids = ln.lanes?.length && sz?.lanes ? fromStackLanesDeep(ln.lanes as T[], sz.lanes, horizontal) : ln.lanes;
    return { ...ln, ...(horizontal ? { height: sz?.height } : { width: sz?.height }), ...(kids ? { lanes: kids } : {}) };
  });
}

/**
 * Story 6.1 — Bulk align & distribute pure helpers.
 *
 * Each function takes a list of cell-like inputs ({id, x, y, width, height})
 * and returns the SAME list with new (x, y). Callers apply the result via
 * `cell.setPosition(x, y)` inside a single X6 batch so the operation produces
 * one undo entry.
 *
 * No X6 dependency here on purpose — keeps the math unit-testable without a
 * canvas instance (see tests/unit/bulk-align.test.ts).
 */

export interface AlignCell {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AlignResult = Array<{ id: string; x: number; y: number }>;

function reposition(cells: AlignCell[], mut: (c: AlignCell) => { x: number; y: number }): AlignResult {
  return cells.map((c) => {
    const next = mut(c);
    return { id: c.id, x: next.x, y: next.y };
  });
}

/** Align every cell's LEFT edge to the leftmost cell's left edge. */
export function alignLeft(cells: AlignCell[]): AlignResult {
  if (cells.length < 2) return cells.map((c) => ({ id: c.id, x: c.x, y: c.y }));
  const minX = Math.min(...cells.map((c) => c.x));
  return reposition(cells, (c) => ({ x: minX, y: c.y }));
}

/** Align every cell's HORIZONTAL CENTER to the average horizontal center. */
export function alignCenterH(cells: AlignCell[]): AlignResult {
  if (cells.length < 2) return cells.map((c) => ({ id: c.id, x: c.x, y: c.y }));
  const centers = cells.map((c) => c.x + c.width / 2);
  const avg = centers.reduce((a, b) => a + b, 0) / centers.length;
  return reposition(cells, (c) => ({ x: Math.round(avg - c.width / 2), y: c.y }));
}

/** Align every cell's RIGHT edge to the rightmost cell's right edge. */
export function alignRight(cells: AlignCell[]): AlignResult {
  if (cells.length < 2) return cells.map((c) => ({ id: c.id, x: c.x, y: c.y }));
  const maxR = Math.max(...cells.map((c) => c.x + c.width));
  return reposition(cells, (c) => ({ x: maxR - c.width, y: c.y }));
}

/** Align every cell's TOP edge to the topmost cell's top edge. */
export function alignTop(cells: AlignCell[]): AlignResult {
  if (cells.length < 2) return cells.map((c) => ({ id: c.id, x: c.x, y: c.y }));
  const minY = Math.min(...cells.map((c) => c.y));
  return reposition(cells, (c) => ({ x: c.x, y: minY }));
}

/** Align every cell's VERTICAL MIDDLE to the average vertical middle. */
export function alignMiddleV(cells: AlignCell[]): AlignResult {
  if (cells.length < 2) return cells.map((c) => ({ id: c.id, x: c.x, y: c.y }));
  const middles = cells.map((c) => c.y + c.height / 2);
  const avg = middles.reduce((a, b) => a + b, 0) / middles.length;
  return reposition(cells, (c) => ({ x: c.x, y: Math.round(avg - c.height / 2) }));
}

/** Align every cell's BOTTOM edge to the bottommost cell's bottom edge. */
export function alignBottom(cells: AlignCell[]): AlignResult {
  if (cells.length < 2) return cells.map((c) => ({ id: c.id, x: c.x, y: c.y }));
  const maxB = Math.max(...cells.map((c) => c.y + c.height));
  return reposition(cells, (c) => ({ x: c.x, y: maxB - c.height }));
}

/**
 * Distribute horizontally: keep leftmost and rightmost cell fixed; space the
 * cells in between so each pair has the same horizontal gap. Requires ≥3 cells.
 * "Gap" measures the empty space between consecutive cells (Figma convention).
 */
export function distributeH(cells: AlignCell[]): AlignResult {
  if (cells.length < 3) return cells.map((c) => ({ id: c.id, x: c.x, y: c.y }));
  const sorted = [...cells].sort((a, b) => a.x - b.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalWidth = sorted.reduce((sum, c) => sum + c.width, 0);
  const span = (last.x + last.width) - first.x;
  // [Review][Patch P5] Clamp gap to 0 — when total widths exceed the span
  // (dense selection), a negative gap would silently overlap cells; instead
  // pack them edge-to-edge starting from first.x and leave the rest to the user.
  const gap = Math.max(0, (span - totalWidth) / (sorted.length - 1));
  let cursor = first.x;
  const map = new Map<string, { x: number; y: number }>();
  for (const c of sorted) {
    map.set(c.id, { x: Math.round(cursor), y: c.y });
    cursor += c.width + gap;
  }
  // Preserve original input order in the result.
  return cells.map((c) => ({ id: c.id, ...map.get(c.id)! }));
}

/** Distribute vertically — mirror of distributeH along the Y axis. */
export function distributeV(cells: AlignCell[]): AlignResult {
  if (cells.length < 3) return cells.map((c) => ({ id: c.id, x: c.x, y: c.y }));
  const sorted = [...cells].sort((a, b) => a.y - b.y);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalHeight = sorted.reduce((sum, c) => sum + c.height, 0);
  const span = (last.y + last.height) - first.y;
  // [Review][Patch P5] Clamp gap to 0 — see distributeH for rationale.
  const gap = Math.max(0, (span - totalHeight) / (sorted.length - 1));
  let cursor = first.y;
  const map = new Map<string, { x: number; y: number }>();
  for (const c of sorted) {
    map.set(c.id, { x: c.x, y: Math.round(cursor) });
    cursor += c.height + gap;
  }
  return cells.map((c) => ({ id: c.id, ...map.get(c.id)! }));
}

export const BULK_ALIGN_FUNCTIONS = {
  alignLeft, alignCenterH, alignRight,
  alignTop, alignMiddleV, alignBottom,
  distributeH, distributeV,
} as const;

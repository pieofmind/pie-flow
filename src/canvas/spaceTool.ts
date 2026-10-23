/** Space tool maths (bpmn-js style): dragging across the board pushes everything
 *  past the start line away, opening or closing room. Pure; the canvas applies it. */

export type Axis = "x" | "y";
export interface SpaceBox { id: string; x: number; y: number; w: number; h: number; frame: boolean; parentId?: string }
export interface SpacePlan { move: string[]; resize: string[] }

const span = (b: SpaceBox, axis: Axis): [number, number] => (axis === "x" ? [b.x, b.x + b.w] : [b.y, b.y + b.h]);

/** Who moves and who stretches for a line at `line` on `axis`. A shape moves when
 *  its centre is past the line (a frame: when it starts past it); a frame the line
 *  crosses stretches. Shapes riding inside a moved frame are not listed again. */
export function planSpace(boxes: SpaceBox[], axis: Axis, line: number): SpacePlan {
  const move = new Set<string>();
  const resize: string[] = [];
  for (const b of boxes) {
    const [start, end] = span(b, axis);
    if (b.frame) {
      if (start >= line) move.add(b.id);
      else if (end > line) resize.push(b.id);
    } else if ((start + end) / 2 >= line) move.add(b.id);
  }
  const parent = new Map(boxes.map((b) => [b.id, b.parentId]));
  const ridesAlong = (id: string): boolean => {
    for (let p = parent.get(id); p; p = parent.get(p)) if (move.has(p)) return true;
    return false;
  };
  return { move: [...move].filter((id) => !ridesAlong(id)), resize };
}

/** Closing room must not squeeze a crossed frame under `minSize`. */
export function clampDelta(delta: number, boxes: SpaceBox[], resize: string[], axis: Axis, minSize = 60): number {
  if (delta >= 0) return delta;
  const room = Math.min(...boxes.filter((b) => resize.includes(b.id)).map((b) => span(b, axis)[1] - span(b, axis)[0] - minSize), Infinity);
  return Math.max(delta, -room);
}

/** Bends past the line follow the shapes they connect. */
export function shiftVertices(v: Array<{ x: number; y: number }>, axis: Axis, line: number, delta: number): Array<{ x: number; y: number }> {
  return v.map((p) => (p[axis] >= line ? { ...p, [axis]: p[axis] + delta } : p));
}

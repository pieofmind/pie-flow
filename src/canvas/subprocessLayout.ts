import type { Box } from "./boundaryLayout";

/** Sub-process kinds that can be opened / closed in place on the Board. */
export const SUBPROCESS_KINDS = new Set(["bpmn-subprocess", "bpmn-transaction", "bpmn-event-subprocess", "bpmn-adhoc-subprocess"]);
/** A closed sub-process is task-sized. */
export const SUB_CLOSED = { width: 120, height: 80 };
const MIN_OPEN = { width: 280, height: 180 };
const PAD = 30;
const HEAD = 40;   // room for the frame title

/** Opening a sub-process at its top-left corner: the frame size, and the shift
 *  that puts its child steps (kept in their own layout) just inside it. */
export function openLayout(at: { x: number; y: number }, children: Box[]): { width: number; height: number; dx: number; dy: number } {
  if (!children.length) return { ...MIN_OPEN, dx: 0, dy: 0 };
  const x0 = Math.min(...children.map((c) => c.x));
  const y0 = Math.min(...children.map((c) => c.y));
  const x1 = Math.max(...children.map((c) => c.x + c.width));
  const y1 = Math.max(...children.map((c) => c.y + c.height));
  return {
    width: Math.max(MIN_OPEN.width, x1 - x0 + 2 * PAD),
    height: Math.max(MIN_OPEN.height, y1 - y0 + HEAD + PAD),
    dx: at.x + PAD - x0,
    dy: at.y + HEAD - y0,
  };
}

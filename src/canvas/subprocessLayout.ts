import type { Box } from "./boundaryLayout";

/** Sub-process kinds that can be opened / closed in place on the Board. */
export const SUBPROCESS_KINDS = new Set(["bpmn-subprocess", "bpmn-transaction", "bpmn-event-subprocess", "bpmn-adhoc-subprocess"]);
/** A closed sub-process is task-sized. */
export const SUB_CLOSED = { width: 120, height: 80 };
/** bpmn-js default size of an expanded sub-process. */
const MIN_OPEN = { width: 350, height: 200 };
const PAD = 30;
const HEAD = 40;   // room for the frame title

const mid = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Expanding a sub-process the bpmn-js way (ToggleElementCollapseBehaviour +
 *  SubProcessPlaneBehavior): its steps move so their centre is the box's centre,
 *  and the frame becomes max(steps + box, 350×200) centred on them. Nothing
 *  around it moves. `dx/dy` is the shift for the steps. */
export function openLayout(box: Box, children: Box[]): Box & { dx: number; dy: number } {
  let dx = 0, dy = 0;
  let fit: Box = box;
  if (children.length) {
    const x0 = Math.min(...children.map((c) => c.x));
    const y0 = Math.min(...children.map((c) => c.y));
    const x1 = Math.max(...children.map((c) => c.x + c.width));
    const y1 = Math.max(...children.map((c) => c.y + c.height));
    const kids = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    dx = Math.round(mid(box).x - mid(kids).x);
    dy = Math.round(mid(box).y - mid(kids).y);
    // the steps where they land, with room for the frame's sides and title
    const p = { x: x0 + dx - PAD, y: y0 + dy - HEAD, width: kids.width + 2 * PAD, height: kids.height + HEAD + PAD };
    const ux = Math.min(p.x, box.x), uy = Math.min(p.y, box.y);
    fit = { x: ux, y: uy, width: Math.max(p.x + p.width, box.x + box.width) - ux, height: Math.max(p.y + p.height, box.y + box.height) - uy };
  }
  const width = Math.max(fit.width, MIN_OPEN.width);
  const height = Math.max(fit.height, MIN_OPEN.height);
  return { x: Math.round(fit.x + (fit.width - width) / 2), y: Math.round(fit.y + (fit.height - height) / 2), width, height, dx, dy };
}

/** Collapsing: task size, centred where the frame was (bpmn-js collapsedBounds). */
export function closedLayout(frame: Box): Box {
  const c = mid(frame);
  return { x: Math.round(c.x - SUB_CLOSED.width / 2), y: Math.round(c.y - SUB_CLOSED.height / 2), ...SUB_CLOSED };
}

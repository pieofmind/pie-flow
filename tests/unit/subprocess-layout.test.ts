import { describe, it, expect } from "vitest";
import { closedLayout, openLayout } from "../../src/canvas/subprocessLayout";

// Same maths as bpmn-js ToggleElementCollapseBehaviour / SubProcessPlaneBehavior.
describe("openLayout", () => {
  it("an empty sub-process expands to 350×200 centred on the box", () => {
    expect(openLayout({ x: 100, y: 50, width: 120, height: 80 }, [])).toEqual({ x: -15, y: -10, width: 350, height: 200, dx: 0, dy: 0 });
  });
  it("centres the steps on the box and fits the frame around them", () => {
    // steps drawn elsewhere (a bpmn-js sub-plane starts near 0,0): bbox 10..510 × 10..240
    const l = openLayout({ x: 500, y: 300, width: 120, height: 80 }, [
      { x: 10, y: 10, width: 100, height: 80 },
      { x: 410, y: 10, width: 100, height: 80 },
      { x: 200, y: 160, width: 100, height: 80 },
    ]);
    // box centre (560,340), steps centre (260,125)
    expect([l.dx, l.dy]).toEqual([300, 215]);
    // steps now 310..810 × 225..455; frame = steps + 30 sides, 40 title, 30 bottom
    expect([l.x, l.y, l.width, l.height]).toEqual([280, 185, 560, 300]);
  });
});

describe("closedLayout", () => {
  it("is task-sized and centred where the frame was", () => {
    expect(closedLayout({ x: 280, y: 185, width: 560, height: 300 })).toEqual({ x: 500, y: 295, width: 120, height: 80 });
  });
});

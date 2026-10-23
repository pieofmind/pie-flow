import { describe, it, expect } from "vitest";
import { openLayout } from "../../src/canvas/subprocessLayout";

describe("openLayout", () => {
  it("an empty sub-process opens at a default size", () => {
    expect(openLayout({ x: 100, y: 50 }, [])).toEqual({ width: 280, height: 180, dx: 0, dy: 0 });
  });
  it("moves the steps just inside the frame and fits the frame around them", () => {
    // steps drawn elsewhere (a bpmn-js sub-plane starts near 0,0)
    const l = openLayout({ x: 500, y: 300 }, [
      { x: 10, y: 10, width: 100, height: 80 },
      { x: 400, y: 10, width: 100, height: 80 },
      { x: 200, y: 150, width: 100, height: 80 },
    ]);
    expect(l).toEqual({ width: 490 + 60, height: 220 + 40 + 30, dx: 500 + 30 - 10, dy: 300 + 40 - 10 });
  });
});

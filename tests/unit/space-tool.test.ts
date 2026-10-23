import { describe, expect, it } from "vitest";
import { planSpace, clampDelta, shiftVertices, type SpaceBox } from "../../src/canvas/spaceTool";

const box = (id: string, x: number, y: number, w: number, h: number, extra: Partial<SpaceBox> = {}): SpaceBox => ({ id, x, y, w, h, frame: false, ...extra });

describe("planSpace", () => {
  it("moves shapes whose centre is past the line, leaves the others", () => {
    const p = planSpace([box("a", 0, 0, 100, 60), box("b", 200, 0, 100, 60), box("c", 80, 0, 100, 60)], "x", 100);
    expect(p.move.sort()).toEqual(["b", "c"]);       // c's centre (130) is past 100
    expect(p.resize).toEqual([]);
  });
  it("works on the y axis", () => {
    const p = planSpace([box("a", 0, 0, 100, 60), box("b", 0, 200, 100, 60)], "y", 100);
    expect(p.move).toEqual(["b"]);
  });
  it("resizes a frame the line crosses, moves a frame that starts past it", () => {
    const p = planSpace([box("pool", 0, 0, 500, 200, { frame: true }), box("sub", 300, 20, 100, 100, { frame: true })], "x", 150);
    expect(p.resize).toEqual(["pool"]);
    expect(p.move).toEqual(["sub"]);
  });
  it("moves a shape only once: the children of a moved frame ride along with it", () => {
    const p = planSpace([
      box("sub", 300, 0, 300, 200, { frame: true }),
      box("inner", 320, 40, 100, 60, { parentId: "sub" }),
    ], "x", 100);
    expect(p.move).toEqual(["sub"]);
  });
  it("a child of a resized frame is judged on its own", () => {
    const p = planSpace([
      box("pool", 0, 0, 600, 200, { frame: true }),
      box("a", 20, 40, 100, 60, { parentId: "pool" }),
      box("b", 300, 40, 100, 60, { parentId: "pool" }),
    ], "x", 200);
    expect(p.resize).toEqual(["pool"]);
    expect(p.move).toEqual(["b"]);
  });
});

describe("clampDelta", () => {
  it("lets a gap grow freely", () => {
    expect(clampDelta(120, [box("pool", 0, 0, 500, 200, { frame: true })], ["pool"], "x")).toBe(120);
  });
  it("stops a shrink before a crossed frame gets smaller than its minimum", () => {
    expect(clampDelta(-1000, [box("pool", 0, 0, 500, 200, { frame: true })], ["pool"], "x", 60)).toBe(-440);
  });
});

describe("shiftVertices", () => {
  it("moves only the bends past the line", () => {
    expect(shiftVertices([{ x: 50, y: 10 }, { x: 150, y: 10 }, { x: 150, y: 90 }], "x", 100, 30))
      .toEqual([{ x: 50, y: 10 }, { x: 180, y: 10 }, { x: 180, y: 90 }]);
    expect(shiftVertices([{ x: 5, y: 50 }, { x: 5, y: 150 }], "y", 100, -20)).toEqual([{ x: 5, y: 50 }, { x: 5, y: 130 }]);
  });
});

import { describe, it, expect } from "vitest";
import {
  alignLeft, alignCenterH, alignRight,
  alignTop, alignMiddleV, alignBottom,
  distributeH, distributeV,
  type AlignCell,
} from "../../src/canvas/bulkAlign";

/**
 * Story 6.1 — Unit tests for bulk align/distribute pure functions.
 *
 * Each test uses a small deterministic fixture so failures point at the
 * specific math. No X6 / DOM — pure data in, pure data out.
 */

const fx = (overrides: Partial<AlignCell> & { id: string }): AlignCell => ({
  x: 0, y: 0, width: 100, height: 40, ...overrides,
});

describe("bulkAlign — guard rails", () => {
  it("returns input unchanged when fewer than 2 cells (no-op for align)", () => {
    const one = [fx({ id: "a", x: 10, y: 10 })];
    expect(alignLeft(one)).toEqual([{ id: "a", x: 10, y: 10 }]);
    expect(alignTop(one)).toEqual([{ id: "a", x: 10, y: 10 }]);
    expect(alignCenterH([])).toEqual([]);
  });

  it("returns input unchanged when fewer than 3 cells (distribute is N/A)", () => {
    const two = [fx({ id: "a", x: 0 }), fx({ id: "b", x: 50 })];
    expect(distributeH(two)).toEqual([{ id: "a", x: 0, y: 0 }, { id: "b", x: 50, y: 0 }]);
    expect(distributeV(two)).toEqual([{ id: "a", x: 0, y: 0 }, { id: "b", x: 50, y: 0 }]);
  });
});

describe("bulkAlign — align edges", () => {
  it("alignLeft snaps everyone to the leftmost X", () => {
    const cells = [
      fx({ id: "a", x: 50, y: 0 }),
      fx({ id: "b", x: 200, y: 100 }),
      fx({ id: "c", x: 10, y: 200 }), // leftmost
    ];
    const r = alignLeft(cells);
    expect(r.map((c) => c.x)).toEqual([10, 10, 10]);
    expect(r.map((c) => c.y)).toEqual([0, 100, 200]); // Y untouched
  });

  it("alignRight snaps everyone's right edge to the rightmost cell's right edge", () => {
    const cells = [
      fx({ id: "a", x: 50, width: 100 }),  // right = 150
      fx({ id: "b", x: 200, width: 60 }),  // right = 260 ← rightmost
      fx({ id: "c", x: 0, width: 80 }),    // right = 80
    ];
    const r = alignRight(cells);
    // Each cell's new x = 260 - own width
    expect(r.find((c) => c.id === "a")!.x).toBe(160);
    expect(r.find((c) => c.id === "b")!.x).toBe(200);
    expect(r.find((c) => c.id === "c")!.x).toBe(180);
  });

  it("alignTop snaps everyone to the topmost Y", () => {
    const cells = [
      fx({ id: "a", y: 50 }),
      fx({ id: "b", y: 5 }),   // top
      fx({ id: "c", y: 200 }),
    ];
    expect(alignTop(cells).map((c) => c.y)).toEqual([5, 5, 5]);
  });

  it("alignBottom snaps everyone's bottom edge to the bottommost cell's bottom edge", () => {
    const cells = [
      fx({ id: "a", y: 0, height: 40 }),    // bottom = 40
      fx({ id: "b", y: 100, height: 60 }),  // bottom = 160 ← bottommost
      fx({ id: "c", y: 50, height: 50 }),   // bottom = 100
    ];
    const r = alignBottom(cells);
    expect(r.find((c) => c.id === "a")!.y).toBe(120);
    expect(r.find((c) => c.id === "b")!.y).toBe(100);
    expect(r.find((c) => c.id === "c")!.y).toBe(110);
  });
});

describe("bulkAlign — align centers", () => {
  it("alignCenterH places each cell so its horizontal center sits on the group average", () => {
    const cells = [
      fx({ id: "a", x: 0, width: 100 }),    // center = 50
      fx({ id: "b", x: 200, width: 100 }),  // center = 250
    ];
    // Avg center = 150 → x = 150 - 50 = 100 for both
    const r = alignCenterH(cells);
    expect(r.map((c) => c.x)).toEqual([100, 100]);
  });

  it("alignMiddleV places each cell so its vertical middle sits on the group average", () => {
    const cells = [
      fx({ id: "a", y: 0, height: 40 }),    // middle = 20
      fx({ id: "b", y: 100, height: 60 }),  // middle = 130
    ];
    // Avg middle = 75 → a.y = 75 - 20 = 55, b.y = 75 - 30 = 45
    const r = alignMiddleV(cells);
    expect(r.find((c) => c.id === "a")!.y).toBe(55);
    expect(r.find((c) => c.id === "b")!.y).toBe(45);
  });
});

describe("bulkAlign — distribute", () => {
  it("distributeH keeps end cells fixed and equalises gaps in between", () => {
    const cells = [
      fx({ id: "a", x: 0, width: 100 }),    // right = 100
      fx({ id: "b", x: 150, width: 100 }),  // middle
      fx({ id: "c", x: 400, width: 100 }),  // right = 500 (rightmost end)
    ];
    // span = 500 - 0 = 500, totalW = 300, gap = (500-300)/2 = 100
    // → a.x = 0, b.x = 0+100+100 = 200, c.x = 200+100+100 = 400
    const r = distributeH(cells);
    expect(r.find((c) => c.id === "a")!.x).toBe(0);
    expect(r.find((c) => c.id === "b")!.x).toBe(200);
    expect(r.find((c) => c.id === "c")!.x).toBe(400);
  });

  it("distributeH preserves input order in the returned list (not sorted by X)", () => {
    const cells = [
      fx({ id: "z", x: 400, width: 100 }),  // rightmost but listed first
      fx({ id: "y", x: 0, width: 100 }),    // leftmost
      fx({ id: "x", x: 150, width: 100 }),
    ];
    const r = distributeH(cells);
    expect(r.map((c) => c.id)).toEqual(["z", "y", "x"]);
  });

  it("distributeV equalises vertical gaps between end cells", () => {
    const cells = [
      fx({ id: "a", y: 0, height: 40 }),    // bottom = 40
      fx({ id: "b", y: 60, height: 40 }),
      fx({ id: "c", y: 200, height: 40 }),  // bottommost end
    ];
    // span = 240 - 0 = 240, totalH = 120, gap = 60
    // → a.y=0, b.y=0+40+60=100, c.y=100+40+60=200
    const r = distributeV(cells);
    expect(r.find((c) => c.id === "a")!.y).toBe(0);
    expect(r.find((c) => c.id === "b")!.y).toBe(100);
    expect(r.find((c) => c.id === "c")!.y).toBe(200);
  });
});

describe("bulkAlign — result shape", () => {
  it("returns plain {id, x, y} entries (no width/height leakage)", () => {
    const cells = [fx({ id: "a", x: 0 }), fx({ id: "b", x: 100 })];
    const r = alignLeft(cells);
    expect(Object.keys(r[0]).sort()).toEqual(["id", "x", "y"]);
  });
});

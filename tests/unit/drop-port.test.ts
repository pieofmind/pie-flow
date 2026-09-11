/**
 * Drop-anywhere connect semantics (pure geometry, no X6):
 *  - nearestFixedPortInBox: where an arrow dropped on a node body should attach
 *    (one of the 12 fixed ports — nearest side, band by position along it).
 *  - pickDropTarget: when several nodes contain the drop point (task inside a
 *    pool/lane), the SMALLEST bbox wins so flow nodes beat containers.
 */
import { describe, it, expect } from "vitest";
import { nearestFixedPortInBox, pickDropTarget } from "../../src/canvas/shapes/ports";

const box = { x: 0, y: 0, width: 200, height: 100 };

describe("nearestFixedPortInBox", () => {
  it("picks the nearest side, centre band", () => {
    expect(nearestFixedPortInBox(box, { x: 100, y: 2 })).toBe("top");
    expect(nearestFixedPortInBox(box, { x: 198, y: 50 })).toBe("right");
    expect(nearestFixedPortInBox(box, { x: 100, y: 98 })).toBe("bottom");
    expect(nearestFixedPortInBox(box, { x: 2, y: 50 })).toBe("left");
  });
  it("picks the -1 / -2 quarter band by position along the side", () => {
    expect(nearestFixedPortInBox(box, { x: 20, y: 2 })).toBe("top-1");
    expect(nearestFixedPortInBox(box, { x: 190, y: 2 })).toBe("top-2");
    expect(nearestFixedPortInBox(box, { x: 2, y: 10 })).toBe("left-1");
    expect(nearestFixedPortInBox(box, { x: 198, y: 95 })).toBe("right-2");
  });
  it("clamps points outside the box onto the nearest side", () => {
    expect(nearestFixedPortInBox(box, { x: -50, y: 50 })).toBe("left");
    expect(nearestFixedPortInBox(box, { x: 100, y: 500 })).toBe("bottom");
  });
  it("is deterministic at the exact centre", () => {
    expect(nearestFixedPortInBox(box, { x: 100, y: 50 })).toBe("top");
  });
});

describe("pickDropTarget", () => {
  const pool = { id: "pool", bbox: { x: 0, y: 0, width: 800, height: 300 } };
  const task = { id: "task", bbox: { x: 50, y: 50, width: 100, height: 60 } };
  it("prefers the smallest containing bbox (task over pool)", () => {
    expect(pickDropTarget([pool, task], { x: 80, y: 70 })?.id).toBe("task");
    expect(pickDropTarget([task, pool], { x: 80, y: 70 })?.id).toBe("task");
  });
  it("falls back to the container when the point is outside inner nodes", () => {
    expect(pickDropTarget([pool, task], { x: 700, y: 250 })?.id).toBe("pool");
  });
  it("returns undefined when nothing contains the point", () => {
    expect(pickDropTarget([pool, task], { x: 900, y: 900 })).toBeUndefined();
  });
});

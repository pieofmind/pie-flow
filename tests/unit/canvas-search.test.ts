import { describe, expect, it } from "vitest";
import { findMatches, stepIndex } from "../../src/canvas/search";

const items = [
  { id: "Task_1", label: "Gọi khách hàng", x: 300, y: 0 },
  { id: "Task_2", label: "Báo giá", x: 100, y: 0 },
  { id: "Gw_1", label: "", x: 200, y: 100 },
  { id: "Task_3", label: "Khách hàng xác nhận", x: 100, y: 200 },
];

describe("findMatches", () => {
  it("matches a label ignoring case and Vietnamese accents", () => {
    expect(findMatches(items, "KHACH").map((m) => m.id)).toEqual(["Task_1", "Task_3"]);
  });
  it("matches an id too", () => {
    expect(findMatches(items, "gw_1").map((m) => m.id)).toEqual(["Gw_1"]);
  });
  it("lists matches in reading order (top to bottom, then left to right)", () => {
    expect(findMatches(items, "task").map((m) => m.id)).toEqual(["Task_2", "Task_1", "Task_3"]);
  });
  it("gives nothing for an empty or blank query", () => {
    expect(findMatches(items, "")).toEqual([]);
    expect(findMatches(items, "  ")).toEqual([]);
  });
});

describe("stepIndex", () => {
  it("wraps around in both directions", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

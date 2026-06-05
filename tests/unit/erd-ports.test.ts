import { describe, it, expect } from "vitest";
import { buildErdColumnPorts } from "../../src/canvas/erdPorts";

const HEAD_H = 38;
const ROW_H = 27;

describe("ERD per-column port factory (Story 2.2)", () => {
  it("produces 2 ports per column (left + right)", () => {
    const cols = [
      { k: "PK" as const, name: "id", type: "int" },
      { k: "" as const, name: "name", type: "varchar" },
    ];
    const ports = buildErdColumnPorts(cols, 220);
    expect(ports.length).toBe(4);
    expect(ports.map((p) => p.id)).toEqual([
      "col:id-left",
      "col:id-right",
      "col:name-left",
      "col:name-right",
    ]);
  });

  it("positions ports at row vertical centre", () => {
    const cols = [
      { k: "PK" as const, name: "a", type: "int" },
      { k: "" as const, name: "b", type: "int" },
      { k: "" as const, name: "c", type: "int" },
    ];
    const ports = buildErdColumnPorts(cols, 200);
    const yOf = (id: string) => ports.find((p) => p.id === id)!.args.y;
    expect(yOf("col:a-left")).toBe(HEAD_H + 0 * ROW_H + ROW_H / 2);
    expect(yOf("col:b-left")).toBe(HEAD_H + 1 * ROW_H + ROW_H / 2);
    expect(yOf("col:c-left")).toBe(HEAD_H + 2 * ROW_H + ROW_H / 2);
  });

  it("left ports at x=0, right ports at x=width", () => {
    const cols = [{ k: "PK" as const, name: "id", type: "int" }];
    const ports = buildErdColumnPorts(cols, 300);
    expect(ports.find((p) => p.id === "col:id-left")!.args.x).toBe(0);
    expect(ports.find((p) => p.id === "col:id-right")!.args.x).toBe(300);
  });

  it("empty cols returns empty array (no throw)", () => {
    expect(buildErdColumnPorts([], 220)).toEqual([]);
  });

  it("ignores columns with missing name (defensive)", () => {
    const cols = [
      { k: "PK" as const, name: "id", type: "int" },
      { k: "" as const, name: "", type: "int" },
      { k: "" as const, name: "valid", type: "int" },
    ];
    const ports = buildErdColumnPorts(cols, 220);
    expect(ports.length).toBe(4); // only id + valid
    expect(ports.map((p) => p.id)).toContain("col:id-left");
    expect(ports.map((p) => p.id)).toContain("col:valid-right");
  });

  it("port groups are left + right (not auto-distributed)", () => {
    const cols = [{ k: "PK" as const, name: "x", type: "int" }];
    const ports = buildErdColumnPorts(cols, 220);
    expect(ports.find((p) => p.id === "col:x-left")!.group).toBe("erdColLeft");
    expect(ports.find((p) => p.id === "col:x-right")!.group).toBe("erdColRight");
  });
});

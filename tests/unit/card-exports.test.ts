import { describe, it, expect } from "vitest";
import { isCanvasModel } from "../../src/io/cardExports";

/**
 * Story 7-20 — pure-function tests for cardExports.
 *
 * Rasterization helpers (`exportPng` / `exportPdf` / `saveToDisk`) need
 * a real browser DOM (Image, canvas, FileReader, URL.createObjectURL,
 * jsPDF). They're exercised in integration / via main.ts wiring rather
 * than unit-tested here.
 */

describe("isCanvasModel", () => {
  it("accepts a minimal { nodes, edges } shape", () => {
    expect(isCanvasModel({ nodes: [], edges: [] })).toBe(true);
  });

  it("accepts a populated CanvasModel", () => {
    expect(
      isCanvasModel({
        nodes: [
          { id: "a", shape: "rect", x: 0, y: 0, width: 10, height: 10, label: "" },
        ],
        edges: [{ id: "e", source: "a", target: "a" }],
      }),
    ).toBe(true);
  });

  it("rejects raw string (stub-adapter model)", () => {
    expect(isCanvasModel("raw bpmn xml here")).toBe(false);
  });

  it("rejects null / undefined / primitives", () => {
    expect(isCanvasModel(null)).toBe(false);
    expect(isCanvasModel(undefined)).toBe(false);
    expect(isCanvasModel(42)).toBe(false);
    expect(isCanvasModel(true)).toBe(false);
  });

  it("rejects partial shapes (missing edges)", () => {
    expect(isCanvasModel({ nodes: [] })).toBe(false);
  });

  it("rejects partial shapes (missing nodes)", () => {
    expect(isCanvasModel({ edges: [] })).toBe(false);
  });

  it("rejects non-array `nodes`/`edges`", () => {
    expect(isCanvasModel({ nodes: "not array", edges: [] })).toBe(false);
    expect(isCanvasModel({ nodes: [], edges: {} })).toBe(false);
  });

  it("accepts extra fields (forward compat)", () => {
    expect(
      isCanvasModel({
        nodes: [],
        edges: [],
        extraField: "still ok",
      }),
    ).toBe(true);
  });
});

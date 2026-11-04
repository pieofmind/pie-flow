import { describe, it, expect } from "vitest";
import { minimapPaint } from "../../src/canvas/OmniboardCanvas";

describe("minimapPaint", () => {
  it("draws containers as outlines so the steps inside stay visible", () => {
    for (const k of ["bpmn-pool", "bpmn-lane", "bpmn-group", "bpmn-subprocess"]) {
      expect(minimapPaint(k, "#ffeeaa")).toMatch(/^fill="none" stroke=/);
    }
  });

  it("fills steps with their own colour, grey when none or transparent", () => {
    expect(minimapPaint("bpmn-task", "#ff0000")).toBe('fill="#ff0000"');
    expect(minimapPaint("bpmn-task")).toBe('fill="#cdd6df"');
    expect(minimapPaint("bs-rect", "transparent")).toBe('fill="#cdd6df"');
  });
});

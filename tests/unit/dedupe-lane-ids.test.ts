/**
 * Regression: legacy pool defaults hardcoded lane id "l1", so files with ≥2
 * pools have duplicate `<bpmn:lane id="l1">` after export. bpmn-js's
 * Canvas._ensureValid throws "element <l1> already exists" on import, which
 * scrambles the render (washed-out / partial diagram).
 *
 * exportBpmn must rename collisions to keep the emitted XML importable.
 */

import { describe, it, expect } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import type { CanvasModel } from "../../src/canvas/types";

const twoPoolsSameLaneId: CanvasModel = {
  nodes: [
    {
      id: "pool-customer",
      shape: "bpmn-pool",
      label: "Customer",
      x: 0, y: 0, width: 800, height: 200,
      attrs: { lanes: [{ id: "l1", label: "Lane 1" }] },
    },
    {
      id: "pool-machine",
      shape: "bpmn-pool",
      label: "Car Wash Machine",
      x: 0, y: 220, width: 800, height: 200,
      attrs: { lanes: [{ id: "l1", label: "Lane 1" }] }, // ← same id as pool above
    },
    {
      id: "evt-start",
      shape: "bpmn-event-start",
      label: "Start",
      x: 60, y: 100, width: 36, height: 36,
      parentId: "pool-customer",
      laneId: "l1",
    },
  ],
  edges: [],
};

describe("exportBpmn: multi-pool emits separate processes per participant", () => {
  it("each participant references its own process (NOT a shared one)", async () => {
    const xml = await exportBpmn(twoPoolsSameLaneId);
    const processIds = [...xml.matchAll(/<bpmn:process\s+[^/>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    const participantRefs = [...xml.matchAll(/<bpmn:participant\s+[^/>]*\bprocessRef="([^"]+)"/g)].map((m) => m[1]);
    expect(processIds.length).toBeGreaterThanOrEqual(2); // ≥1 per pool
    // Two participants → two distinct processRef values; sharing one is the
    // bug that crashes bpmn-js BpmnImporter with "element already exists".
    expect(new Set(participantRefs).size).toBe(participantRefs.length);
  });
});

describe("exportBpmn: lane id collision across pools", () => {
  it("renames duplicate lane ids so emitted XML is importable", async () => {
    const xml = await exportBpmn(twoPoolsSameLaneId);
    // Count `<bpmn:lane id="..."` occurrences — there should be 2 lanes but
    // no two share the same id.
    const ids = [...xml.matchAll(/<bpmn:lane\s+[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(2); // all unique
  });

  it("preserves the first lane's id verbatim (only collisions renamed)", async () => {
    const xml = await exportBpmn(twoPoolsSameLaneId);
    const ids = [...xml.matchAll(/<bpmn:lane\s+[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids[0]).toBe("l1");
    expect(ids[1]).not.toBe("l1");
  });
});

// @vitest-environment happy-dom
/**
 * Which shapes the "avoid" router routes around. Containers drawn behind
 * other shapes (pools, lanes, groups, annotations, expanded sub-processes)
 * hold the arrows' own ends, so they are not obstacles. The routing itself
 * is checked on the real canvas in tests/e2e-canvas-interaction.html.
 */
import { describe, it, expect } from "vitest";
import { isRouteObstacle, AVOID_ROUTER } from "../../src/canvas/avoidRouter";

describe("avoid router obstacles", () => {
  it("shapes are obstacles", () => {
    for (const k of ["bpmn-task-user", "bpmn-gateway-x", "bpmn-event-start", "bpmn-data-object", "fc-process"]) {
      expect(isRouteObstacle(k)).toBe(true);
    }
  });
  it("containers are not", () => {
    for (const k of ["bpmn-pool", "bpmn-lane", "bpmn-group", "bpmn-annotation"]) expect(isRouteObstacle(k)).toBe(false);
  });
  it("a sub-process is an obstacle only when collapsed", () => {
    expect(isRouteObstacle("bpmn-subprocess", { collapsed: true })).toBe(true);
    expect(isRouteObstacle("bpmn-subprocess", {})).toBe(false);
  });
  it("keeps ≥ 20px clearance", () => {
    expect(AVOID_ROUTER.args.padding).toBeGreaterThanOrEqual(20);
  });
});

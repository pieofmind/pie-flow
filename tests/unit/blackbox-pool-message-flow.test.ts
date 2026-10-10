/**
 * Black-box pools (participant with no process) are the standard way to model
 * an external party you don't control — e.g. "Customer" in a sales To-Be.
 * Message flows may end on the participant itself (BPMN 2.0 §9.3).
 *
 * Regression for pieofmind/pie-flow#1: message flows touching a pool were
 * silently dropped on export, and the black-box flag was lost on round-trip
 * (participant got a processRef → re-import produced a white-box "Lane 1").
 */
import { describe, it, expect } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import type { CanvasModel } from "../../src/canvas/types";

const model: CanvasModel = {
  nodes: [
    { id: "pool_customer", shape: "bpmn-pool", x: 0, y: 0, width: 800, height: 120, label: "Customer",
      attrs: { blackBox: true } },
    { id: "pool_company", shape: "bpmn-pool", x: 0, y: 190, width: 800, height: 300, label: "Company",
      attrs: { lanes: [{ id: "lane_sale", label: "Sale" }] } },
    { id: "start", shape: "bpmn-event-start", x: 100, y: 320, width: 36, height: 36, label: "Receive request",
      laneId: "lane_sale", attrs: { trigger: "message" } },
    { id: "send_quote", shape: "bpmn-task-send", x: 300, y: 300, width: 100, height: 80, label: "Send quote",
      laneId: "lane_sale" },
  ],
  edges: [
    { id: "f1", source: "start", target: "send_quote" },
    { id: "m_in", source: "pool_customer", target: "start", kind: "message",
      sourceAnchor: { dx: 118, dy: 120 }, targetAnchor: { dx: 18, dy: 0 } },
    { id: "m_out", source: "send_quote", target: "pool_customer", kind: "message",
      sourceAnchor: { dx: 50, dy: 0 }, targetAnchor: { dx: 350, dy: 120 } },
  ],
} as unknown as CanvasModel;

describe("black-box pool with message flows to/from the pool border", () => {
  it("exports message flows whose endpoint is the pool itself", async () => {
    const xml = await exportBpmn(model);
    expect(xml).toMatch(/<bpmn:messageFlow\b[^>]*id="m_in"[^>]*sourceRef="pool_customer"[^>]*targetRef="start"/);
    expect(xml).toMatch(/<bpmn:messageFlow\b[^>]*id="m_out"[^>]*sourceRef="send_quote"[^>]*targetRef="pool_customer"/);
  });

  it("exports the black-box pool as a participant without a process", async () => {
    const xml = await exportBpmn(model);
    const customer = /<bpmn:participant\b[^>]*id="pool_customer"[^>]*>/.exec(xml)?.[0] ?? "";
    expect(customer, "customer participant present").not.toBe("");
    expect(customer).not.toMatch(/processRef=/);
    const company = /<bpmn:participant\b[^>]*id="pool_company"[^>]*>/.exec(xml)?.[0] ?? "";
    expect(company).toMatch(/processRef=/);
  });

  it("round-trips: pool stays black-box (no lanes) and both message flows survive", async () => {
    const { model: back } = await importBpmn(await exportBpmn(model));
    const customer = back.nodes.find((n) => n.id === "pool_customer");
    expect(customer?.attrs?.blackBox).toBe(true);
    expect(customer?.attrs?.lanes ?? []).toEqual([]);
    const messages = back.edges.filter((e) => e.kind === "message").map((e) => `${e.source}->${e.target}`).sort();
    expect(messages).toEqual(["pool_customer->start", "send_quote->pool_customer"]);
  });

  it("patching saved XML keeps a newly drawn message flow to the black-box pool", async () => {
    const raw = await exportBpmn(model);
    const edited = {
      ...model,
      edges: [...model.edges, { id: "m_new", source: "pool_customer", target: "send_quote", kind: "message",
        sourceAnchor: { dx: 330, dy: 120 }, targetAnchor: { dx: 30, dy: 0 } }],
    } as unknown as CanvasModel;
    const xml = await exportBpmn(edited, { format: "bpmn", payload: { raw } } as never);
    expect(xml).toMatch(/<bpmn:messageFlow\b[^>]*id="m_new"[^>]*sourceRef="pool_customer"[^>]*targetRef="send_quote"/);
  });
});

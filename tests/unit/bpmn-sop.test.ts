import { describe, it, expect } from "vitest";
import { importBpmn } from "../../src/io/bpmn/import";
import { exportBpmn } from "../../src/io/bpmn/export";
import type { CanvasModel } from "../../src/canvas/types";

const DIAGRAM_1_ORDER_FULFILLMENT: CanvasModel = {
  nodes: [
    { id: "pool1", shape: "bpmn-pool", x: 100, y: 100, width: 2200, height: 600, label: "Order Fulfillment", attrs: { lanes: [{ id: "l1", label: "Customer" }, { id: "l2", label: "System" }, { id: "l3", label: "Warehouse" }] } },
    { id: "start1", shape: "bpmn-event-start", x: 150, y: 180, width: 40, height: 40, label: "Places order", laneId: "l1" },
    { id: "task_validate", shape: "bpmn-task-service", x: 280, y: 370, width: 160, height: 60, label: "Validate inventory", laneId: "l2" },
    { id: "gate_stock", shape: "bpmn-gateway-x", x: 540, y: 380, width: 40, height: 40, label: "In stock?", laneId: "l2" },
    { id: "task_notify", shape: "bpmn-task", x: 680, y: 170, width: 160, height: 60, label: "Notify customer & offer backorder", laneId: "l1" },
    { id: "task_pick_list", shape: "bpmn-task-service", x: 680, y: 370, width: 160, height: 60, label: "Create picking list", laneId: "l2" },
    { id: "task_pick", shape: "bpmn-task", x: 940, y: 570, width: 160, height: 60, label: "Pick items", laneId: "l3" },
    { id: "task_qc", shape: "bpmn-task", x: 1200, y: 570, width: 160, height: 60, label: "Quality check", laneId: "l3" },
    { id: "gate_qc", shape: "bpmn-gateway-x", x: 1460, y: 580, width: 40, height: 40, label: "QC Pass?", laneId: "l3" },
    { id: "task_pack", shape: "bpmn-task", x: 1600, y: 570, width: 160, height: 60, label: "Pack items", laneId: "l3" },
    { id: "task_label", shape: "bpmn-task-service", x: 1600, y: 370, width: 160, height: 60, label: "Generate shipping label", laneId: "l2" },
    { id: "task_handoff", shape: "bpmn-task", x: 1860, y: 570, width: 160, height: 60, label: "Hand off to carrier", laneId: "l3" },
    { id: "task_update", shape: "bpmn-task-service", x: 1860, y: 370, width: 160, height: 60, label: "Update tracking & inventory", laneId: "l2" },
    { id: "end1", shape: "bpmn-event-end", x: 2120, y: 380, width: 40, height: 40, label: "Order fulfilled", laneId: "l2" },
    { id: "end_abort", shape: "bpmn-event-end", x: 940, y: 180, width: 40, height: 40, label: "Order aborted", laneId: "l1" }
  ],
  edges: [
    { id: "e1", source: "start1", target: "task_validate", router: "orth", sourcePort: "bottom", targetPort: "left" },
    { id: "e2", source: "task_validate", target: "gate_stock", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e3", source: "gate_stock", target: "task_notify", label: "No", router: "orth", sourcePort: "top", targetPort: "left" },
    { id: "e4", source: "gate_stock", target: "task_pick_list", label: "Yes", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e5", source: "task_notify", target: "end_abort", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e6", source: "task_pick_list", target: "task_pick", router: "orth", sourcePort: "bottom", targetPort: "left" },
    { id: "e7", source: "task_pick", target: "task_qc", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e8", source: "task_qc", target: "gate_qc", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e9", source: "gate_qc", target: "task_pick", label: "Failed", router: "orth", sourcePort: "top", targetPort: "top", vertices: [{ x: 1480, y: 500 }, { x: 1020, y: 500 }] },
    { id: "e10", source: "gate_qc", target: "task_pack", label: "Passed", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e11", source: "task_pack", target: "task_label", router: "orth", sourcePort: "top", targetPort: "bottom" },
    { id: "e12", source: "task_label", target: "task_handoff", router: "orth", sourcePort: "bottom", targetPort: "left" },
    { id: "e13", source: "task_handoff", target: "task_update", router: "orth", sourcePort: "top", targetPort: "bottom" },
    { id: "e14", source: "task_update", target: "end1", router: "orth", sourcePort: "right", targetPort: "left" }
  ]
};

const DIAGRAM_2_QUALITY_CONTROL: CanvasModel = {
  nodes: [
    { id: "pool2", shape: "bpmn-pool", x: 100, y: 100, width: 2200, height: 600, label: "Quality Control", attrs: { lanes: [{ id: "l1", label: "Production" }, { id: "l2", label: "Inspector" }, { id: "l3", label: "Quality Manager" }] } },
    { id: "start1", shape: "bpmn-event-start", x: 150, y: 180, width: 40, height: 40, label: "Batch received", laneId: "l1" },
    { id: "task_sample", shape: "bpmn-task", x: 280, y: 370, width: 160, height: 60, label: "Sample products", laneId: "l2" },
    { id: "task_visual", shape: "bpmn-task", x: 540, y: 370, width: 160, height: 60, label: "Visual inspection", laneId: "l2" },
    { id: "task_measure", shape: "bpmn-task", x: 800, y: 370, width: 160, height: 60, label: "Measurements", laneId: "l2" },
    { id: "task_functional", shape: "bpmn-task", x: 1060, y: 370, width: 160, height: 60, label: "Functional tests", laneId: "l2" },
    { id: "gate_test", shape: "bpmn-gateway-x", x: 1320, y: 380, width: 40, height: 40, label: "Tests pass?", laneId: "l2" },
    { id: "task_hold", shape: "bpmn-task", x: 1460, y: 370, width: 160, height: 60, label: "Place batch on hold", laneId: "l2" },
    { id: "task_review", shape: "bpmn-task-user", x: 1460, y: 570, width: 160, height: 60, label: "Review failed batch", laneId: "l3" },
    { id: "gate_decision", shape: "bpmn-gateway-x", x: 1720, y: 580, width: 40, height: 40, label: "Rework or Scrap?", laneId: "l3" },
    { id: "task_rework", shape: "bpmn-task", x: 1160, y: 170, width: 160, height: 60, label: "Send to production for rework", laneId: "l1" },
    { id: "end_scrap", shape: "bpmn-event-end", x: 1860, y: 580, width: 40, height: 40, label: "Batch scrapped", laneId: "l3" },
    { id: "task_approve", shape: "bpmn-task", x: 1460, y: 170, width: 160, height: 60, label: "Approve for packaging", laneId: "l1" },
    { id: "task_record", shape: "bpmn-task-service", x: 1720, y: 170, width: 160, height: 60, label: "Record metrics & generate cert", laneId: "l1" },
    { id: "end_pass", shape: "bpmn-event-end", x: 1980, y: 180, width: 40, height: 40, label: "Batch certified", laneId: "l1" }
  ],
  edges: [
    { id: "e1", source: "start1", target: "task_sample", router: "orth", sourcePort: "bottom", targetPort: "left" },
    { id: "e2", source: "task_sample", target: "task_visual", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e3", source: "task_visual", target: "task_measure", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e4", source: "task_measure", target: "task_functional", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e5", source: "task_functional", target: "gate_test", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e6", source: "gate_test", target: "task_approve", label: "Yes", router: "orth", sourcePort: "top", targetPort: "left" },
    { id: "e7", source: "gate_test", target: "task_hold", label: "No", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e8", source: "task_hold", target: "task_review", router: "orth", sourcePort: "bottom", targetPort: "top" },
    { id: "e9", source: "task_review", target: "gate_decision", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e10", source: "gate_decision", target: "end_scrap", label: "Scrap", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e11", source: "gate_decision", target: "task_rework", label: "Rework", router: "orth", sourcePort: "top", targetPort: "right" },
    { id: "e12", source: "task_rework", target: "task_sample", router: "orth", sourcePort: "left", targetPort: "top", vertices: [{ x: 1100, y: 200 }, { x: 360, y: 200 }] },
    { id: "e13", source: "task_approve", target: "task_record", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e14", source: "task_record", target: "end_pass", router: "orth", sourcePort: "right", targetPort: "left" }
  ]
};

const DIAGRAM_3_ONBOARDING: CanvasModel = {
  nodes: [
    { id: "pool3", shape: "bpmn-pool", x: 100, y: 100, width: 2950, height: 800, label: "Employee Onboarding", attrs: { lanes: [{ id: "l1", label: "HR" }, { id: "l2", label: "IT" }, { id: "l3", label: "Manager" }, { id: "l4", label: "Buddy" }] } },
    { id: "start1", shape: "bpmn-event-start", x: 150, y: 180, width: 40, height: 40, label: "Signed offer received", laneId: "l1" },
    { id: "task_hris", shape: "bpmn-task-user", x: 280, y: 170, width: 160, height: 60, label: "Create HRIS record", laneId: "l1" },
    { id: "task_equip", shape: "bpmn-task", x: 540, y: 170, width: 160, height: 60, label: "Request IT equipment", laneId: "l1" },
    { id: "task_it_setup", shape: "bpmn-task", x: 800, y: 370, width: 160, height: 60, label: "Setup accounts & provide training", laneId: "l2" },
    { id: "task_buddy", shape: "bpmn-task", x: 800, y: 570, width: 160, height: 60, label: "Assign onboarding buddy", laneId: "l3" },
    { id: "task_orientation", shape: "bpmn-task", x: 1060, y: 170, width: 160, height: 60, label: "Conduct company orientation", laneId: "l1" },
    { id: "task_intro", shape: "bpmn-task", x: 1320, y: 570, width: 160, height: 60, label: "Introduce to team & assign tasks", laneId: "l3" },
    { id: "task_buddy_orient", shape: "bpmn-task", x: 1580, y: 770, width: 160, height: 60, label: "Buddy-provided orientation", laneId: "l4" },
    { id: "task_manager_train", shape: "bpmn-task", x: 1840, y: 570, width: 160, height: 60, label: "Role-specific training", laneId: "l3" },
    { id: "task_paperwork", shape: "bpmn-task-user", x: 2100, y: 170, width: 160, height: 60, label: "Collect onboarding paperwork", laneId: "l1" },
    { id: "task_checkin", shape: "bpmn-task", x: 2360, y: 570, width: 160, height: 60, label: "30 days: Initial check-in", laneId: "l3" },
    { id: "task_review", shape: "bpmn-task", x: 2620, y: 570, width: 160, height: 60, label: "90 days: Onboarding review", laneId: "l3" },
    { id: "end1", shape: "bpmn-event-end", x: 2880, y: 580, width: 40, height: 40, label: "Onboarding completed", laneId: "l3" }
  ],
  edges: [
    { id: "e1", source: "start1", target: "task_hris", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e2", source: "task_hris", target: "task_equip", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e3", source: "task_equip", target: "task_it_setup", router: "orth", sourcePort: "bottom", targetPort: "left" },
    { id: "e4", source: "task_equip", target: "task_buddy", router: "orth", sourcePort: "bottom", targetPort: "left" },
    { id: "e5", source: "task_it_setup", target: "task_orientation", router: "orth", sourcePort: "right", targetPort: "left-1" },
    { id: "e6", source: "task_buddy", target: "task_orientation", router: "orth", sourcePort: "top", targetPort: "left-2" },
    { id: "e7", source: "task_orientation", target: "task_intro", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e8", source: "task_intro", target: "task_buddy_orient", router: "orth", sourcePort: "bottom", targetPort: "left" },
    { id: "e9", source: "task_buddy_orient", target: "task_manager_train", router: "orth", sourcePort: "top", targetPort: "left" },
    { id: "e10", source: "task_manager_train", target: "task_paperwork", router: "orth", sourcePort: "top", targetPort: "left" },
    { id: "e11", source: "task_paperwork", target: "task_checkin", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e12", source: "task_checkin", target: "task_review", router: "orth", sourcePort: "right", targetPort: "left" },
    { id: "e13", source: "task_review", target: "end1", router: "orth", sourcePort: "right", targetPort: "left" }
  ]
};

describe("BPMN 2.0 SOP Generation and Verification", () => {
  const verifyDiagram = async (name: string, model: CanvasModel) => {
    // 1. Export model to BPMN XML
    const xml = await exportBpmn(model, null);
    expect(xml).toBeTypeOf("string");
    expect(xml.length).toBeGreaterThan(0);
    expect(xml).toContain("<bpmn:process");
    expect(xml).toContain("bpmndi:BPMNPlane");

    // 2. Import XML back to model
    const importResult = await importBpmn(xml);
    const importedModel = importResult.model;
    expect(importedModel).toBeTypeOf("object");
    expect(importedModel.nodes.length).toBeGreaterThan(0);

    // 3. Verify laneId and shape preservation for every node
    for (const originalNode of model.nodes) {
      if (originalNode.shape === "bpmn-pool" || originalNode.shape === "bpmn-lane") continue;
      const importedNode = importedModel.nodes.find(n => n.id === originalNode.id);
      expect(importedNode).toBeDefined();
      expect(importedNode!.laneId).toBe(originalNode.laneId);
      
      // Make sure shape matches standard or mapping
      if (originalNode.shape.startsWith("bpmn-task")) {
        expect(importedNode!.shape).toContain("bpmn-task");
      }
    }

    // 4. Verify all edges are round-tripped
    for (const originalEdge of model.edges) {
      const importedEdge = importedModel.edges.find(e => e.id === originalEdge.id);
      expect(importedEdge).toBeDefined();
      expect(importedEdge!.source).toBe(originalEdge.source);
      expect(importedEdge!.target).toBe(originalEdge.target);
    }
  };

  it("should successfully round-trip Order Fulfillment SOP", async () => {
    await verifyDiagram("Order Fulfillment", DIAGRAM_1_ORDER_FULFILLMENT);
  });

  it("should successfully round-trip Manufacturing QC", async () => {
    await verifyDiagram("Manufacturing QC", DIAGRAM_2_QUALITY_CONTROL);
  });

  it("should successfully round-trip Employee Onboarding SOP", async () => {
    await verifyDiagram("Employee Onboarding", DIAGRAM_3_ONBOARDING);
  });
});
